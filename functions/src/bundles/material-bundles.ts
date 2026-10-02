import { createHash } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { requireActorPolicy } from '../community/actor-policy.js'
import { conversionFormat, convertDocument, MAX_PREVIEW_INPUT, previewCachePath } from '../uploads/document-preview.js'
import { downloadContentDisposition } from '../uploads/download-disposition.js'
import { coordinatePreviewConversion } from '../uploads/preview-coordination.js'
import { decodePreviewText, nativePreviewFormat } from '../uploads/preview-format.js'
import {
  bundleCommandFingerprint,
  bundleTargetName,
  canReadMaterialBundle,
  canReadMaterialBundleFile,
  maximumBundleBytes,
  maximumBundleFiles,
  normalizeBundleFiles,
  normalizeBundleId,
  normalizeBundleMetadata,
  normalizeRequestId,
  projectMaterialBundle,
  stableBundleFileId,
  stableBundleId,
  type MaterialBundleFile,
  type MaterialBundleRecord,
  type MaterialBundleViewer,
} from './contracts.js'

if (!getApps().length) initializeApp()

const reservationTtlMs = 15 * 60_000
const maximumConcurrentReservations = maximumBundleFiles + 1
const maximumActiveReservationBytes = 100 * 1024 * 1024
const maximumDailyReservationBytes = 512 * 1024 * 1024
const usageWindowMs = 24 * 60 * 60_000

type BundleReservationFile = {
  fileId: string
  revision: number
  originalName: string
  displayName: string
  order: number
  sizeBytes: number
  contentType: string
  sha256: string
  targetName: string
  storagePath: string
  reconciled: boolean
}

type BundleReservation = {
  ownerUid: string
  bundleId: string
  requestId: string
  fingerprint: string
  status: 'active' | 'fulfilled' | 'expired'
  totalBytes: number
  quotaBytes?: number
  accountedCommittedBytes?: number
  expiresAtMs: number
  files: Record<string, BundleReservationFile>
}

type BundleUsage = { activeCount: number; activeBytes: number; committedBytes: number; windowStartedAtMs: number }

function normalizedUsage(value: unknown, nowMs: number): BundleUsage {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const integer = (key: string) => Number.isSafeInteger(data[key]) && Number(data[key]) >= 0 ? Number(data[key]) : 0
  const started = integer('windowStartedAtMs')
  const activeWindow = started > 0 && started + usageWindowMs > nowMs
  return {
    activeCount: integer('activeCount'),
    activeBytes: integer('activeBytes'),
    committedBytes: activeWindow ? integer('committedBytes') : 0,
    windowStartedAtMs: activeWindow ? started : nowMs,
  }
}

function reserveUsage(value: BundleUsage, bytes: number): BundleUsage {
  const next = { ...value, activeCount: value.activeCount + 1, activeBytes: value.activeBytes + bytes }
  if (next.activeCount > maximumConcurrentReservations) throw new HttpsError('resource-exhausted', '진행 중인 업로드를 마친 뒤 다시 시도해 주세요')
  if (next.activeBytes > maximumActiveReservationBytes) throw new HttpsError('resource-exhausted', '진행 중인 묶음 업로드 용량이 커요')
  if (next.committedBytes + next.activeBytes > maximumDailyReservationBytes) throw new HttpsError('resource-exhausted', '이 계정의 하루 업로드 한도에 도달했어요')
  return next
}

function releaseUsage(value: BundleUsage, bytes: number, committedBytes: number): BundleUsage {
  return {
    ...value,
    activeCount: Math.max(0, value.activeCount - 1),
    activeBytes: Math.max(0, value.activeBytes - bytes),
    committedBytes: value.committedBytes + committedBytes,
  }
}

function bundleReservationId(uid: string, bundleId: string, requestId: string): string {
  return createHash('sha256').update(`material-bundle-reservation:${uid}:${bundleId}:${requestId}`).digest('hex').slice(0, 40)
}

function commandId(uid: string, action: string, requestId: string): string {
  return createHash('sha256').update(`material-bundle-command:${uid}:${action}:${requestId}`).digest('hex')
}

function recordFrom(snapshot: { exists: boolean; data(): Record<string, unknown> | undefined }): MaterialBundleRecord | null {
  if (!snapshot.exists) return null
  const data = snapshot.data() ?? {}
  if (typeof data.ownerUid !== 'string' || typeof data.title !== 'string' || typeof data.description !== 'string'
    || !data.files || typeof data.files !== 'object' || !Number.isSafeInteger(data.createdAtMs) || !Number.isSafeInteger(data.updatedAtMs)) return null
  return data as unknown as MaterialBundleRecord
}

