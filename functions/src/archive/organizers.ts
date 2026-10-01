import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireActorPolicy } from '../community/actor-policy.js'
import {
  ARCHIVE_SCAN_LIMIT,
  ARCHIVE_TIME_ZONE,
  archiveCommandId,
  archiveId,
  archivePageSize,
  boundedText,
  requestId,
} from './model.js'

if (!getApps().length) initializeApp()

const firestore = getFirestore()

type OrganizerCursor = { displayName: string; id: string }

function normalizeAliases(value: unknown, displayName: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 30) throw new HttpsError('invalid-argument', '다른 이름은 30개까지 등록할 수 있어요')
  const result = [...new Set(value.map((item) => boundedText(item, '다른 이름', 100)).filter((item) => item !== displayName))]
  return result.sort((left, right) => left.localeCompare(right, 'ko'))
}

function encodeOrganizerCursor(value: OrganizerCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeOrganizerCursor(value: unknown): OrganizerCursor | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 600) throw new HttpsError('invalid-argument', '다음 위치를 확인하지 못했어요')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    return { displayName: boundedText(parsed.displayName, '주최 이름', 100), id: archiveId(parsed.id, '주최') }
  } catch {
    throw new HttpsError('invalid-argument', '다음 위치를 확인하지 못했어요')
  }
}

function organizerProjection(id: string, data: Record<string, unknown>) {
  const displayName = boundedText(data.displayName, '주최 이름', 100)
  const aliases = Array.isArray(data.aliases)
    ? data.aliases.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim().slice(0, 100)] : [])
    : []
  return {
    id,
    displayName,
    aliases,
    activityRegion: typeof data.activityRegion === 'string' ? data.activityRegion.trim().slice(0, 80) : '',
  }
}

export const upsertArchiveOrganizer = onCall({ region: 'asia-northeast3' }, async (request) => {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  if (actor.roleException !== 'administrator') throw new HttpsError('permission-denied', '관리자만 주최 정보를 수정할 수 있어요')
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {}
  const commandId = requestId(data.requestId)
  const displayName = boundedText(data.displayName, '주최 이름', 100)
  const aliases = normalizeAliases(data.aliases, displayName)
  const activityRegion = boundedText(data.activityRegion, '활동 지역', 80, { optional: true })
  const organizerId = typeof data.organizerId === 'string' && data.organizerId.trim()
    ? archiveId(data.organizerId, '주최')
    : `organizer:${archiveCommandId(actor.uid, commandId, 'archive.organizer_created').slice(0, 32)}`
  const organizerRef = firestore.collection('archiveOrganizers').doc(organizerId)
  const auditRef = firestore.collection('auditEvents').doc(archiveCommandId(actor.uid, commandId, 'archive.organizer_upserted'))
  const repeated = await firestore.runTransaction(async (transaction) => {
    const [existing, command] = await Promise.all([transaction.get(organizerRef), transaction.get(auditRef)])
    if (command.exists) return true
    transaction.set(organizerRef, {
      displayName,
      aliases,
      activityRegion,
      status: 'active',
      createdAt: existing.exists ? existing.get('createdAt') : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(auditRef, {
      type: existing.exists ? 'archive.organizer_updated' : 'archive.organizer_created',
      organizerId,
      actorUid: actor.uid,
      at: FieldValue.serverTimestamp(),
    })
    return false
  })
  const saved = await organizerRef.get()
  return { organizer: organizerProjection(saved.id, saved.data() ?? {}), repeated }
})

export const listArchiveOrganizers = onCall({ region: 'asia-northeast3' }, async (request) => {
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {}
  const limit = archivePageSize(data.limit)
  const cursor = decodeOrganizerCursor(data.cursor)
  const snapshot = await firestore.collection('archiveOrganizers').where('status', '==', 'active').limit(ARCHIVE_SCAN_LIMIT + 1).get()
  if (snapshot.size > ARCHIVE_SCAN_LIMIT) throw new HttpsError('resource-exhausted', '주최 목록이 많아 검색 범위를 나누어야 해요')
  const all = snapshot.docs.map((doc) => organizerProjection(doc.id, doc.data())).sort((left, right) => {
    const byName = left.displayName.localeCompare(right.displayName, 'ko')
    return byName || left.id.localeCompare(right.id)
  })
  const after = cursor
    ? all.filter((item) => {
      const byName = item.displayName.localeCompare(cursor.displayName, 'ko')
      return byName > 0 || (byName === 0 && item.id.localeCompare(cursor.id) > 0)
    })
    : all
  const items = after.slice(0, limit)
  const hasMore = after.length > limit
  const last = items.at(-1)
  return {
    items,
    totalCount: all.length,
    hasMore,
    nextCursor: hasMore && last ? encodeOrganizerCursor({ displayName: last.displayName, id: last.id }) : null,
    asOfMs: Date.now(),
    timeZone: ARCHIVE_TIME_ZONE,
    completeness: 'complete' as const,
  }
})
