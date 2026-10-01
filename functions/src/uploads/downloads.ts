import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireActorPolicy } from '../community/actor-policy.js'
import {
  approvedAttachmentGeneration,
  attachmentAllowsRead,
  ownerAttachmentPathsMatch,
  ownerPrivateAttachmentAllowsRead,
} from './attachment-access.js'
import { canDownload, canPreview, type RightsRecord, type SubmissionStatus, type SubmissionVisibility } from './contracts.js'
import { nativePreviewFormat, decodePreviewText } from './preview-format.js'
import { conversionFormat, convertDocument, MAX_PREVIEW_INPUT, previewCachePath } from './document-preview.js'
import { operatorModerationBlocksPublication } from './content-moderation.js'
import { assertAttestationMatchesObjects, parseScanAttestation, type QuarantinedObjectFingerprint } from './scan-attestation.js'
import { selectedUploadNames } from './upload-selection.js'
import { publishCleanUploadSubmission } from './submissions.js'
import { downloadContentDisposition, downloadFileName } from './download-disposition.js'
import { coordinatePreviewConversion } from './preview-coordination.js'

if (!getApps().length) initializeApp()

type OwnerAttachment = {
  submissionId: string
  scanId: string
  source: QuarantinedObjectFingerprint
  preview?: QuarantinedObjectFingerprint
  sourceName: string
}

function submissionIdFrom(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new HttpsError('invalid-argument', '자료를 찾지 못했어요')
  return id
}

function objectFingerprint(path: string, metadata: Record<string, unknown>): QuarantinedObjectFingerprint {
  const custom = metadata.metadata && typeof metadata.metadata === 'object'
    ? metadata.metadata as Record<string, unknown>
    : {}
  const contentHash = typeof custom.weaveSha256 === 'string'
    ? `sha256:${custom.weaveSha256}`
    : typeof metadata.md5Hash === 'string'
      ? `md5:${metadata.md5Hash}`
      : typeof metadata.crc32c === 'string'
        ? `crc32c:${metadata.crc32c}`
        : ''
  return {
    path,
    generation: String(metadata.generation ?? ''),
    size: Number(metadata.size ?? 0),
    contentHash,
  }
}

async function loadOwnerAttachment(submissionId: string, actorUid: string): Promise<OwnerAttachment> {
  const snapshot = await getFirestore().collection('submissions').doc(submissionId).get()
  if (!snapshot.exists) throw new HttpsError('not-found', '자료를 찾지 못했어요')
  const data = snapshot.data() as Record<string, unknown>
  let attestation
  try { attestation = parseScanAttestation(data.scanAttestation) }
  catch { throw new HttpsError('failed-precondition', '안전 검사가 완료된 첨부만 열 수 있어요') }
  if (!ownerPrivateAttachmentAllowsRead({
    actorUid,
    ownerUid: data.ownerUid,
    status: data.status,
    visibility: data.visibility,
    sourceMode: data.sourceMode,
    scanStatus: data.scanStatus,
    verdict: attestation.verdict,
    scanRecordedBy: data.scanRecordedBy,
    moderated: operatorModerationBlocksPublication(data.operatorModeration),
  })) {
    if (data.ownerUid !== actorUid || data.visibility !== '보류') {
      throw new HttpsError('permission-denied', '내가 비공개로 보관한 첨부만 열 수 있어요')
    }
    throw new HttpsError('failed-precondition', '현재 상태에서는 첨부를 열 수 없어요')
  }
  const selected = selectedUploadNames(data.uploadSelection)
  if (!selected?.length) throw new HttpsError('failed-precondition', '현재 첨부 선택 정보를 확인할 수 없어요')
  const prefix = `quarantined/${actorUid}/${submissionId}/`
  if (!ownerAttachmentPathsMatch(prefix, selected, attestation.objects.map((object) => object.path))) {
    throw new HttpsError('failed-precondition', '현재 선택한 첨부와 검사 결과가 달라요')
  }
  const bucket = getStorage().bucket()
  const actual = await Promise.all(attestation.objects.map(async (object) => {
    const [metadata] = await bucket.file(object.path, { generation: object.generation }).getMetadata()
    return objectFingerprint(object.path, metadata as unknown as Record<string, unknown>)
  }))
  assertAttestationMatchesObjects(attestation, actual)
  const source = attestation.objects.find((object) => !object.path.split('/').pop()?.includes('__preview__-'))
  const preview = attestation.objects.find((object) => object.path.split('/').pop()?.includes('__preview__-'))
  if (!source || attestation.objects.filter((object) => !object.path.split('/').pop()?.includes('__preview__-')).length !== 1) {
    throw new HttpsError('failed-precondition', '원본 첨부를 확인할 수 없어요')
  }
  return {
    submissionId,
    scanId: attestation.scanId,
    source,
    ...(preview ? { preview } : {}),
    sourceName: downloadFileName(source.path),
  }
}