function reservationFrom(snapshot: { exists: boolean; data(): Record<string, unknown> | undefined }): BundleReservation | null {
  if (!snapshot.exists) return null
  const data = snapshot.data() ?? {}
  if (typeof data.ownerUid !== 'string' || typeof data.bundleId !== 'string' || typeof data.requestId !== 'string'
    || typeof data.fingerprint !== 'string' || !Number.isSafeInteger(data.totalBytes) || !Number.isSafeInteger(data.expiresAtMs)
    || !data.files || typeof data.files !== 'object'
    || (data.status !== 'active' && data.status !== 'fulfilled' && data.status !== 'expired')) return null
  return data as unknown as BundleReservation
}

function assertOwner(bundle: MaterialBundleRecord | null, uid: string): asserts bundle is MaterialBundleRecord {
  if (!bundle || bundle.ownerUid !== uid) throw new HttpsError('permission-denied', '내 자료 묶음만 바꿀 수 있어요')
  if (bundle.status === 'withdrawn') throw new HttpsError('failed-precondition', '회수한 자료 묶음은 바꿀 수 없어요')
}

export const createMaterialBundle = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const requestId = normalizeRequestId(request.data?.requestId)
  const metadata = normalizeBundleMetadata(request.data)
  const fingerprint = bundleCommandFingerprint(metadata)
  const bundleId = stableBundleId(uid, requestId)
  const firestore = getFirestore()
  const ref = firestore.collection('materialBundles').doc(bundleId)
  const commandRef = firestore.collection('materialBundleCommands').doc(commandId(uid, 'create', requestId))
  const nowMs = Date.now()
  await firestore.runTransaction(async (transaction) => {
    const [bundle, command] = await Promise.all([transaction.get(ref), transaction.get(commandRef)])
    if (command.exists) {
      if (command.get('fingerprint') !== fingerprint || command.get('bundleId') !== bundleId) {
        throw new HttpsError('already-exists', '같은 요청 식별자로 다른 묶음을 만들 수 없어요')
      }
      return
    }
    if (bundle.exists) throw new HttpsError('already-exists', '자료 묶음이 이미 있어요')
    transaction.create(ref, {
      ownerUid: uid, ...metadata, status: 'draft', files: {}, createdAtMs: nowMs, updatedAtMs: nowMs,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(commandRef, { uid, action: 'create', requestId, bundleId, fingerprint, at: FieldValue.serverTimestamp() })
    transaction.create(firestore.collection('auditEvents').doc(), { type: 'material_bundle.created', uid, bundleId, at: FieldValue.serverTimestamp() })
  })
  return { bundleId, status: 'draft' as const }
})

