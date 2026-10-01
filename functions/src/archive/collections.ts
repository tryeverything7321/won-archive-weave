import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireActorPolicy } from '../community/actor-policy.js'
import { archiveViewer, projectArchiveReference } from './access.js'
import {
  ARCHIVE_SCAN_LIMIT,
  ARCHIVE_TIME_ZONE,
  archiveCommandId,
  archiveId,
  archivePageSize,
  archiveVisibility,
  boundedText,
  canReadArchiveRecord,
  decodeArchiveCursor,
  encodeArchiveCursor,
  isAfterArchiveCursor,
  normalizeArchiveReferences,
  requestId,
  type ArchiveReference,
  type ArchiveViewer,
} from './model.js'

if (!getApps().length) initializeApp()

const firestore = getFirestore()

function millis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis()
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function collectionReferences(value: unknown): ArchiveReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    try { return normalizeArchiveReferences([item]) } catch { return [] }
  })
}

export async function projectArchiveCollection(
  snapshot: DocumentSnapshot,
  viewer: ArchiveViewer,
  resolveReference: typeof projectArchiveReference = projectArchiveReference,
) {
  if (!snapshot.exists) return null
  const data = snapshot.data() ?? {}
  if (!canReadArchiveRecord({ visibility: data.visibility, status: data.status, ownerUid: data.ownerUid }, viewer)) return null
  const references = collectionReferences(data.items)
  const projected = await Promise.all(references.map((reference) => resolveReference(reference, viewer)))
  const items = projected.filter((item): item is NonNullable<typeof item> => item !== null)
  return {
    id: snapshot.id,
    title: boundedText(data.title, '모음 제목', 120),
    description: typeof data.description === 'string' ? data.description.trim().slice(0, 1_000) : '',
    visibility: data.visibility === 'member_only' ? 'member_only' as const : data.visibility === 'public' ? 'public' as const : 'hold' as const,
    items,
    itemCount: items.length,
    canEdit: viewer.uid !== null && data.ownerUid === viewer.uid,
    createdAtMs: millis(data.createdAt),
    updatedAtMs: millis(data.updatedAt),
  }
}

async function assertReferencesReadable(references: ArchiveReference[], viewer: ArchiveViewer) {
  const projected = await Promise.all(references.map((reference) => projectArchiveReference(reference, viewer)))
  if (projected.some((item) => item === null)) throw new HttpsError('failed-precondition', '현재 열람할 수 없는 원본은 모음에 연결할 수 없어요')
}

function collectionMutationInput(value: unknown) {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { data, commandId: requestId(data.requestId) }
}

