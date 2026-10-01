import { createHash } from 'node:crypto'
import { HttpsError } from 'firebase-functions/v2/https'

export const ARCHIVE_TIME_ZONE = 'Asia/Seoul' as const
export const ARCHIVE_MAX_RELATIONS = 200
export const ARCHIVE_MAX_COLLECTION_ITEMS = 100
export const ARCHIVE_SCAN_LIMIT = 5_000

export const archiveVisibilities = ['public', 'member_only', 'hold'] as const
export const archiveRelationTargetTypes = ['bundle', 'material', 'activity'] as const
export const archiveCollectionTargetTypes = ['event', 'bundle', 'material', 'activity'] as const

export type ArchiveVisibility = typeof archiveVisibilities[number]
export type ArchiveRelationTargetType = typeof archiveRelationTargetTypes[number]
export type ArchiveCollectionTargetType = typeof archiveCollectionTargetTypes[number]
export type ArchiveViewer = { uid: string | null; member: boolean; administrator: boolean }

export type ArchiveReference = {
  targetType: ArchiveCollectionTargetType
  targetId: string
}

export type ArchiveCursor = { sortMs: number; kind: string; id: string }

function oneOf<T extends readonly string[]>(values: T, value: unknown, label: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw new HttpsError('invalid-argument', `${label}을 확인해 주세요`)
  return value
}

