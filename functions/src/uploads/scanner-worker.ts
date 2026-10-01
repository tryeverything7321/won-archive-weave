import { createHash } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { defineSecret, defineString } from 'firebase-functions/params'
import { onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onObjectFinalized } from 'firebase-functions/v2/storage'
import { GoogleAuth } from 'google-auth-library'
import { parseScanAttestation, type QuarantinedObjectFingerprint, type ScanAttestation } from './scan-attestation.js'
import { publishCleanUploadSubmission } from './submissions.js'
import { operatorModerationBlocksPublication } from './content-moderation.js'
import { recordUploadedReservationObject, selectedUploadNames } from './upload-selection.js'
import { FILE_SCANNER_ENDPOINT, resolveScannerEndpoint } from './scanner-endpoint.js'
import {
  recordAndPublishAutomatedEventScan,
  recordAutomatedEventScanFailure,
} from '../calendar/event-management.js'
import {
  recordMaterialBundleScanFailure,
  recordMaterialBundleScanResult,
  recordUploadedMaterialBundleObject,
} from '../bundles/material-bundles.js'

if (!getApps().length) initializeApp()

const FILE_SCANNER_BEARER_TOKEN = defineSecret('FILE_SCANNER_BEARER_TOKEN')
const WEAVE_STORAGE_BUCKET = defineString('WEAVE_STORAGE_BUCKET', {
  default: 'won-archive-weave.firebasestorage.app',
})

const MAX_SCANNED_BYTES = 20 * 1024 * 1024
const EICAR_MARKER = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

type ScannerVerdict = {
  verdict: 'clean' | 'blocked'
  provider: string
  engineVersion: string
  signature?: string
}

type StoredScanResult = ScannerVerdict & {
  schemaVersion: 1
  scanId: string
  bucket: string
  path: string
  generation: string
  size: number
  contentHash: string
  scannedAtMs: number
}

export function submissionScanApplicationDecision(input: {
  lifecycleVersion: unknown
  status: unknown
  attachmentStatus?: unknown
  capturedRevision?: unknown
  currentRevision?: unknown
  moderated?: boolean
}): 'apply_attachment' | 'apply_legacy' | 'ignore' {
  if (input.lifecycleVersion === 1) {
    return input.status === 'published'
      && (input.attachmentStatus === 'pending' || input.attachmentStatus === 'error')
      && typeof input.capturedRevision === 'string'
      && input.capturedRevision === input.currentRevision
      && !input.moderated
      ? 'apply_attachment'
      : 'ignore'
  }
  return input.status === 'review_queued' || input.status === 'exception_queued' ? 'apply_legacy' : 'ignore'
}

export function shouldResumeCleanScanPublication(
  decision: 'apply_attachment' | 'apply_legacy' | 'ignore',
  sameScanId: boolean,
  verdict: 'clean' | 'blocked',
): boolean {
  return decision !== 'ignore' && sameScanId && verdict === 'clean'
}

export function quarantinedSubmissionPath(path: string):
  | { kind: 'submission'; ownerUid: string; submissionId: string }
  | { kind: 'calendar_event'; ownerUid: string; eventId: string }
  | { kind: 'material_bundle'; ownerUid: string; bundleId: string; fileId: string }
  | null {
  const segments = path.split('/')
  if (
    segments.length === 6
    && segments[0] === 'quarantined'
    && segments[1]
    && segments[2] === 'material-bundles'
    && segments[3]
    && segments[4]
    && segments[5]
  ) {
    return { kind: 'material_bundle', ownerUid: segments[1], bundleId: segments[3], fileId: segments[4] }
  }
  if (
    segments.length >= 5
    && segments[0] === 'quarantined'
    && segments[1]
    && segments[2] === 'calendar-events'
    && segments[3]
    && segments[4]
  ) {
    return { kind: 'calendar_event', ownerUid: segments[1], eventId: segments[3] }
  }
  if (
    segments.length < 4
    || segments[0] !== 'quarantined'
    || !segments[1]
    || !segments[2]
  ) return null
  return { kind: 'submission', ownerUid: segments[1], submissionId: segments[2] }
}