export const prepareMaterialBundleFiles = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const bundleId = normalizeBundleId(request.data?.bundleId)
  const requestId = normalizeRequestId(request.data?.requestId)
  const inputFiles = normalizeBundleFiles(request.data?.files)
  const firestore = getFirestore()
  const bundleRef = firestore.collection('materialBundles').doc(bundleId)
  const reservationId = bundleReservationId(uid, bundleId, requestId)
  const reservationRef = firestore.collection('materialBundleUploadReservations').doc(reservationId)
  const usageRef = firestore.collection('materialBundleUploadUsage').doc(uid)
  const commandRef = firestore.collection('materialBundleCommands').doc(commandId(uid, `prepare:${bundleId}`, requestId))
  const nowMs = Date.now()
  const expiresAtMs = nowMs + reservationTtlMs
  let persistedExpiresAtMs = expiresAtMs
  let prepared: BundleReservationFile[] = []
  const requestFingerprint = bundleCommandFingerprint(inputFiles)
  await firestore.runTransaction(async (transaction) => {
    const [bundleSnapshot, reservationSnapshot, usageSnapshot, command, priorReservations] = await Promise.all([
      transaction.get(bundleRef), transaction.get(reservationRef), transaction.get(usageRef), transaction.get(commandRef),
      transaction.get(firestore.collection('materialBundleUploadReservations').where('bundleId', '==', bundleId).where('status', '==', 'active')),
    ])
    const bundle = recordFrom(bundleSnapshot)
    assertOwner(bundle, uid)
    if (command.exists) {
      if (command.get('fingerprint') !== requestFingerprint || command.get('reservationId') !== reservationId) {
        throw new HttpsError('already-exists', '같은 요청 식별자로 다른 파일을 준비할 수 없어요')
      }
      const existing = reservationFrom(reservationSnapshot)
      if (!existing) throw new HttpsError('aborted', '업로드 예약을 다시 시작해 주세요')
      prepared = Object.values(existing.files)
      persistedExpiresAtMs = existing.expiresAtMs
      return
    }
    if (reservationSnapshot.exists) throw new HttpsError('already-exists', '같은 업로드 예약이 이미 있어요')

    const files = { ...bundle.files }
    const touched = new Set<string>()
    prepared = inputFiles.map((input): BundleReservationFile => {
      const fileId = input.replaceFileId ?? stableBundleFileId(uid, bundleId, input.clientFileId)
      if (touched.has(fileId)) throw new HttpsError('invalid-argument', '같은 파일을 한 요청에서 두 번 바꿀 수 없어요')
      touched.add(fileId)
      const current = files[fileId]
      if (input.replaceFileId && (!current || current.status === 'withdrawn')) throw new HttpsError('not-found', '교체할 파일을 찾지 못했어요')
      if (!input.replaceFileId && current && current.status !== 'withdrawn') throw new HttpsError('already-exists', '이미 추가한 파일은 교체 또는 재시도로 올려 주세요')
      const revision = current ? current.revision + 1 : 1
      const targetName = bundleTargetName({ requestId, fileId, revision, sha256: input.sha256, name: input.originalName })
      const storagePath = `quarantined/${uid}/material-bundles/${bundleId}/${fileId}/${targetName}`
      files[fileId] = {
        fileId, clientFileId: current?.clientFileId ?? input.clientFileId, revision,
        originalName: input.originalName, displayName: input.displayName, order: input.order,
        sizeBytes: input.sizeBytes, contentType: input.contentType, sha256: input.sha256,
        status: 'upload_pending', scanStatus: 'pending', storagePath, updatedAtMs: nowMs,
      }
      if (current?.storagePath && current.generation) {
        const cleanupId = createHash('sha256').update(`${current.storagePath}:${current.generation}`).digest('hex')
        transaction.set(firestore.collection('materialBundleObjectCleanupJobs').doc(cleanupId), {
          ownerUid: uid, bundleId, fileId, storagePath: current.storagePath, generation: current.generation,
          status: 'queued', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      return {
        fileId, revision, originalName: input.originalName, displayName: input.displayName, order: input.order,
        sizeBytes: input.sizeBytes, contentType: input.contentType, sha256: input.sha256,
        targetName, storagePath, reconciled: false,
      }
    })
    const activeFiles = Object.values(files).filter((file) => file.status !== 'withdrawn')
    const totalStoredBytes = activeFiles.reduce((sum, file) => sum + file.sizeBytes, 0)
    if (activeFiles.length > maximumBundleFiles) throw new HttpsError('resource-exhausted', '한 묶음에는 파일을 10개까지 담을 수 있어요')
    if (totalStoredBytes > maximumBundleBytes) throw new HttpsError('resource-exhausted', '한 묶음의 파일 합계는 100MB까지예요')
    const totalBytes = prepared.reduce((sum, file) => sum + file.sizeBytes, 0)
    let usage = normalizedUsage(usageSnapshot.data(), nowMs)
    // Replaced or expired uploads must not keep charging the user's retry budget.
    // Existing reservations without accounting fields are reconciled lazily here.
    for (const snapshot of priorReservations.docs) {
      const prior = reservationFrom(snapshot)
      if (!prior || prior.ownerUid !== uid) continue
      const committed = Object.values(prior.files).filter(file => file.reconciled).reduce((sum, file) => sum + file.sizeBytes, 0)
      const remaining = Object.values(prior.files).filter(file => {
        const current = files[file.fileId]
        return !file.reconciled && prior.expiresAtMs > nowMs && current?.status !== 'withdrawn'
          && current?.revision === file.revision && current?.storagePath === file.storagePath
      }).reduce((sum, file) => sum + file.sizeBytes, 0)
      usage = {
        ...usage,
        activeCount: Math.max(0, usage.activeCount - (remaining === 0 ? 1 : 0)),
        activeBytes: Math.max(0, usage.activeBytes - (prior.quotaBytes ?? prior.totalBytes) + remaining),
        committedBytes: usage.committedBytes + Math.max(0, committed - (prior.accountedCommittedBytes ?? 0)),
      }
      transaction.update(snapshot.ref, {
        quotaBytes: remaining, accountedCommittedBytes: committed,
        ...(remaining === 0 ? {status: 'expired', expiredAt: FieldValue.serverTimestamp()} : {}),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    usage = reserveUsage(usage, totalBytes)
    const reservationFiles = Object.fromEntries(prepared.map((file) => [file.targetName, file]))
    transaction.create(reservationRef, {
      ownerUid: uid, bundleId, requestId, fingerprint: requestFingerprint, status: 'active', totalBytes, quotaBytes: totalBytes, accountedCommittedBytes: 0,
      expiresAtMs, expiresAt: Timestamp.fromMillis(expiresAtMs), cleanupDueAt: Timestamp.fromMillis(expiresAtMs),
      files: reservationFiles, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(usageRef, { ...usage, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    transaction.update(bundleRef, { files, updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() })
    transaction.create(commandRef, {
      uid, action: 'prepare_files', requestId, bundleId, reservationId, fingerprint: requestFingerprint, at: FieldValue.serverTimestamp(),
    })
  })
  return {
    bundleId, reservationId, expiresAtMs: persistedExpiresAtMs,
    files: prepared.map((file) => ({
      clientFileId: inputFiles.find((input) => (input.replaceFileId ?? stableBundleFileId(uid, bundleId, input.clientFileId)) === file.fileId)?.clientFileId,
      fileId: file.fileId, revision: file.revision, targetName: file.targetName, storagePath: file.storagePath, sha256: file.sha256,
    })),
  }
})

export async function recordUploadedMaterialBundleObject(input: {
  ownerUid: string; bundleId: string; fileId: string; revision: number; targetName: string; storagePath: string
  generation: string; size: number; contentType: string; reservationId: string; requestId: string; sha256: string
}): Promise<boolean> {
  const firestore = getFirestore()
  const reservationRef = firestore.collection('materialBundleUploadReservations').doc(input.reservationId)
  const bundleRef = firestore.collection('materialBundles').doc(input.bundleId)
  const usageRef = firestore.collection('materialBundleUploadUsage').doc(input.ownerUid)
  return firestore.runTransaction(async (transaction) => {
    const [reservationSnapshot, bundleSnapshot, usageSnapshot] = await Promise.all([
      transaction.get(reservationRef), transaction.get(bundleRef), transaction.get(usageRef),
    ])
    const reservation = reservationFrom(reservationSnapshot)
    const bundle = recordFrom(bundleSnapshot)
    const selected = reservation?.files[input.targetName]
    const current = bundle?.files[input.fileId]
    if (!reservation || !bundle || reservation.ownerUid !== input.ownerUid || reservation.bundleId !== input.bundleId
      || reservation.requestId !== input.requestId || (reservation.status !== 'active' && reservation.status !== 'fulfilled')
      || (reservation.status === 'active' && reservation.expiresAtMs <= Date.now())
      || !selected || selected.fileId !== input.fileId || selected.revision !== input.revision || selected.storagePath !== input.storagePath
      || selected.sizeBytes !== input.size || selected.contentType !== input.contentType || selected.sha256 !== input.sha256
      || bundle.ownerUid !== input.ownerUid || !current || current.revision !== input.revision || current.storagePath !== input.storagePath
      || current.sha256 !== input.sha256 || current.status === 'withdrawn'
      || (current.generation !== undefined && current.generation !== input.generation)) return false
    if (selected.reconciled) return current.generation === input.generation
    if (selected.reconciled || reservation.status !== 'active') return false
    const files = { ...reservation.files, [input.targetName]: { ...selected, reconciled: true } }
    const remainingBytes = Math.max(0, (reservation.quotaBytes ?? reservation.totalBytes) - selected.sizeBytes)
    const committedBytes = Object.values(files).filter(file => file.reconciled).reduce((sum, file) => sum + file.sizeBytes, 0)
    const fulfilled = remainingBytes === 0
    const nowMs = Date.now()
    transaction.update(reservationRef, {
      files, quotaBytes: remainingBytes, accountedCommittedBytes: committedBytes, ...(fulfilled ? { status: 'fulfilled', fulfilledAt: FieldValue.serverTimestamp(), cleanupDueAt: FieldValue.delete() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })
    const usage = normalizedUsage(usageSnapshot.data(), nowMs)
    transaction.set(usageRef, {
      ...usage,
      activeCount: Math.max(0, usage.activeCount - (fulfilled ? 1 : 0)),
      activeBytes: Math.max(0, usage.activeBytes - ((reservation.quotaBytes ?? reservation.totalBytes) - remainingBytes)),
      committedBytes: usage.committedBytes + Math.max(0, committedBytes - (reservation.accountedCommittedBytes ?? 0)),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    transaction.update(bundleRef, {
      [`files.${input.fileId}.status`]: 'scanning', [`files.${input.fileId}.scanStatus`]: 'pending',
      [`files.${input.fileId}.generation`]: input.generation, [`files.${input.fileId}.updatedAtMs`]: nowMs,
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    })
    return true
  })
}

export async function recordMaterialBundleScanResult(input: {
  ownerUid: string; bundleId: string; fileId: string; path: string; generation: string; scanId: string; verdict: 'clean' | 'blocked'
}) {
  const firestore = getFirestore()
  const ref = firestore.collection('materialBundles').doc(input.bundleId)
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const bundle = recordFrom(snapshot)
    const file = bundle?.files[input.fileId]
    if (!bundle || bundle.ownerUid !== input.ownerUid || !file || file.storagePath !== input.path || file.generation !== input.generation
      || file.status === 'withdrawn') return
    const nowMs = Date.now()
    transaction.update(ref, {
      [`files.${input.fileId}.status`]: input.verdict === 'clean' ? 'ready' : 'blocked',
      [`files.${input.fileId}.scanStatus`]: input.verdict,
      [`files.${input.fileId}.scanId`]: input.scanId,
      [`files.${input.fileId}.updatedAtMs`]: nowMs,
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(firestore.collection('auditEvents').doc(), {
      type: 'material_bundle.file_scan_recorded', bundleId: input.bundleId, fileId: input.fileId,
      revision: file.revision, scanId: input.scanId, verdict: input.verdict, at: FieldValue.serverTimestamp(),
    })
  })
}

export async function recordMaterialBundleScanFailure(input: {
  ownerUid: string; bundleId: string; fileId: string; path: string; generation: string; code: string
}) {
  const firestore = getFirestore()
  const ref = firestore.collection('materialBundles').doc(input.bundleId)
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const bundle = recordFrom(snapshot)
    const file = bundle?.files[input.fileId]
    if (!bundle || bundle.ownerUid !== input.ownerUid || !file || file.storagePath !== input.path || file.generation !== input.generation
      || file.status === 'withdrawn') return
    const nowMs = Date.now()
    transaction.update(ref, {
      [`files.${input.fileId}.status`]: 'error', [`files.${input.fileId}.scanStatus`]: 'error',
      [`files.${input.fileId}.updatedAtMs`]: nowMs, updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(firestore.collection('materialBundleOperatorExceptions').doc(`${input.bundleId}_${input.fileId}`), {
      bundleId: input.bundleId, fileId: input.fileId, type: 'scan_failed', status: 'open', code: input.code.slice(0, 160),
      updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })
}

export const finalizeMaterialBundle = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const bundleId = normalizeBundleId(request.data?.bundleId)
  const requestId = normalizeRequestId(request.data?.requestId)
  const firestore = getFirestore()
  const ref = firestore.collection('materialBundles').doc(bundleId)
  const commandRef = firestore.collection('materialBundleCommands').doc(commandId(uid, `finalize:${bundleId}`, requestId))
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, command] = await Promise.all([transaction.get(ref), transaction.get(commandRef)])
    const bundle = recordFrom(snapshot)
    assertOwner(bundle, uid)
    if (command.exists) return
    if (!Object.values(bundle.files).some((file) => file.status !== 'withdrawn')) throw new HttpsError('failed-precondition', '파일을 하나 이상 올려 주세요')
    const nowMs = Date.now()
    transaction.update(ref, { status: 'active', submittedAt: FieldValue.serverTimestamp(), updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() })
    transaction.create(commandRef, { uid, action: 'finalize', requestId, bundleId, fingerprint: 'finalize', at: FieldValue.serverTimestamp() })
  })
  return { bundleId, status: 'active' as const }
})

async function viewerFor(auth: Parameters<typeof requireActorPolicy>[0]): Promise<MaterialBundleViewer> {
  if (!auth) return {}
  const actor = await requireActorPolicy(auth)
  return { uid: actor.uid, activeMember: true }
}

export const getMaterialBundle = onCall({ region: 'asia-northeast3' }, async (request) => {
  const bundleId = normalizeBundleId(request.data?.bundleId)
  const snapshot = await getFirestore().collection('materialBundles').doc(bundleId).get()
  const bundle = recordFrom(snapshot)
  if (!bundle) throw new HttpsError('not-found', '자료 묶음을 찾지 못했어요')
  const viewer = await viewerFor(request.auth)
  if (!canReadMaterialBundle(bundle, viewer)) throw new HttpsError('permission-denied', '이 자료 묶음을 볼 수 없어요')
  return projectMaterialBundle(bundleId, bundle, viewer.uid === bundle.ownerUid)
})

export const listMyMaterialBundles = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const requestedLimit = Number(request.data?.limit ?? 20)
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 20
  let query = getFirestore().collection('materialBundles').where('ownerUid', '==', uid)
    .orderBy('updatedAtMs', 'desc').orderBy(FieldPath.documentId(), 'desc')
  const cursor = request.data?.cursor
  if (typeof cursor === 'string') {
    try {
      if (cursor.length > 512) throw new Error('cursor too long')
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      if (!Number.isSafeInteger(parsed.time) || typeof parsed.id !== 'string' || !parsed.id || parsed.id.includes('/')) throw new Error('invalid cursor')
      query = query.startAfter(parsed.time, parsed.id)
    } catch { throw new HttpsError('invalid-argument', '목록 위치를 확인하지 못했어요') }
  } else if (Number.isSafeInteger(cursor)) query = query.startAfter(Number(cursor))
  const snapshots = await query.limit(limit + 1).get()
  const page = snapshots.docs.slice(0, limit)
  const records = page.map((snapshot) => ({ id: snapshot.id, bundle: recordFrom(snapshot) }))
    .filter((item): item is { id: string; bundle: MaterialBundleRecord } => Boolean(item.bundle))
  const last = page.at(-1)
  return {
    items: records.map((item) => projectMaterialBundle(item.id, item.bundle, true)),
    nextCursor: snapshots.size > limit && last
      ? Buffer.from(JSON.stringify({ time: last.get('updatedAtMs'), id: last.id })).toString('base64url') : null,
  }
})

function normalizeFileEdits(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumBundleFiles) {
    throw new HttpsError('invalid-argument', '바꿀 파일 정보를 확인해 주세요')
  }
  const changes = value.map((raw: unknown) => {
    const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const fileId = typeof data.fileId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(data.fileId) ? data.fileId : ''
    const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : ''
    const order = Number(data.order)
    if (!fileId || !displayName || displayName.length > 160 || !Number.isSafeInteger(order) || order < 0) {
      throw new HttpsError('invalid-argument', '파일 표시 이름과 순서를 확인해 주세요')
    }
    return { fileId, displayName, order }
  })
  if(new Set(changes.map(item=>item.fileId)).size!==changes.length || new Set(changes.map(item=>item.order)).size!==changes.length)throw new HttpsError('invalid-argument','파일 이름과 순서가 중복되지 않도록 확인해 주세요')
  return changes
}

export const updateMaterialBundle = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const bundleId = normalizeBundleId(request.data?.bundleId)
  const requestId = normalizeRequestId(request.data?.requestId)
  const metadata = normalizeBundleMetadata(request.data)
  const fileEdits = request.data?.fileEdits === undefined ? undefined : normalizeFileEdits(request.data.fileEdits)
  const fingerprint = bundleCommandFingerprint(fileEdits ? {metadata,fileEdits} : metadata)
  const firestore = getFirestore()
  const ref = firestore.collection('materialBundles').doc(bundleId)
  const commandRef = firestore.collection('materialBundleCommands').doc(commandId(uid, `update:${bundleId}`, requestId))
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, command] = await Promise.all([transaction.get(ref), transaction.get(commandRef)])
    const bundle = recordFrom(snapshot)
    assertOwner(bundle, uid)
    if (command.exists) {
      if (command.get('fingerprint') !== fingerprint) throw new HttpsError('already-exists', '같은 요청 식별자로 다른 내용을 저장할 수 없어요')
      return
    }
    const nowMs = Date.now()
    const files = {...bundle.files}
    for(const edit of fileEdits ?? []) {
      if(!files[edit.fileId] || files[edit.fileId].status==='withdrawn')throw new HttpsError('not-found','바꿀 파일을 찾지 못했어요')
      files[edit.fileId]={...files[edit.fileId],displayName:edit.displayName,order:edit.order,updatedAtMs:nowMs}
    }
    transaction.update(ref, { ...metadata, ...(fileEdits ? {files} : {}), updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() })
    transaction.create(commandRef, { uid, action: 'update', requestId, bundleId, fingerprint, at: FieldValue.serverTimestamp() })
  })
  return { bundleId }
})

export const updateMaterialBundleFiles = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const bundleId = normalizeBundleId(request.data?.bundleId)
  const requestId = normalizeRequestId(request.data?.requestId)
  const changes = normalizeFileEdits(request.data?.files)
  const fingerprint = bundleCommandFingerprint(changes)
  const firestore = getFirestore()
  const ref = firestore.collection('materialBundles').doc(bundleId)
  const commandRef = firestore.collection('materialBundleCommands').doc(commandId(uid, `files:${bundleId}`, requestId))
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, command] = await Promise.all([transaction.get(ref), transaction.get(commandRef)])
    const bundle = recordFrom(snapshot)
    assertOwner(bundle, uid)
    if (command.exists) {
      if (command.get('fingerprint') !== fingerprint) throw new HttpsError('already-exists', '같은 요청 식별자로 다른 순서를 저장할 수 없어요')
      return
    }
    const files = { ...bundle.files }
    for (const change of changes) {
      if (!files[change.fileId] || files[change.fileId].status === 'withdrawn') throw new HttpsError('not-found', '바꿀 파일을 찾지 못했어요')
      files[change.fileId] = { ...files[change.fileId], displayName: change.displayName, order: change.order, updatedAtMs: Date.now() }
    }
    const nowMs = Date.now()
    transaction.update(ref, { files, updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() })
    transaction.create(commandRef, { uid, action: 'files', requestId, bundleId, fingerprint, at: FieldValue.serverTimestamp() })
  })
  return { bundleId }
})