export function archiveId(value: unknown, label = '식별값'): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${label}을 확인해 주세요`)
  const result = value.trim()
  if (!result || result.length > 180 || result.includes('/') || !/^[A-Za-z0-9:_-]+$/.test(result)) {
    throw new HttpsError('invalid-argument', `${label}을 확인해 주세요`)
  }
  return result
}

export function requestId(value: unknown): string {
  const result = archiveId(value, '요청 식별자')
  if (result.length < 8 || result.length > 120) throw new HttpsError('invalid-argument', '요청 식별자를 확인해 주세요')
  return result
}

export function boundedText(value: unknown, label: string, max: number, options: { optional?: boolean } = {}): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result && options.optional) return ''
  if (!result || result.length > max) throw new HttpsError('invalid-argument', `${label}을 확인해 주세요`)
  return result
}

export function archiveVisibility(value: unknown): ArchiveVisibility {
  return oneOf(archiveVisibilities, value, '공개 범위')
}

export function relationTargetType(value: unknown): ArchiveRelationTargetType {
  return oneOf(archiveRelationTargetTypes, value, '연결 종류')
}

export function collectionTargetType(value: unknown): ArchiveCollectionTargetType {
  return oneOf(archiveCollectionTargetTypes, value, '모음 항목 종류')
}

export function heldYear(value: unknown): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1900 || result > 2100) throw new HttpsError('invalid-argument', '개최 연도를 확인해 주세요')
  return result
}

export function dateKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpsError('invalid-argument', `${label}을 확인해 주세요`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== (month ?? 1) - 1 || date.getUTCDate() !== day) {
    throw new HttpsError('invalid-argument', `${label}을 확인해 주세요`)
  }
  return value
}

export function calendarArchiveEventId(calendarEventId: string): string {
  return `calendar:${archiveId(calendarEventId, '행사 일정')}`
}

export function historyArchiveEventId(uid: string, commandId: string): string {
  return `history:${createHash('sha256').update(`${uid}:${requestId(commandId)}`).digest('hex').slice(0, 32)}`
}

export function archiveRelationId(archiveEventId: string, targetType: ArchiveRelationTargetType, targetId: string): string {
  return createHash('sha256')
    .update(`${archiveId(archiveEventId, '행사')}:${relationTargetType(targetType)}:${archiveId(targetId, '연결 대상')}`)
    .digest('hex')
    .slice(0, 40)
}

export function archiveCommandId(uid: string, commandId: string, action: string): string {
  return createHash('sha256').update(`${uid}:${requestId(commandId)}:${action}`).digest('hex').slice(0, 40)
}

export function normalizeArchiveReferences(value: unknown): ArchiveReference[] {
  if (!Array.isArray(value) || value.length > ARCHIVE_MAX_COLLECTION_ITEMS) {
    throw new HttpsError('invalid-argument', `자료 모음은 ${ARCHIVE_MAX_COLLECTION_ITEMS}개까지 연결할 수 있어요`)
  }
  const seen = new Set<string>()
  return value.map((item) => {
    const data = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const reference = {
      targetType: collectionTargetType(data.targetType),
      targetId: archiveId(data.targetId, '모음 항목'),
    }
    const key = `${reference.targetType}:${reference.targetId}`
    if (seen.has(key)) throw new HttpsError('invalid-argument', '같은 원본을 모음에 두 번 연결할 수 없어요')
    seen.add(key)
    return reference
  })
}

export function canReadArchiveRecord(
  record: { visibility: unknown; status: unknown; ownerUid?: unknown },
  viewer: ArchiveViewer,
): boolean {
  if (viewer.administrator) return record.status !== 'withdrawn'
  if (viewer.uid && record.ownerUid === viewer.uid) return record.status !== 'withdrawn'
  if (record.status !== 'active' && record.status !== 'published' && record.status !== 'canceled') return false
  return record.visibility === 'public' || (record.visibility === 'member_only' && viewer.member)
}

export function canManageArchiveRelation(input: {
  actorUid: string
  administrator: boolean
  relationOwnerUid?: unknown
  eventOwnerUid?: unknown
  targetOwnerUid?: unknown
}): boolean {
  return input.administrator
    || input.relationOwnerUid === input.actorUid
    || input.eventOwnerUid === input.actorUid
    || input.targetOwnerUid === input.actorUid
}

export function uniqueArchiveCounts(input: {
  eventIds?: Iterable<string>
  bundleIds?: Iterable<string>
  materialIds?: Iterable<string>
  activityIds?: Iterable<string>
  files?: Iterable<{ bundleId: string; fileId: string; status: string; canDownload: boolean }>
}) {
  const eventIds = new Set(input.eventIds ?? [])
  const bundleIds = new Set(input.bundleIds ?? [])
  const materialIds = new Set(input.materialIds ?? [])
  const activityIds = new Set(input.activityIds ?? [])
  const files = new Map<string, { status: string; canDownload: boolean }>()
  for (const file of input.files ?? []) {
    if (file.status !== 'withdrawn') files.set(`${file.bundleId}:${file.fileId}`, file)
  }
  return {
    eventCount: eventIds.size,
    bundleCount: bundleIds.size,
    materialCount: materialIds.size,
    activityCount: activityIds.size,
    fileCount: files.size,
    downloadableFileCount: [...files.values()].filter((file) => file.canDownload).length,
    pendingFileCount: [...files.values()].filter((file) => file.status === 'upload_pending' || file.status === 'scanning').length,
  }
}

export function archivePageSize(value: unknown): number {
  if (value === undefined || value === null || value === '') return 24
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > 50) throw new HttpsError('invalid-argument', '한 번에 50개까지 확인할 수 있어요')
  return result
}

export function encodeArchiveCursor(cursor: ArchiveCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeArchiveCursor(value: unknown): ArchiveCursor | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 600) throw new HttpsError('invalid-argument', '다음 위치를 확인하지 못했어요')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (!Number.isSafeInteger(parsed.sortMs) || Number(parsed.sortMs) < 0 || typeof parsed.kind !== 'string' || typeof parsed.id !== 'string') throw new Error('invalid')
    return { sortMs: Number(parsed.sortMs), kind: archiveId(parsed.kind, '종류'), id: archiveId(parsed.id) }
  } catch {
    throw new HttpsError('invalid-argument', '다음 위치를 확인하지 못했어요')
  }
}

export function isAfterArchiveCursor(item: ArchiveCursor, cursor: ArchiveCursor | null): boolean {
  if (!cursor) return true
  if (item.sortMs !== cursor.sortMs) return item.sortMs < cursor.sortMs
  const itemKey = `${item.kind}:${item.id}`
  const cursorKey = `${cursor.kind}:${cursor.id}`
  return itemKey.localeCompare(cursorKey) < 0
}