export function scanResultId(bucket: string, path: string, generation: string): string {
  return createHash('sha256').update(`${bucket}\u0000${path}\u0000${generation}`).digest('hex')
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

export function localFilePolicy(bytes: Buffer, contentType: string): { allowed: boolean; reason?: string } {
  if (!bytes.length || bytes.length > MAX_SCANNED_BYTES) return { allowed: false, reason: 'invalid_size' }
  if (bytes.includes(Buffer.from(EICAR_MARKER, 'ascii'))) return { allowed: false, reason: 'eicar_test_signature' }

  // Storage metadata can legally retain MIME parameters (notably charset for
  // TXT/CSV). The upload boundary already validates the canonical extension and
  // MIME pair, so signature inspection should compare the normalized media type.
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''

  const valid = mediaType === 'application/pdf'
    ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    : mediaType === 'image/jpeg'
      ? startsWith(bytes, [0xff, 0xd8, 0xff])
      : mediaType === 'image/png'
        ? startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : mediaType === 'image/webp'
          ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          : mediaType.startsWith('application/vnd.openxmlformats-officedocument')
            || mediaType === 'application/hwp+zip'
            || mediaType === 'application/vnd.hancom.hwpx'
            || mediaType === 'application/haansofthwpx'
            ? startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
            : mediaType === 'application/x-hwp'
              || mediaType === 'application/haansofthwp'
              || mediaType === 'application/vnd.hancom.hwp'
              ? startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
              : mediaType === 'text/plain' || mediaType === 'text/csv' || mediaType === 'text/markdown'
                ? !bytes.includes(0)
                : false
  return valid ? { allowed: true } : { allowed: false, reason: 'mime_signature_mismatch' }
}

export function parseExternalScannerVerdict(value: unknown): ScannerVerdict {
  if (!value || typeof value !== 'object') throw new Error('invalid_scanner_response')
  const data = value as Record<string, unknown>
  const verdict = data.verdict === 'clean' ? 'clean' : data.verdict === 'blocked' || data.verdict === 'infected' ? 'blocked' : null
  const provider = typeof data.provider === 'string' ? data.provider.trim() : ''
  const engineVersion = typeof data.engineVersion === 'string' ? data.engineVersion.trim() : ''
  const signature = typeof data.signature === 'string' ? data.signature.trim().slice(0, 160) : undefined
  if (!verdict || !provider || !engineVersion || provider.length > 160 || engineVersion.length > 160) {
    throw new Error('invalid_scanner_response')
  }
  return { verdict, provider, engineVersion, ...(signature ? { signature } : {}) }
}

export function scannerRequestHeaders(contentType: string, path: string, scannerToken: string) {
  return {
    'content-type': contentType,
    'x-weave-object-name': encodeURIComponent(path),
    'x-weave-scanner-token': scannerToken,
  }
}

async function externalScan(bytes: Buffer, contentType: string, path: string): Promise<ScannerVerdict> {
  const url = resolveScannerEndpoint(FILE_SCANNER_ENDPOINT.value())
  const audience = url.origin
  const client = await new GoogleAuth().getIdTokenClient(audience)

  const response = await client.fetch<unknown>(url.toString(), {
    method: 'POST',
    headers: scannerRequestHeaders(contentType, path, FILE_SCANNER_BEARER_TOKEN.value()),
    body: Uint8Array.from(bytes).buffer,
  })
  if (!response.ok) throw new Error(`file_scanner_unavailable:${response.status}`)
  return parseExternalScannerVerdict(response.data)
}

export function sameSelectedUploadNames(left?: string[], right?: string[]): boolean {
  if (!left || !right) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function scannerSelectionAllowsObject(path: string, prefix: string, selectedNames?: string[]): boolean {
  if (!selectedNames) return true
  if (!path.startsWith(prefix)) return false
  const name = path.slice(prefix.length)
  return !name.includes('/') && selectedNames.includes(name)
}

async function currentObjects(bucketName: string, ownerUid: string, submissionId: string, selectedNames?: string[]) {
  const prefix = `quarantined/${ownerUid}/${submissionId}/`
  try {
    return await currentObjectsAtPrefix(
      bucketName,
      prefix,
      21,
      selectedNames?.map((name) => `${prefix}${name}`),
    )
  } catch (error) {
    if (selectedNames && typeof error === 'object' && error !== null && 'code' in error
      && Number((error as { code?: unknown }).code) === 404) return []
    throw error
  }
}

async function currentObjectsAtPrefix(bucketName: string, prefix: string, maxResults: number, selectedPaths?: string[]) {
  const bucket = getStorage().bucket(bucketName)
  const files = selectedPaths
    ? selectedPaths.map((path) => {
      if (!path.startsWith(prefix) || path.includes('..')) throw new Error('invalid_event_media_path')
      return bucket.file(path)
    })
    : (await bucket.getFiles({
    prefix,
    maxResults,
  }))[0]
  if (!files.length || files.length >= maxResults) return []
  return Promise.all(files.map(async (file) => {
    const [metadata] = await file.getMetadata()
    const generation = String(metadata.generation ?? '')
    const size = Number(metadata.size ?? 0)
    const contentHash = typeof metadata.metadata?.weaveSha256 === 'string'
      ? `sha256:${metadata.metadata.weaveSha256}`
      : ''
    return {
      path: file.name,
      generation,
      size,
      contentHash,
      resultId: scanResultId(bucketName, file.name, generation),
    }
  }))
}

async function aggregateEventScan(bucketName: string, ownerUid: string, eventId: string) {
  const firestore = getFirestore()
  const eventRef = firestore.collection('calendarEventSubmissions').doc(eventId)
  const event = await eventRef.get()
  if (
    !event.exists
    || event.get('ownerUid') !== ownerUid
    || (event.get('status') !== 'review_queued' && event.get('status') !== 'publishing_failed')
  ) return
  const uploads = Array.isArray(event.get('mediaUploads')) ? event.get('mediaUploads') as Array<Record<string, unknown>> : []
  const expectedPaths = uploads
    .map((item) => typeof item.storagePath === 'string' ? item.storagePath : '')
    .filter(Boolean)
    .sort()
  if (!expectedPaths.length || expectedPaths.length > 9) return
  const objects = (await currentObjectsAtPrefix(
    bucketName,
    `quarantined/${ownerUid}/calendar-events/${eventId}/`,
    10,
    expectedPaths,
  )).sort((left, right) => left.path.localeCompare(right.path))
  if (objects.length !== expectedPaths.length || objects.some((item, index) => item.path !== expectedPaths[index])) return
  const results = await firestore.getAll(...objects.map((object) => firestore.collection('fileScanResults').doc(object.resultId)))
  if (results.some((result) => !result.exists)) return
  const values = results.map((result) => result.data() as StoredScanResult)
  if (values.some((value, index) => (
    value.bucket !== bucketName
    || value.path !== objects[index]?.path
    || value.generation !== objects[index]?.generation
    || value.size !== objects[index]?.size
    || value.contentHash !== objects[index]?.contentHash
  ))) return
  const fingerprints: QuarantinedObjectFingerprint[] = objects.map(({ path, generation, size, contentHash }) => ({
    path,
    generation,
    size,
    contentHash,
  }))
  const scanId = createHash('sha256')
    .update(values.map((value) => value.scanId).sort().join('\u0000'))
    .digest('hex')
  const attestation = parseScanAttestation({
    schemaVersion: 1,
    verdict: values.some((value) => value.verdict === 'blocked') ? 'blocked' : 'clean',
    provider: [...new Set(values.map((value) => value.provider))].sort().join('+').slice(0, 160),
    scanId,
    engineVersion: [...new Set(values.map((value) => value.engineVersion))].sort().join('+').slice(0, 160),
    scannedAtMs: Math.max(...values.map((value) => value.scannedAtMs)),
    objects: fingerprints,
  } satisfies ScanAttestation)
  await recordAndPublishAutomatedEventScan(eventId, ownerUid, attestation)
}

export async function aggregateSubmissionScan(bucketName: string, ownerUid: string, submissionId: string) {
  const firestore = getFirestore()
  const submissionRef = firestore.collection('submissions').doc(submissionId)
  const submission = await submissionRef.get()
  if (!submission.exists || submission.get('ownerUid') !== ownerUid || submission.get('sourceMode') !== 'upload') return
  const lifecycleVersion = submission.get('attachmentLifecycleVersion')
  const capturedRevision = submission.get('attachmentRevision')
  const capturedSelection = selectedUploadNames(submission.get('uploadSelection'))
  if (submissionScanApplicationDecision({
    lifecycleVersion,
    status: submission.get('status'),
    attachmentStatus: submission.get('attachmentStatus'),
    capturedRevision,
    currentRevision: capturedRevision,
    moderated: operatorModerationBlocksPublication(submission.get('operatorModeration')),
  }) === 'ignore') return

  const objects = (await currentObjects(bucketName, ownerUid, submissionId, capturedSelection))
    .sort((left, right) => left.path.localeCompare(right.path))
  if (!objects.length || objects.some((object) => !object.generation || !object.contentHash || !Number.isSafeInteger(object.size))) return
  const results = await firestore.getAll(...objects.map((object) => firestore.collection('fileScanResults').doc(object.resultId)))
  if (results.some((result) => !result.exists)) return
  const values = results.map((result) => result.data() as StoredScanResult)
  if (values.some((value, index) => (
    value.bucket !== bucketName
    || value.path !== objects[index]?.path
    || value.generation !== objects[index]?.generation
    || value.size !== objects[index]?.size
    || value.contentHash !== objects[index]?.contentHash
  ))) return

  const fingerprints: QuarantinedObjectFingerprint[] = objects.map(({ path, generation, size, contentHash }) => ({
    path,
    generation,
    size,
    contentHash,
  }))
  const scanId = createHash('sha256')
    .update(values.map((value) => value.scanId).sort().join('\u0000'))
    .digest('hex')
  const attestation = parseScanAttestation({
    schemaVersion: 1,
    verdict: values.some((value) => value.verdict === 'blocked') ? 'blocked' : 'clean',
    provider: [...new Set(values.map((value) => value.provider))].sort().join('+').slice(0, 160),
    scanId,
    engineVersion: [...new Set(values.map((value) => value.engineVersion))].sort().join('+').slice(0, 160),
    scannedAtMs: Math.max(...values.map((value) => value.scannedAtMs)),
    objects: fingerprints,
  } satisfies ScanAttestation)

  const recorded = await firestore.runTransaction(async (transaction) => {
    const materialRef = firestore.collection('materials').doc(submissionId)
    const activityRef = firestore.collection('activities').doc(submissionId)
    const [current, material, activity] = await Promise.all([
      transaction.get(submissionRef), transaction.get(materialRef), transaction.get(activityRef),
    ])
    if (current.get('ownerUid') !== ownerUid || current.get('sourceMode') !== 'upload') return false
    if (!sameSelectedUploadNames(capturedSelection, selectedUploadNames(current.get('uploadSelection')))) return false
    const decision = submissionScanApplicationDecision({
      lifecycleVersion: current.get('attachmentLifecycleVersion'),
      status: current.get('status'),
      attachmentStatus: current.get('attachmentStatus'),
      capturedRevision,
      currentRevision: current.get('attachmentRevision'),
      moderated: operatorModerationBlocksPublication(current.get('operatorModeration')),
    })
    if (decision === 'ignore') return false
    if (current.get('scanAttestation.scanId') === scanId) {
      return shouldResumeCleanScanPublication(decision, true, attestation.verdict)
    }
    const timestamp = FieldValue.serverTimestamp()
    transaction.update(submissionRef, {
      ...(decision === 'apply_legacy'
        ? {
            status: attestation.verdict === 'clean' ? 'review_queued' : 'exception_queued',
            attachmentStatus: attestation.verdict === 'clean' ? 'clean' : 'blocked',
          }
        : {
            attachmentStatus: attestation.verdict === 'blocked' ? 'blocked' : 'pending',
            ...(attestation.verdict === 'blocked' ? { previewStatus: FieldValue.delete() } : {}),
          }),
      scanStatus: attestation.verdict,
      scanAttestation: attestation,
      scanRecordedAt: timestamp,
      scanRecordedBy: 'event-driven-file-scanner',
      updatedAt: timestamp,
    })
    if (decision === 'apply_attachment' && attestation.verdict === 'blocked') {
      const blockedFields = {
        attachmentStatus: 'blocked',
        approvedStoragePath: FieldValue.delete(),
        approvedStoragePaths: FieldValue.delete(),
        approvedStorageObjects: FieldValue.delete(),
        sourceFormat: FieldValue.delete(),
        previewStoragePath: FieldValue.delete(),
        previewStatus: FieldValue.delete(),
        updatedAt: timestamp,
      }
      if (material.exists && material.get('status') === 'published') transaction.update(materialRef, blockedFields)
      if (activity.exists && activity.get('status') === 'published') transaction.update(activityRef, { attachmentStatus: 'blocked', updatedAt: timestamp })
    }
    if (attestation.verdict === 'blocked') {
      transaction.set(firestore.collection('submissionOperatorExceptions').doc(submissionId), {
        submissionId,
        type: 'scan_blocked',
        status: 'open',
        scanId,
      updatedAt: timestamp,
      createdAt: timestamp,
      }, { merge: true })
    }
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: 'submission.automated_scan_recorded',
      submissionId,
      scanId,
      verdict: attestation.verdict,
      ...(decision === 'apply_attachment' ? { attachmentRevision: capturedRevision } : {}),
      at: timestamp,
    })
    return true
  })
  if (recorded && attestation.verdict === 'clean') await publishCleanUploadSubmission(submissionId)
}