export const withdrawMaterialBundleFile = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const bundleId = normalizeBundleId(request.data?.bundleId)
  const requestId = normalizeRequestId(request.data?.requestId)
  const fileId = typeof request.data?.fileId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(request.data.fileId) ? request.data.fileId : ''
  if (!fileId) throw new HttpsError('invalid-argument', '회수할 파일을 확인해 주세요')
  const firestore = getFirestore()
  const ref = firestore.collection('materialBundles').doc(bundleId)
  const commandRef = firestore.collection('materialBundleCommands').doc(commandId(uid, `withdraw:${bundleId}:${fileId}`, requestId))
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, command] = await Promise.all([transaction.get(ref), transaction.get(commandRef)])
    const bundle = recordFrom(snapshot)
    assertOwner(bundle, uid)
    if (command.exists) return
    const file = bundle.files[fileId]
    if (!file) throw new HttpsError('not-found', '회수할 파일을 찾지 못했어요')
    const nowMs = Date.now()
    transaction.update(ref, {
      [`files.${fileId}.status`]: 'withdrawn', [`files.${fileId}.updatedAtMs`]: nowMs,
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    })
    if (file.storagePath && file.generation) {
      const cleanupId = createHash('sha256').update(`${file.storagePath}:${file.generation}`).digest('hex')
      transaction.set(firestore.collection('materialBundleObjectCleanupJobs').doc(cleanupId), {
        ownerUid: uid, bundleId, fileId, storagePath: file.storagePath, generation: file.generation,
        status: 'queued', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    transaction.create(commandRef, { uid, action: 'withdraw_file', requestId, bundleId, fingerprint: fileId, at: FieldValue.serverTimestamp() })
    transaction.create(firestore.collection('auditEvents').doc(), { type: 'material_bundle.file_withdrawn', uid, bundleId, fileId, at: FieldValue.serverTimestamp() })
  })
  return { bundleId, fileId, status: 'withdrawn' as const }
})