export const createArchiveCollection = onCall({ region: 'asia-northeast3' }, async (request) => {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const { data, commandId } = collectionMutationInput(request.data)
  const collectionId = `collection:${archiveCommandId(actor.uid, commandId, 'archive.collection_created').slice(0, 32)}`
  const collectionRef = firestore.collection('archiveCollections').doc(collectionId)
  const auditRef = firestore.collection('auditEvents').doc(archiveCommandId(actor.uid, commandId, 'archive.collection_created'))
  const repeated = await firestore.runTransaction(async (transaction) => {
    const [existing, command] = await Promise.all([transaction.get(collectionRef), transaction.get(auditRef)])
    if (command.exists || existing.exists) return true
    transaction.create(collectionRef, {
      title: boundedText(data.title, '모음 제목', 120),
      description: boundedText(data.description, '모음 설명', 1_000, { optional: true }),
      visibility: archiveVisibility(data.visibility),
      status: 'active',
      ownerUid: actor.uid,
      items: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(auditRef, { type: 'archive.collection_created', collectionId, actorUid: actor.uid, at: FieldValue.serverTimestamp() })
    return false
  })
  return { collectionId, repeated }
})

export const updateArchiveCollection = onCall({ region: 'asia-northeast3' }, async (request) => {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const { data, commandId } = collectionMutationInput(request.data)
  const collectionId = archiveId(data.collectionId, '모음')
  const collectionRef = firestore.collection('archiveCollections').doc(collectionId)
  const auditRef = firestore.collection('auditEvents').doc(archiveCommandId(actor.uid, commandId, 'archive.collection_updated'))
  const repeated = await firestore.runTransaction(async (transaction) => {
    const [existing, command] = await Promise.all([transaction.get(collectionRef), transaction.get(auditRef)])
    if (command.exists) return true
    if (!existing.exists || existing.get('status') === 'withdrawn') throw new HttpsError('not-found', '자료 모음을 찾지 못했어요')
    if (existing.get('ownerUid') !== actor.uid) throw new HttpsError('permission-denied', '자료 모음을 만든 사람만 수정할 수 있어요')
    transaction.update(collectionRef, {
      title: boundedText(data.title, '모음 제목', 120),
      description: boundedText(data.description, '모음 설명', 1_000, { optional: true }),
      visibility: archiveVisibility(data.visibility),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(auditRef, { type: 'archive.collection_updated', collectionId, actorUid: actor.uid, at: FieldValue.serverTimestamp() })
    return false
  })
  return { collectionId, repeated }
})

export const replaceArchiveCollectionItems = onCall({ region: 'asia-northeast3' }, async (request) => {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const { data, commandId } = collectionMutationInput(request.data)
  const collectionId = archiveId(data.collectionId, '모음')
  const references = normalizeArchiveReferences(data.items)
  const viewer = await archiveViewer(request.auth)
  await assertReferencesReadable(references, viewer)
  const collectionRef = firestore.collection('archiveCollections').doc(collectionId)
  const auditRef = firestore.collection('auditEvents').doc(archiveCommandId(actor.uid, commandId, 'archive.collection_items_replaced'))
  const repeated = await firestore.runTransaction(async (transaction) => {
    const [existing, command] = await Promise.all([transaction.get(collectionRef), transaction.get(auditRef)])
    if (command.exists) return true
    if (!existing.exists || existing.get('status') === 'withdrawn') throw new HttpsError('not-found', '자료 모음을 찾지 못했어요')
    if (existing.get('ownerUid') !== actor.uid) throw new HttpsError('permission-denied', '자료 모음을 만든 사람만 수정할 수 있어요')
    transaction.update(collectionRef, { items: references, updatedAt: FieldValue.serverTimestamp() })
    transaction.create(auditRef, {
      type: 'archive.collection_items_replaced', collectionId, itemCount: references.length, actorUid: actor.uid, at: FieldValue.serverTimestamp(),
    })
    return false
  })
  return { collectionId, itemCount: references.length, repeated }
})

export const getArchiveCollection = onCall({ region: 'asia-northeast3' }, async (request) => {
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {}
  const collectionId = archiveId(data.collectionId, '모음')
  const viewer = await archiveViewer(request.auth)
  const projection = await projectArchiveCollection(await firestore.collection('archiveCollections').doc(collectionId).get(), viewer)
  if (!projection) throw new HttpsError('not-found', '자료 모음을 찾지 못했어요')
  return { collection: projection, asOfMs: Date.now(), timeZone: ARCHIVE_TIME_ZONE, completeness: 'complete' as const }
})

export const listArchiveCollections = onCall({ region: 'asia-northeast3' }, async (request) => {
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {}
  const limit = archivePageSize(data.limit)
  const cursor = decodeArchiveCursor(data.cursor)
  const viewer = await archiveViewer(request.auth)
  const snapshot = await firestore.collection('archiveCollections').limit(ARCHIVE_SCAN_LIMIT + 1).get()
  if (snapshot.size > ARCHIVE_SCAN_LIMIT) throw new HttpsError('resource-exhausted', '자료 모음이 많아 검색 범위를 나누어야 해요')
  const projected = await Promise.all(snapshot.docs.map((doc) => projectArchiveCollection(doc, viewer)))
  const all = projected.filter((item): item is NonNullable<typeof item> => item !== null).sort((left, right) => {
    return right.updatedAtMs - left.updatedAtMs || right.id.localeCompare(left.id)
  })
  const after = all.filter((item) => isAfterArchiveCursor({ sortMs: item.updatedAtMs, kind: 'collection', id: item.id }, cursor))
  const items = after.slice(0, limit)
  const hasMore = after.length > limit
  const last = items.at(-1)
  return {
    items,
    totalCount: all.length,
    hasMore,
    nextCursor: hasMore && last ? encodeArchiveCursor({ sortMs: last.updatedAtMs, kind: 'collection', id: last.id }) : null,
    asOfMs: Date.now(),
    timeZone: ARCHIVE_TIME_ZONE,
    completeness: 'complete' as const,
  }
})