export async function recordScannerFailure(
  submissionId: string,
  ownerUid: string,
  path: string,
  generation: string,
  code: string,
) {
  const firestore = getFirestore()
  const submissionRef = firestore.collection('submissions').doc(submissionId)
  await firestore.runTransaction(async (transaction) => {
    const materialRef = firestore.collection('materials').doc(submissionId)
    const activityRef = firestore.collection('activities').doc(submissionId)
    const [submission, material, activity] = await Promise.all([
      transaction.get(submissionRef), transaction.get(materialRef), transaction.get(activityRef),
    ])
    if (!submission.exists || submission.get('ownerUid') !== ownerUid
      || operatorModerationBlocksPublication(submission.get('operatorModeration'))) return
    const timestamp = FieldValue.serverTimestamp()
    if (submission.get('status') === 'draft' || submission.get('status') === 'revision_requested') {
      transaction.set(submissionRef, {
        scanStatus: 'error',
        pendingAttachmentFailures: FieldValue.arrayUnion({ path, generation, code: code.slice(0, 160) }),
        updatedAt: timestamp,
      }, { merge: true })
      transaction.set(firestore.collection('auditEvents').doc(), {
        type: 'submission.pre_submit_scan_failed', submissionId, code: code.slice(0, 160), at: timestamp,
      })
      return
    }
    const expected = submission.get('attachmentExpectedObjects')
    const independent = submission.get('attachmentLifecycleVersion') === 1
      && submission.get('status') === 'published'
      && (submission.get('attachmentStatus') === 'pending' || submission.get('attachmentStatus') === 'error')
      && Array.isArray(expected)
      && expected.some((item) => item?.path === path && item?.generation === generation)
    if (!independent && submission.get('status') === 'published') return
    transaction.set(submissionRef, {
      ...(independent ? { attachmentStatus: 'error' } : { status: 'exception_queued' }),
      scanStatus: 'error',
      scanFailureCode: code.slice(0, 160),
      updatedAt: timestamp,
    }, { merge: true })
    if (independent && material.exists && material.get('status') === 'published') {
      transaction.update(materialRef, { attachmentStatus: 'error', updatedAt: timestamp })
    }
    if (independent && activity.exists && activity.get('status') === 'published') {
      transaction.update(activityRef, { attachmentStatus: 'error', updatedAt: timestamp })
    }
    transaction.set(firestore.collection('submissionOperatorExceptions').doc(submissionId), {
      submissionId,
      type: 'scan_failed',
      status: 'open',
      code: code.slice(0, 160),
      updatedAt: timestamp,
      createdAt: timestamp,
    }, { merge: true })
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: 'submission.automated_scan_failed',
      submissionId,
      code: code.slice(0, 160),
      at: timestamp,
    })
  })
}