async function loadAccessibleFile(bundleId: string, fileId: string, auth: Parameters<typeof requireActorPolicy>[0]) {
  const snapshot = await getFirestore().collection('materialBundles').doc(bundleId).get()
  const bundle = recordFrom(snapshot)
  if (!bundle) throw new HttpsError('not-found', '자료 묶음을 찾지 못했어요')
  const viewer = await viewerFor(auth)
  const file = bundle.files[fileId]
  if (!file || !canReadMaterialBundleFile(bundle, file, viewer) || !file.storagePath || !file.generation) {
    throw new HttpsError('permission-denied', '안전 검사를 마친 현재 파일만 열 수 있어요')
  }
  return { bundle, file }
}

async function requireFileUnchanged(bundleId: string, expected: MaterialBundleFile, auth: Parameters<typeof requireActorPolicy>[0]) {
  const current = await loadAccessibleFile(bundleId, expected.fileId, auth)
  if (current.file.revision !== expected.revision || current.file.storagePath !== expected.storagePath || current.file.generation !== expected.generation
    || current.file.scanId !== expected.scanId) throw new HttpsError('aborted', '파일 상태가 바뀌었어요. 다시 열어 주세요')
}

export const createMaterialBundleFileAccess = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 120, memory: '1GiB', maxInstances: 4, concurrency: 1 },
  async (request) => {
    const bundleId = normalizeBundleId(request.data?.bundleId)
    const fileId = typeof request.data?.fileId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(request.data.fileId) ? request.data.fileId : ''
    const action = request.data?.action
    if (!fileId || (action !== 'preview' && action !== 'download')) throw new HttpsError('invalid-argument', '열 파일과 방식을 확인해 주세요')
    const { bundle, file } = await loadAccessibleFile(bundleId, fileId, request.auth)
    if (action === 'download' && bundle.rights.redistribution !== 'download_allowed') {
      throw new HttpsError('permission-denied', '이 파일은 내려받을 수 없어요')
    }
    const bucket = getStorage().bucket()
    const source = bucket.file(file.storagePath!, { generation: file.generation })
    const expiresAtMs = Date.now() + 5 * 60_000
    if (action === 'download') {
      const [url] = await source.getSignedUrl({ action: 'read', expires: expiresAtMs, version: 'v4', responseDisposition: downloadContentDisposition(file.originalName) })
      await requireFileUnchanged(bundleId, file, request.auth)
      return { url, expiresAtMs, renderFormat: 'download' as const, fileName: file.originalName }
    }
    const native = nativePreviewFormat(file.originalName)
    const format = conversionFormat(file.originalName)
    if (format) {
      const cache = bucket.file(previewCachePath(`${bundleId}_${fileId}`, file.storagePath!, file.generation!))
      try {
        await coordinatePreviewConversion({
          cachePath: cache.name,
          cacheExists: async () => (await cache.exists())[0],
          convertAndSave: async () => {
            const [bytes] = await source.download({ start: 0, end: MAX_PREVIEW_INPUT })
            if (bytes.length !== file.sizeBytes) throw new HttpsError('aborted', '파일이 변경됐어요. 다시 열어 주세요')
            const pdf = await convertDocument(bytes, format)
            await cache.save(pdf, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
              contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-store', contentDisposition: 'inline; filename="preview.pdf"',
            } })
          },
        })
      } catch (error) {
        if (error instanceof HttpsError) throw error
        throw new HttpsError('failed-precondition', '문서 미리보기를 만들지 못했어요')
      }
      try { await requireFileUnchanged(bundleId, file, request.auth) }
      catch (error) { await cache.delete({ ignoreNotFound: true }); throw error }
      const [url] = await cache.getSignedUrl({ action: 'read', expires: expiresAtMs })
      return { url, expiresAtMs, renderFormat: 'pdf' as const }
    }
    if (!native) throw new HttpsError('failed-precondition', '이 형식은 미리보기를 지원하지 않아요')
    const [url] = await source.getSignedUrl({ action: 'read', expires: expiresAtMs })
    if (native === 'text' || native === 'csv') {
      const [bytes] = await source.download({ start: 0, end: 512 * 1024 })
      await requireFileUnchanged(bundleId, file, request.auth)
      try { return { url, expiresAtMs, renderFormat: native, ...decodePreviewText(bytes) } }
      catch { throw new HttpsError('failed-precondition', 'UTF-8 텍스트 미리보기를 만들지 못했어요') }
    }
    await requireFileUnchanged(bundleId, file, request.auth)
    return { url, expiresAtMs, renderFormat: native }
  },
)