async function requireOwnerAttachmentUnchanged(expected: OwnerAttachment, actorUid: string): Promise<void> {
  const current = await loadOwnerAttachment(expected.submissionId, actorUid)
  if (current.scanId !== expected.scanId
    || current.source.path !== expected.source.path
    || current.source.generation !== expected.source.generation
    || current.preview?.path !== expected.preview?.path
    || current.preview?.generation !== expected.preview?.generation) {
    throw new HttpsError('aborted', '첨부 상태가 바뀌었어요. 다시 열어 주세요.')
  }
}

export const createOwnerSubmissionAttachmentAccess = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 120, memory: '1GiB', maxInstances: 4, concurrency: 1 },
  async (request) => {
    const { uid } = await requireActorPolicy(request.auth)
    const revalidateActor = async () => {
      const currentActor = await requireActorPolicy(request.auth)
      if (currentActor.uid !== uid) throw new HttpsError('permission-denied', '로그인 상태가 바뀌었어요')
    }
    const submissionId = submissionIdFrom(request.data?.submissionId)
    const action = request.data?.action
    if (action !== 'preview' && action !== 'download') throw new HttpsError('invalid-argument', '첨부 열기 방식을 확인해 주세요')
    const preflight = await getFirestore().collection('submissions').doc(submissionId).get()
    if (!preflight.exists) throw new HttpsError('not-found', '자료를 찾지 못했어요')
    if (preflight.get('ownerUid') !== uid || preflight.get('visibility') !== '보류' || preflight.get('sourceMode') !== 'upload') {
      throw new HttpsError('permission-denied', '내가 비공개로 보관한 첨부만 열 수 있어요')
    }
    // Repairs legacy visibility_hold records without creating any public projection.
    await publishCleanUploadSubmission(submissionId)
    const attachment = await loadOwnerAttachment(submissionId, uid)
    const bucket = getStorage().bucket()
    const expiresAtMs = Date.now() + 5 * 60_000
    if (action === 'download') {
      const [url] = await bucket.file(attachment.source.path, { generation: attachment.source.generation })
        .getSignedUrl({
          action: 'read',
          expires: expiresAtMs,
          version: 'v4',
          responseDisposition: downloadContentDisposition(attachment.sourceName),
        })
      await revalidateActor()
      await requireOwnerAttachmentUnchanged(attachment, uid)
      return { url, expiresAtMs, renderFormat: 'download' as const, fileName: attachment.sourceName }
    }

    const previewObject = attachment.preview ?? attachment.source
    const renderFormat = attachment.preview ? 'pdf' : nativePreviewFormat(attachment.source.path)
    const format = !attachment.preview ? conversionFormat(attachment.source.path) : null
    if (format) {
      const source = bucket.file(attachment.source.path, { generation: attachment.source.generation })
      const cache = bucket.file(previewCachePath(submissionId, attachment.source.path, attachment.source.generation))
      try {
        await coordinatePreviewConversion({
          cachePath: cache.name,
          cacheExists: async () => (await cache.exists())[0],
          convertAndSave: async () => {
            const [bytes] = await source.download({ start: 0, end: MAX_PREVIEW_INPUT })
            if (bytes.length !== attachment.source.size) throw new HttpsError('aborted', '첨부가 변경됐어요. 다시 열어 주세요.')
            const heapBefore = process.memoryUsage().heapUsed
            const startedAt = Date.now()
            const pdf = await convertDocument(bytes, format)
            await cache.save(pdf, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
              contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-store',
              contentDisposition: 'inline; filename="preview.pdf"',
            } })
            console.info('preview_conversion_completed', {
              sourceBytes: bytes.length, outputBytes: pdf.length,
              durationMs: Date.now() - startedAt, heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
            })
          },
        })
      } catch (error) {
        if (error instanceof HttpsError) throw error
        throw new HttpsError('failed-precondition', '문서를 미리보기로 변환하지 못했어요. PDF 미리보기를 함께 올려 주세요.')
      }
      try {
        await revalidateActor()
        await requireOwnerAttachmentUnchanged(attachment, uid)
      }
      catch (error) {
        await cache.delete({ ignoreNotFound: true })
        throw error
      }
      const [url] = await cache.getSignedUrl({ action: 'read', expires: expiresAtMs })
      return { url, expiresAtMs, renderFormat: 'pdf' as const }
    }
    if (!renderFormat) throw new HttpsError('failed-precondition', '이 형식의 미리보기는 아직 준비되지 않았어요')
    const object = bucket.file(previewObject.path, { generation: previewObject.generation })
    const [url] = await object.getSignedUrl({ action: 'read', expires: expiresAtMs })
    if (renderFormat === 'text' || renderFormat === 'csv') {
      const [bytes] = await object.download({ start: 0, end: 512 * 1024 })
      await revalidateActor()
      await requireOwnerAttachmentUnchanged(attachment, uid)
      try { return { url, expiresAtMs, renderFormat, ...decodePreviewText(bytes) } }
      catch { throw new HttpsError('failed-precondition', 'UTF-8 텍스트 미리보기를 만들지 못했어요. 원본 파일을 확인해 주세요.') }
    }
    await revalidateActor()
    await requireOwnerAttachmentUnchanged(attachment, uid)
    return { url, expiresAtMs, renderFormat }
  },
)