export const scanQuarantinedUpload = onObjectFinalized(
  {
    region: 'asia-northeast3',
    memory: '512MiB',
    timeoutSeconds: 180,
    retry: true,
    secrets: [FILE_SCANNER_BEARER_TOKEN],
    bucket: WEAVE_STORAGE_BUCKET,
  },
  async (event) => {
    const data = event.data
    const target = quarantinedSubmissionPath(data.name)
    if (!target) return
    if (target.kind === 'submission') {
      const submission = await getFirestore().collection('submissions').doc(target.submissionId).get()
      if (!submission.exists || submission.get('ownerUid') !== target.ownerUid) return
      const selectedNames = selectedUploadNames(submission.get('uploadSelection'))
      const prefix = `quarantined/${target.ownerUid}/${target.submissionId}/`
      if (!scannerSelectionAllowsObject(data.name, prefix, selectedNames)) return
    }
    const bucket = getStorage().bucket(data.bucket)
    const generation = String(data.generation)
    const resultId = scanResultId(data.bucket, data.name, generation)
    const resultRef = getFirestore().collection('fileScanResults').doc(resultId)
    if ((await resultRef.get()).exists) {
      if (target.kind === 'calendar_event') await aggregateEventScan(data.bucket, target.ownerUid, target.eventId)
      else if (target.kind === 'submission') await aggregateSubmissionScan(data.bucket, target.ownerUid, target.submissionId)
      else await recordMaterialBundleScanResult({
        ownerUid: target.ownerUid, bundleId: target.bundleId, fileId: target.fileId,
        path: data.name, generation, scanId: resultId, verdict: (await resultRef.get()).get('verdict') === 'clean' ? 'clean' : 'blocked',
      })
      return
    }

    const file = bucket.file(data.name, { generation })
    const [metadata] = await file.getMetadata()
    if (String(metadata.generation) !== generation) throw new Error('storage_generation_changed')
    const size = Number(metadata.size ?? 0)
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SCANNED_BYTES) {
      throw new Error('invalid_scan_object_size')
    }
    const [bytes] = await file.download({ validation: 'crc32c' })
    if (bytes.length !== size) throw new Error('scan_object_size_changed')

    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const custom = metadata.metadata && typeof metadata.metadata === 'object'
      ? metadata.metadata as Record<string, unknown>
      : {}
    if (target.kind === 'submission') {
      const accepted = await recordUploadedReservationObject({
        ownerUid: target.ownerUid,
        submissionId: target.submissionId,
        targetName: data.name.split('/').at(-1) ?? '',
        size,
        contentType: String(metadata.contentType ?? ''),
        reservationId: typeof custom.reservationId === 'string' ? custom.reservationId : '',
        requestId: typeof custom.requestId === 'string' ? custom.requestId : '',
        sha256,
      })
      if (!accepted) {
        await file.delete({ ignoreNotFound: true, ifGenerationMatch: generation })
        return
      }
    } else if (target.kind === 'material_bundle') {
      const revision = Number(custom.revision)
      const accepted = await recordUploadedMaterialBundleObject({
        ownerUid: target.ownerUid,
        bundleId: target.bundleId,
        fileId: target.fileId,
        revision,
        targetName: data.name.split('/').at(-1) ?? '',
        storagePath: data.name,
        generation,
        size,
        contentType: String(metadata.contentType ?? ''),
        reservationId: typeof custom.reservationId === 'string' ? custom.reservationId : '',
        requestId: typeof custom.requestId === 'string' ? custom.requestId : '',
        sha256,
      })
      if (!accepted) {
        await file.delete({ ignoreNotFound: true, ifGenerationMatch: generation })
        return
      }
    }
    const contentHash = `sha256:${sha256}`
    const policy = localFilePolicy(bytes, String(metadata.contentType ?? ''))
    let scanner: ScannerVerdict
    try {
      scanner = policy.allowed
        ? await externalScan(bytes, String(metadata.contentType ?? 'application/octet-stream'), data.name)
        : {
            verdict: 'blocked' as const,
            provider: 'weave-local-file-policy',
            engineVersion: 'signature-policy-v1',
            signature: policy.reason,
          }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'scanner_unavailable'
      if (target.kind === 'calendar_event') await recordAutomatedEventScanFailure(target.eventId, target.ownerUid, code)
      else if (target.kind === 'submission') await recordScannerFailure(target.submissionId, target.ownerUid, data.name, generation, code)
      else await recordMaterialBundleScanFailure({
        ownerUid: target.ownerUid, bundleId: target.bundleId, fileId: target.fileId,
        path: data.name, generation, code,
      })
      throw error
    }
    const scannedAtMs = Date.now()
    const result: StoredScanResult = {
      schemaVersion: 1,
      verdict: scanner.verdict,
      provider: scanner.provider,
      engineVersion: scanner.engineVersion,
      ...(scanner.signature ? { signature: scanner.signature } : {}),
      scanId: resultId,
      bucket: data.bucket,
      path: data.name,
      generation,
      size,
      contentHash,
      scannedAtMs,
    }

    await file.setMetadata({
      metadata: {
        ...(metadata.metadata ?? {}),
        weaveSha256: sha256,
        weaveScanId: resultId,
      },
    })
    await resultRef.create({
      ...result,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(scannedAtMs + 90 * 24 * 60 * 60 * 1_000),
    })
    if (target.kind === 'calendar_event') await aggregateEventScan(data.bucket, target.ownerUid, target.eventId)
    else if (target.kind === 'submission') await aggregateSubmissionScan(data.bucket, target.ownerUid, target.submissionId)
    else await recordMaterialBundleScanResult({
      ownerUid: target.ownerUid, bundleId: target.bundleId, fileId: target.fileId,
      path: data.name, generation, scanId: resultId, verdict: scanner.verdict,
    })
  },
)

