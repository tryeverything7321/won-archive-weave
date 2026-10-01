import { createHash, randomUUID } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { requireActorPolicy } from '../community/actor-policy.js'
import { validateUploadDescriptor } from './contracts.js'
import { operatorModerationBlocksPublication } from './content-moderation.js'
import {
  expireUploadReservationCapacity,
  fulfillUploadReservationCapacity,
  normalizedUploadReservationUsage,
  reserveUploadCapacity,
  uploadReservationTtlMs,
} from './upload-reservation.js'

if (!getApps().length) initializeApp()

type SelectionFile = { name: string; targetName: string; size: number; contentType: string; sha256: string }
export type UploadSelection = { requestId: string; files: SelectionFile[] }

export function normalizeUploadSelection(value: unknown): UploadSelection {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const requestId = typeof data.requestId === 'string' ? data.requestId : ''
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestId) || !Array.isArray(data.files) || data.files.length < 1 || data.files.length > 2) {
    throw new HttpsError('invalid-argument', '원본 파일과 선택한 미리보기 파일을 확인해 주세요')
  }
  const files = data.files.map((raw): SelectionFile => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const name = typeof item.name === 'string' ? item.name : ''
    const contentType = typeof item.contentType === 'string' ? item.contentType : ''
    const sha256 = typeof item.sha256 === 'string' ? item.sha256 : ''
    const size = Number(item.size)
    const unsafeName = name.includes('/') || name.includes('\\') || [...name].some((character) => character.charCodeAt(0) < 32)
    if (!Number.isSafeInteger(item.size) || !name || name.length > 220 || unsafeName || name.includes('..') || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new HttpsError('invalid-argument', '파일 이름과 식별 정보를 확인해 주세요')
    }
    try { validateUploadDescriptor({ name, contentType, size }) } catch {
      throw new HttpsError('invalid-argument', '지원하는 형식의 20MB 이하 파일을 선택해 주세요')
    }
    const prefix = createHash('sha256').update(`${requestId}:${name}:${sha256}`).digest('hex').slice(0, 24)
    return { name, targetName: `u${prefix}--${name}`, size, contentType, sha256 }
  })
  if (new Set(files.map((file) => file.name)).size !== files.length) throw new HttpsError('invalid-argument', '파일 이름이 겹치지 않도록 해 주세요')
  return { requestId, files }
}

export function selectedUploadNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  const parsed = normalizeUploadSelection(value)
  const stored = value as UploadSelection
  if (stored.files.some((file, index) => file.targetName !== parsed.files[index].targetName)) {
    throw new HttpsError('failed-precondition', '첨부 파일 선택 정보가 일치하지 않아요')
  }
  return parsed.files.map((file) => file.targetName)
}

export function uploadSelectionFingerprint(value: UploadSelection): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

type StoredUploadReservation = {
  ownerUid: string
  submissionId: string
  requestId: string
  fingerprint: string
  status: 'active' | 'fulfilled' | 'superseded' | 'expired'
  totalBytes: number
  expiresAtMs: number
  files: Record<string, SelectionFile & { reconciled: boolean }>
}

function uploadReservationId(uid: string, submissionId: string, requestId: string): string {
  return createHash('sha256').update(`upload-reservation:${uid}:${submissionId}:${requestId}`).digest('hex').slice(0, 40)
}

function storedReservation(snapshot: { exists: boolean; data(): Record<string, unknown> | undefined }): StoredUploadReservation | null {
  if (!snapshot.exists) return null
  const value = snapshot.data() ?? {}
  if (typeof value.ownerUid !== 'string' || typeof value.submissionId !== 'string' || typeof value.requestId !== 'string'
    || typeof value.fingerprint !== 'string' || !Number.isSafeInteger(value.totalBytes) || !Number.isSafeInteger(value.expiresAtMs)
    || !value.files || typeof value.files !== 'object') return null
  const status = value.status
  if (status !== 'active' && status !== 'fulfilled' && status !== 'superseded' && status !== 'expired') return null
  return value as unknown as StoredUploadReservation
}