export const createApprovedDownload = onCall({ region: 'asia-northeast3' }, async (request) => {
  const materialId = typeof request.data?.materialId === 'string' ? request.data.materialId.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(materialId)) throw new HttpsError('invalid-argument', '자료를 찾지 못했어요')
  const snapshot = await getFirestore().collection('materials').doc(materialId).get()
  if (!snapshot.exists) throw new HttpsError('not-found', '자료를 찾지 못했어요')
  const data = snapshot.data() as {
    status?: SubmissionStatus
    visibility?: SubmissionVisibility
    rights?: Pick<RightsRecord, 'redistribution'>
    approvedStoragePath?: string
    approvedStorageObjects?: unknown
    attachmentStatus?: unknown
  }
  const visibility = data.visibility ?? 'hold'
  const activeMember = visibility === 'member_only'
    ? Boolean(await requireActorPolicy(request.auth))
    : false
  const generation = data.approvedStoragePath
    ? approvedAttachmentGeneration(data.attachmentStatus, data.approvedStoragePath, data.approvedStorageObjects)
    : null
  if (!attachmentAllowsRead(data.attachmentStatus) || generation === null || !data.approvedStoragePath || !canDownload({
    status: data.status ?? 'draft',
    visibility,
    signedIn: activeMember,
    redistribution: data.rights?.redistribution ?? 'view_only',
  })) throw new HttpsError('permission-denied', '이 자료를 내려받을 수 없어요')

  const expiresAtMs = Date.now() + 5 * 60 * 1_000
  const [url] = await getStorage().bucket().file(data.approvedStoragePath, generation ? { generation } : undefined)
    .getSignedUrl({
      action: 'read',
      expires: expiresAtMs,
      version: 'v4',
      responseDisposition: downloadContentDisposition(data.approvedStoragePath),
    })
  return { url, expiresAtMs }
})