export const aggregateSubmittedUploadScan = onDocumentUpdated(
  {
    document: 'submissions/{submissionId}',
    region: 'asia-northeast3',
    retry: true,
  },
  async (event) => {
    const before = event.data?.before
    const after = event.data?.after
    if (!after?.exists || after.get('sourceMode') !== 'upload' || typeof after.get('ownerUid') !== 'string') return
    if (after.get('attachmentLifecycleVersion') === 1) {
      if (after.get('status') !== 'published' || (after.get('attachmentStatus') !== 'pending' && after.get('attachmentStatus') !== 'error')
        || typeof after.get('attachmentRevision') !== 'string'
        || (before?.get('attachmentRevision') === after.get('attachmentRevision')
          && before?.get('status') === 'published'
          && (before?.get('attachmentStatus') === 'pending' || before?.get('attachmentStatus') === 'error'))) return
    } else if (before?.get('status') === 'review_queued' || after.get('status') !== 'review_queued') return
    await aggregateSubmissionScan(
      getStorage().bucket().name,
      after.get('ownerUid') as string,
      event.params.submissionId,
    )
  },
)

export const aggregateSubmittedEventScan = onDocumentWritten(
  {
    document: 'calendarEventSubmissions/{eventId}',
    region: 'asia-northeast3',
    retry: true,
  },
  async (event) => {
    const before = event.data?.before
    const after = event.data?.after
    if (
      !after?.exists
      || (before?.get('status') === 'review_queued'
        && before.get('mediaScanRevision') === after.get('mediaScanRevision'))
      || after.get('status') !== 'review_queued'
      || typeof after.get('ownerUid') !== 'string'
      || !Array.isArray(after.get('mediaUploads'))
      || after.get('mediaUploads').length === 0
    ) return
    await aggregateEventScan(
      getStorage().bucket().name,
      after.get('ownerUid') as string,
      event.params.eventId,
    )
  },
)