export const cleanupMaterialBundleUploads = onSchedule(
  { schedule: 'every 15 minutes', region: 'asia-northeast3', timeZone: 'Asia/Seoul', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const firestore = getFirestore()
    const nowMs = Date.now()
    const reservations = await firestore.collection('materialBundleUploadReservations')
      .where('status', '==', 'active')
      .where('expiresAtMs', '<=', nowMs)
      .orderBy('expiresAtMs', 'asc')
      .limit(100)
      .get()
    for (const snapshot of reservations.docs) {
      const reservation = reservationFrom(snapshot)
      if (!reservation || reservation.expiresAtMs > nowMs) continue
      const bundleRef = firestore.collection('materialBundles').doc(reservation.bundleId)
      const usageRef = firestore.collection('materialBundleUploadUsage').doc(reservation.ownerUid)
      const paths: Array<{ path: string; generation?: string }> = []
      await firestore.runTransaction(async (transaction) => {
        const [fresh, bundleSnapshot, usageSnapshot] = await Promise.all([
          transaction.get(snapshot.ref), transaction.get(bundleRef), transaction.get(usageRef),
        ])
        const currentReservation = reservationFrom(fresh)
        const bundle = recordFrom(bundleSnapshot)
        if (!currentReservation || currentReservation.status !== 'active' || currentReservation.expiresAtMs > Date.now()) return
        const files = bundle ? { ...bundle.files } : null
        for (const selected of Object.values(currentReservation.files)) {
          const current = files?.[selected.fileId]
          if (current && current.revision === selected.revision && current.storagePath === selected.storagePath && current.status === 'upload_pending') {
            files![selected.fileId] = { ...current, status: 'error', scanStatus: 'error', updatedAtMs: nowMs }
          }
          if (!selected.reconciled) paths.push({ path: selected.storagePath, generation: current?.generation })
        }
        transaction.update(snapshot.ref, { status: 'expired', expiredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
        transaction.set(usageRef, {
          ...releaseUsage(
            normalizedUsage(usageSnapshot.data(), nowMs),
            currentReservation.quotaBytes ?? currentReservation.totalBytes,
            Math.max(0, Object.values(currentReservation.files).filter((file) => file.reconciled).reduce((sum, file) => sum + file.sizeBytes, 0) - (currentReservation.accountedCommittedBytes ?? 0)),
          ),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        if (files) transaction.update(bundleRef, { files, updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() })
      })
      await Promise.all(paths.map(({ path, generation }) => getStorage().bucket().file(path, generation ? { generation } : undefined).delete({ ignoreNotFound: true }).catch(() => undefined)))
    }
    const jobs = await firestore.collection('materialBundleObjectCleanupJobs').where('status', '==', 'queued').limit(100).get()
    for (const job of jobs.docs) {
      const path = job.get('storagePath')
      const generation = job.get('generation')
      if (typeof path !== 'string' || typeof generation !== 'string') { await job.ref.delete(); continue }
      try {
        await getStorage().bucket().file(path, { generation }).delete({ ignoreNotFound: true, ifGenerationMatch: generation })
        await job.ref.update({ status: 'complete', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      } catch (error) {
        const attempts = Number(job.get('attempts') ?? 0) + 1
        await job.ref.update({
          attempts,
          ...(attempts >= 5 ? { status: 'failed' } : {}),
          lastError: String(error).slice(0, 160),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    }
  },
)