function filesByTargetName(selection: UploadSelection): StoredUploadReservation['files'] {
  return Object.fromEntries(selection.files.map((file) => [file.targetName, { ...file, reconciled: false }]))
}

function reservationCapacityError(error: unknown): never {
  const code = error instanceof Error ? error.message : ''
  if (code === 'too_many_upload_reservations') throw new HttpsError('resource-exhausted', '진행 중인 파일 업로드를 마친 뒤 다시 시도해 주세요', { retryAfterSeconds: 60 })
  if (code === 'reserved_upload_bytes_exceeded') throw new HttpsError('resource-exhausted', '진행 중인 파일 용량이 커요. 업로드를 마친 뒤 다시 시도해 주세요', { retryAfterSeconds: 60 })
  if (code === 'account_upload_bytes_exceeded') throw new HttpsError('resource-exhausted', '이 계정의 파일 보관 한도에 도달했어요')
  throw error
}

function submissionIdFrom(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) throw new HttpsError('invalid-argument', '수정할 글을 확인해 주세요')
  return value
}

export const prepareSubmissionUploads = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const submissionId = submissionIdFrom(request.data?.submissionId)
  const selection = normalizeUploadSelection(request.data)
  const firestore = getFirestore()
  const ref = firestore.collection('submissions').doc(submissionId)
  const commandKey = createHash('sha256').update(`upload-selection:${uid}:${submissionId}:${selection.requestId}`).digest('hex')
  const commandRef = firestore.collection('auditEvents').doc(commandKey)
  const fingerprint = uploadSelectionFingerprint(selection)
  const reservationId = uploadReservationId(uid, submissionId, selection.requestId)
  const reservationRef = firestore.collection('uploadReservations').doc(reservationId)
  const usageRef = firestore.collection('uploadReservationUsage').doc(uid)
  const nowMs = Date.now()
  const expiresAtMs = nowMs + uploadReservationTtlMs
  const totalBytes = selection.files.reduce((sum, file) => sum + file.size, 0)
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, command, existingReservation, usageSnapshot] = await Promise.all([
      transaction.get(ref), transaction.get(commandRef), transaction.get(reservationRef), transaction.get(usageRef),
    ])
    if (!snapshot.exists || snapshot.get('ownerUid') !== uid) throw new HttpsError('permission-denied', '내가 올린 글의 파일만 바꿀 수 있어요')
    if (snapshot.get('sourceMode') !== 'upload' || operatorModerationBlocksPublication(snapshot.get('operatorModeration'))) throw new HttpsError('failed-precondition', '현재 파일을 바꿀 수 없는 글이에요')
    if (command.exists) {
      if (command.get('fingerprint') !== fingerprint || command.get('reservationId') !== reservationId) throw new HttpsError('already-exists', '같은 요청 번호로 다른 파일을 선택할 수 없어요')
      return
    }
    if (snapshot.get('status') !== 'draft' && snapshot.get('status') !== 'revision_requested') throw new HttpsError('failed-precondition', '수정 화면에서 파일을 바꿔 주세요')
    if (existingReservation.exists) throw new HttpsError('already-exists', '같은 업로드 예약이 이미 저장됐어요')

    const previousId = typeof snapshot.get('uploadReservation.id') === 'string' ? String(snapshot.get('uploadReservation.id')) : ''
    let previous: StoredUploadReservation | null = null
    let previousRef = null
    if (previousId && previousId !== reservationId) {
      previousRef = firestore.collection('uploadReservations').doc(previousId)
      previous = storedReservation(await transaction.get(previousRef))
    }
    const replacingBytes = previous && previous.ownerUid === uid
      && previous.submissionId === submissionId
      && previous.status === 'active'
      ? previous.totalBytes
      : 0
    let nextUsage
    try {
      nextUsage = reserveUploadCapacity({
        usage: normalizedUploadReservationUsage(usageSnapshot.data()),
        requestedBytes: totalBytes,
        replacingBytes,
      })
    } catch (error) { reservationCapacityError(error) }

    if (previous && previousRef && replacingBytes) transaction.update(previousRef, {
      status: 'superseded', cleanupDueAt: Timestamp.fromMillis(nowMs), updatedAt: FieldValue.serverTimestamp(),
    })
    const files = filesByTargetName(selection)
    transaction.create(reservationRef, {
      ownerUid: uid, submissionId, requestId: selection.requestId, fingerprint, status: 'active',
      totalBytes, files, expiresAtMs, expiresAt: Timestamp.fromMillis(expiresAtMs),
      cleanupDueAt: Timestamp.fromMillis(expiresAtMs), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(usageRef, { ...nextUsage, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    transaction.update(ref, {
      uploadSelection: selection,
      uploadReservation: { id: reservationId, requestId: selection.requestId, expiresAtMs, totalBytes, files },
      attachmentRevision: randomUUID(), scanAttestation: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(commandRef, { type: 'submission.upload_selection', submissionId, uid, fingerprint, reservationId, at: FieldValue.serverTimestamp() })
  })
  const persisted = storedReservation(await reservationRef.get())
  if (!persisted || persisted.fingerprint !== fingerprint || (persisted.status !== 'active' && persisted.status !== 'fulfilled')) {
    throw new HttpsError('aborted', '파일 업로드 예약을 다시 확인해 주세요')
  }
  return {
    requestId: selection.requestId,
    reservationId,
    expiresAtMs: persisted.expiresAtMs,
    files: selection.files.map((file) => ({ name: file.name, targetName: file.targetName, sha256: file.sha256 })),
  }
})

export async function recordUploadedReservationObject(input: {
  ownerUid: string
  submissionId: string
  targetName: string
  size: number
  contentType: string
  reservationId: string
  requestId: string
  sha256: string
}): Promise<boolean> {
  const firestore = getFirestore()
  const reservationRef = firestore.collection('uploadReservations').doc(input.reservationId)
  const usageRef = firestore.collection('uploadReservationUsage').doc(input.ownerUid)
  const submissionRef = firestore.collection('submissions').doc(input.submissionId)
  return firestore.runTransaction(async (transaction) => {
    const [reservationSnapshot, usageSnapshot, submission] = await Promise.all([
      transaction.get(reservationRef), transaction.get(usageRef), transaction.get(submissionRef),
    ])
    const reservation = storedReservation(reservationSnapshot)
    const selected = reservation?.files[input.targetName]
    if (!reservation || reservation.ownerUid !== input.ownerUid || reservation.submissionId !== input.submissionId
      || reservation.requestId !== input.requestId || (reservation.status !== 'active' && reservation.status !== 'fulfilled')
      || (reservation.status === 'active' && reservation.expiresAtMs <= Date.now())
      || !selected || selected.size !== input.size || selected.contentType !== input.contentType || selected.sha256 !== input.sha256
      || submission.get('ownerUid') !== input.ownerUid || submission.get('uploadReservation.id') !== input.reservationId) return false
    if (selected.reconciled && reservation.status === 'fulfilled') return true
    if (reservation.status !== 'active' || selected.reconciled) return false
    const files = { ...reservation.files, [input.targetName]: { ...selected, reconciled: true } }
    const fulfilled = Object.values(files).every((file) => file.reconciled)
    transaction.update(reservationRef, {
      files,
      ...(fulfilled ? {
        status: 'fulfilled', fulfilledAt: FieldValue.serverTimestamp(), cleanupDueAt: FieldValue.delete(),
      } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (fulfilled) transaction.set(usageRef, {
      ...fulfillUploadReservationCapacity(normalizedUploadReservationUsage(usageSnapshot.data()), reservation.totalBytes),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return true
  })
}

export const reconcileSubmissionUpload = onCall({ region: 'asia-northeast3', timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const submissionId = submissionIdFrom(request.data?.submissionId)
  const ref = getFirestore().collection('submissions').doc(submissionId)
  const snapshot = await ref.get()
  if (!snapshot.exists || snapshot.get('ownerUid') !== uid) throw new HttpsError('permission-denied', '내가 올린 파일만 확인할 수 있어요')
  const stored = snapshot.get('uploadSelection') as UploadSelection | undefined
  selectedUploadNames(stored)
  const selected = stored?.files.find((file) => file.targetName === request.data?.targetName)
  if (!stored || !selected || stored.requestId !== request.data?.requestId || operatorModerationBlocksPublication(snapshot.get('operatorModeration'))) throw new HttpsError('failed-precondition', '현재 선택한 파일을 다시 확인해 주세요')
  const file = getStorage().bucket().file(`quarantined/${uid}/${submissionId}/${selected.targetName}`)
  let metadata
  try { [metadata] = await file.getMetadata() } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && Number(error.code) === 404) return { complete: false }
    throw error
  }
  if (Number(metadata.size) !== selected.size || metadata.contentType !== selected.contentType) throw new HttpsError('failed-precondition', '저장된 파일이 선택한 파일과 달라요. 파일을 다시 선택해 주세요')
  const [bytes] = await getStorage().bucket().file(file.name, { generation: String(metadata.generation) }).download()
  if (createHash('sha256').update(bytes).digest('hex') !== selected.sha256) throw new HttpsError('failed-precondition', '저장된 파일 내용이 달라요. 파일을 다시 선택해 주세요')
  const reservationId = String(snapshot.get('uploadReservation.id') ?? '')
  const accepted = await recordUploadedReservationObject({
    ownerUid: uid, submissionId, targetName: selected.targetName, size: selected.size,
    contentType: selected.contentType, reservationId, requestId: stored.requestId, sha256: selected.sha256,
  })
  if (!accepted) throw new HttpsError('failed-precondition', '파일 업로드 예약이 만료되었어요. 다시 선택해 주세요')
  const current = await ref.get()
  if (current.get('ownerUid') !== uid || current.get('uploadSelection.requestId') !== stored.requestId || operatorModerationBlocksPublication(current.get('operatorModeration'))) throw new HttpsError('aborted', '파일 선택이 바뀌었어요. 다시 확인해 주세요')
  return { complete: true }
})

export const cleanupExpiredUploadReservations = onSchedule(
  { region: 'asia-northeast3', schedule: 'every 15 minutes', timeoutSeconds: 300, retryCount: 3 },
  async () => {
    const firestore = getFirestore()
    const now = Timestamp.now()
    const expired = await firestore.collection('uploadReservations').orderBy('cleanupDueAt', 'asc').limit(50).get()
    for (const snapshot of expired.docs) {
      const dueAt = snapshot.get('cleanupDueAt')
      if (!(dueAt instanceof Timestamp) || dueAt.toMillis() > now.toMillis()) break
      const reservation = storedReservation(snapshot)
      if (!reservation || (reservation.status !== 'active' && reservation.status !== 'superseded')) continue
      const bucket = getStorage().bucket()
      for (const targetName of Object.keys(reservation.files)) {
        const path = `quarantined/${reservation.ownerUid}/${reservation.submissionId}/${targetName}`
        try {
          const [metadata] = await bucket.file(path).getMetadata()
          const generation = String(metadata.generation ?? '')
          if (generation) await bucket.file(path, { generation }).delete({ ignoreNotFound: true, ifGenerationMatch: generation })
        } catch (error) {
          if (Number((error as { code?: unknown })?.code) !== 404) throw error
        }
      }
      await firestore.runTransaction(async (transaction) => {
        const [current, usageSnapshot] = await Promise.all([
          transaction.get(snapshot.ref), transaction.get(firestore.collection('uploadReservationUsage').doc(reservation.ownerUid)),
        ])
        const value = storedReservation(current)
        if (!value || (value.status !== 'active' && value.status !== 'superseded')) return
        transaction.update(snapshot.ref, {
          status: 'expired', cleanupDueAt: FieldValue.delete(), expiredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        })
        if (value.status === 'active') transaction.set(firestore.collection('uploadReservationUsage').doc(reservation.ownerUid), {
          ...expireUploadReservationCapacity(normalizedUploadReservationUsage(usageSnapshot.data()), value.totalBytes),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })
    }
  },
)