export const createApprovedPreview = onCall({ region: 'asia-northeast3', timeoutSeconds: 120, memory: '1GiB', maxInstances: 4, concurrency: 1 }, async (request) => {
  const materialId = typeof request.data?.materialId === 'string' ? request.data.materialId.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(materialId)) throw new HttpsError('invalid-argument', '자료를 찾지 못했어요')
  const snapshot = await getFirestore().collection('materials').doc(materialId).get()
  if (!snapshot.exists) throw new HttpsError('not-found', '자료를 찾지 못했어요')
  const data = snapshot.data() as {
    status?: SubmissionStatus
    visibility?: SubmissionVisibility
    previewStoragePath?: string
    approvedStoragePath?: string
    approvedStorageObjects?: unknown
    rights?: Pick<RightsRecord, 'redistribution'>
    attachmentStatus?: unknown
  }
  const visibility = data.visibility ?? 'hold'
  const activeMember = visibility === 'member_only'
    ? Boolean(await requireActorPolicy(request.auth))
    : false
  if (
    !attachmentAllowsRead(data.attachmentStatus)
    || !canPreview({
      status: data.status ?? 'draft',
      visibility,
      signedIn: activeMember,
    })
  ) throw new HttpsError('permission-denied', '이 자료의 미리보기를 열 수 없어요')

  const derivedPdf = data.previewStoragePath?.toLowerCase().endsWith('.pdf') ? data.previewStoragePath : undefined
  const derivedGeneration = derivedPdf
    ? approvedAttachmentGeneration(data.attachmentStatus, derivedPdf, data.approvedStorageObjects)
    : undefined
  if (derivedGeneration === null) throw new HttpsError('permission-denied', '이 자료의 미리보기를 열 수 없어요')
  const convertFormat = !derivedPdf && data.approvedStoragePath
    && data.rights?.redistribution !== 'source_link_only' ? conversionFormat(data.approvedStoragePath) : null
  if (convertFormat && data.approvedStoragePath) {
    const bucket = getStorage().bucket()
    try {
      const approvedGeneration = approvedAttachmentGeneration(
        data.attachmentStatus,
        data.approvedStoragePath,
        data.approvedStorageObjects,
      )
      if (approvedGeneration === null) throw new HttpsError('permission-denied', '이 자료의 미리보기를 열 수 없어요')
      const source = bucket.file(data.approvedStoragePath, approvedGeneration ? { generation: approvedGeneration } : undefined)
      const [metadata] = await source.getMetadata()
      const size = Number(metadata.size)
      const generation = String(metadata.generation ?? '')
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PREVIEW_INPUT) throw new Error('invalid_source_size')
      const cache = bucket.file(previewCachePath(materialId, data.approvedStoragePath, generation))
      await coordinatePreviewConversion({
        cachePath: cache.name,
        cacheExists: async () => (await cache.exists())[0],
        convertAndSave: async () => {
          const [bytes] = await source.download({ start: 0, end: MAX_PREVIEW_INPUT })
          if (bytes.length !== size) throw new Error('source_changed')
          const heapBefore = process.memoryUsage().heapUsed
          const startedAt = Date.now()
          const pdf = await convertDocument(bytes, convertFormat)
          await cache.save(pdf, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
            contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-store',
            contentDisposition: 'inline; filename="preview.pdf"',
          } })
          console.info('preview_conversion_completed', {
            sourceBytes: bytes.length, outputBytes: pdf.length,
            durationMs: Date.now() - startedAt, heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
          })
        },
      })
      // Conversion can take seconds: repeat publication, source and membership checks before issuing a URL.
      const current = await getFirestore().collection('materials').doc(materialId).get()
      const latest = current.data() as typeof data | undefined
      const eligible = latest?.visibility === 'member_only' ? Boolean(await requireActorPolicy(request.auth)) : false
      const latestGeneration = latest?.approvedStoragePath
        ? approvedAttachmentGeneration(latest.attachmentStatus, latest.approvedStoragePath, latest.approvedStorageObjects)
        : null
      if (!latest || latest.approvedStoragePath !== data.approvedStoragePath || latestGeneration !== approvedGeneration
        || !attachmentAllowsRead(latest.attachmentStatus)
        || latest.rights?.redistribution === 'source_link_only'
        || !canPreview({ status: latest.status ?? 'draft', visibility: latest.visibility ?? 'hold', signedIn: eligible })) {
        await cache.delete({ ignoreNotFound: true })
        throw new HttpsError('permission-denied', '자료의 공개 상태가 바뀌었어요')
      }
      const [latestMetadata] = await source.getMetadata()
      if (String(latestMetadata.generation) !== generation) throw new HttpsError('aborted', '자료가 변경됐어요. 다시 열어 주세요.')
      const expiresAtMs = Date.now() + 5 * 60_000
      const [url] = await cache.getSignedUrl({ action: 'read', expires: expiresAtMs })
      return { url, expiresAtMs, renderFormat: 'pdf' }
    } catch (error) {
      if (error instanceof HttpsError) throw error
      throw new HttpsError('failed-precondition', '문서를 미리보기로 변환하지 못했어요. 암호·외부 연결이 있는 파일은 PDF로 저장해서 올려 주세요.')
    }
  }
  // Native originals require the existing download permission; view-only is not widened.
  const originalAllowed = data.approvedStoragePath && canDownload({
    status: data.status ?? 'draft', visibility, signedIn: activeMember,
    redistribution: data.rights?.redistribution ?? 'view_only',
  })
  const renderFormat = derivedPdf ? 'pdf' : originalAllowed ? nativePreviewFormat(data.approvedStoragePath!) : null
  const path = derivedPdf ?? (originalAllowed ? data.approvedStoragePath : undefined)
  if (!path || !renderFormat) throw new HttpsError('failed-precondition', '이 형식의 미리보기는 아직 준비되지 않았어요')
  const originalGeneration = !derivedPdf && data.approvedStoragePath
    ? approvedAttachmentGeneration(data.attachmentStatus, data.approvedStoragePath, data.approvedStorageObjects)
    : undefined
  if (originalGeneration === null) throw new HttpsError('permission-denied', '이 자료의 미리보기를 열 수 없어요')
  const generation = derivedPdf ? derivedGeneration : originalGeneration
  const object = getStorage().bucket().file(path, generation ? { generation } : undefined)
  const expiresAtMs = Date.now() + 5 * 60 * 1_000
  const [url] = await object.getSignedUrl({ action: 'read', expires: expiresAtMs })
  if (renderFormat === 'text' || renderFormat === 'csv') {
    // Bounded partial read; full originals remain available via the existing download action.
    const [bytes] = await object.download({ start: 0, end: 512 * 1024 })
    try { return { url, expiresAtMs, renderFormat, ...decodePreviewText(bytes) } }
    catch { throw new HttpsError('failed-precondition', 'UTF-8 텍스트 미리보기를 만들지 못했어요. 원본 파일을 확인해 주세요.') }
  }
  return { url, expiresAtMs, renderFormat }
})
