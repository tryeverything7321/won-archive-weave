import { HttpsError } from 'firebase-functions/v2/https'

export const OPERATIONS_QUEUE_PAGE_SIZE = 30
export const OPERATIONS_QUEUE_PAGE_SIZE_MAX = 50
export const OPERATIONS_OVERDUE_MS = 24 * 60 * 60 * 1_000

export const operationsQueueTypes = ['all', 'report', 'appeal', 'submission'] as const
export const operationsQueuePriorities = ['all', 'urgent', 'overdue'] as const

export type OperationsQueueType = typeof operationsQueueTypes[number]
export type OperationsQueuePriority = typeof operationsQueuePriorities[number]
export type OperationsQueueSource = Exclude<OperationsQueueType, 'all'>

export type OperationsQueueFilter = {
  type: OperationsQueueType
  priority: OperationsQueuePriority
}

export type OperationsQueueCursorPart = {
  seconds: number
  nanoseconds: number
  id: string
}

export type OperationsQueueCursor = {
  version: 1
  sources: Partial<Record<OperationsQueueSource, OperationsQueueCursorPart>>
}

export type OperationsQueueItem = {
  id: string
  type: OperationsQueueSource
  status: string
  urgent: boolean
  overdue: boolean
  createdAtMs: number
  targetLabel: string
  issueLabel: string
  href: string
}

const minimumFirestoreTimestampSeconds = -62_135_596_800
const maximumFirestoreTimestampSeconds = 253_402_300_799

function valueIn<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

export function operationsQueueFilter(input: unknown): OperationsQueueFilter {
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const type = data.type === undefined || data.type === '' ? 'all' : data.type
  const priority = data.priority === undefined || data.priority === '' ? 'all' : data.priority
  if (!valueIn(operationsQueueTypes, type) || !valueIn(operationsQueuePriorities, priority)) {
    throw new HttpsError('invalid-argument', '운영 처리함 필터를 확인해 주세요')
  }
  if (priority === 'urgent' && type !== 'all' && type !== 'report') {
    throw new HttpsError('invalid-argument', '긴급 항목은 신고 처리함에서 확인할 수 있어요')
  }
  return { type, priority }
}

export function operationsQueuePageSize(value: unknown): number {
  if (value === undefined || value === null || value === '') return OPERATIONS_QUEUE_PAGE_SIZE
  const pageSize = Number(value)
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > OPERATIONS_QUEUE_PAGE_SIZE_MAX) {
    throw new HttpsError('invalid-argument', `한 번에 ${OPERATIONS_QUEUE_PAGE_SIZE_MAX}개까지 확인할 수 있어요`)
  }
  return pageSize
}

export function encodeOperationsQueueCursor(cursor: OperationsQueueCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeOperationsQueueCursor(value: unknown): OperationsQueueCursor {
  if (value === undefined || value === null || value === '') return { version: 1, sources: {} }
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new HttpsError('invalid-argument', '다음 운영 항목 위치를 확인하지 못했어요')
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (parsed.version !== 1 || !parsed.sources || typeof parsed.sources !== 'object') throw new Error('invalid')
    const sources: OperationsQueueCursor['sources'] = {}
    for (const source of operationsQueueTypes.slice(1) as OperationsQueueSource[]) {
      const part = (parsed.sources as Record<string, unknown>)[source]
      if (part === undefined) continue
      if (!part || typeof part !== 'object') throw new Error('invalid')
      const candidate = part as Record<string, unknown>
      if (
        !Number.isSafeInteger(candidate.seconds)
        || Number(candidate.seconds) < minimumFirestoreTimestampSeconds
        || Number(candidate.seconds) > maximumFirestoreTimestampSeconds
        || !Number.isSafeInteger(candidate.nanoseconds)
        || Number(candidate.nanoseconds) < 0
        || Number(candidate.nanoseconds) > 999_999_999
        || typeof candidate.id !== 'string'
        || !candidate.id
        || candidate.id.length > 180
        || candidate.id.includes('/')
      ) throw new Error('invalid')
      sources[source] = {
        seconds: Number(candidate.seconds),
        nanoseconds: Number(candidate.nanoseconds),
        id: candidate.id,
      }
    }
    return { version: 1, sources }
  } catch {
    throw new HttpsError('invalid-argument', '다음 운영 항목 위치를 확인하지 못했어요')
  }
}

function text(value: unknown, fallback: string, max = 160): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback
}

export function projectReportQueueItem(
  id: string,
  data: Record<string, unknown>,
  createdAtMs: number,
  nowMs: number,
): OperationsQueueItem {
  const category = text(data.category, 'other', 40)
  const categoryLabels: Record<string, string> = {
    personal_data: '개인정보 신고',
    harassment: '괴롭힘 신고',
    crisis: '긴급 도움 신고',
    rights: '권리 침해 신고',
    spam: '스팸 신고',
    other: '기타 신고',
  }
  return {
    id,
    type: 'report',
    status: data.status === 'urgent_review' ? 'urgent_review' : 'received',
    urgent: data.status === 'urgent_review',
    overdue: nowMs - createdAtMs >= OPERATIONS_OVERDUE_MS,
    createdAtMs,
    targetLabel: data.targetType === 'comment' ? '커뮤니티 댓글' : '커뮤니티 글',
    issueLabel: categoryLabels[category] ?? categoryLabels.other,
    href: '/admin/community?queue=reports',
  }
}

export function projectAppealQueueItem(
  id: string,
  data: Record<string, unknown>,
  createdAtMs: number,
  nowMs: number,
): OperationsQueueItem {
  return {
    id,
    type: 'appeal',
    status: 'received',
    urgent: false,
    overdue: nowMs - createdAtMs >= OPERATIONS_OVERDUE_MS,
    createdAtMs,
    targetLabel: '커뮤니티 글',
    issueLabel: '이의 제기',
    href: '/admin/community?queue=appeals',
  }
}

export function projectSubmissionQueueItem(
  id: string,
  data: Record<string, unknown>,
  createdAtMs: number,
  nowMs: number,
): OperationsQueueItem {
  const type = text(data.type, 'automatic_publication_exception', 80)
  const typeLabels: Record<string, string> = {
    automatic_publication_failed: '자동 공개 실패',
    manual_publication_failed: '수동 공개 실패',
    cleanup_failed: '파일 정리 실패',
    cleanup_dead_letter: '파일 정리 재시도 필요',
    scan_failed: '파일 검사 실패',
    automatic_publication_exception: '자료 처리 예외',
  }
  return {
    id,
    type: 'submission',
    status: 'open',
    urgent: false,
    overdue: nowMs - createdAtMs >= OPERATIONS_OVERDUE_MS,
    createdAtMs,
    targetLabel: '활동·자료',
    issueLabel: typeLabels[type] ?? '자료 처리 예외',
    href: '/admin/submissions',
  }
}

export function compareOperationsQueueItems(left: OperationsQueueItem, right: OperationsQueueItem): number {
  if (left.createdAtMs !== right.createdAtMs) return right.createdAtMs - left.createdAtMs
  const leftKey = `${left.type}:${left.id}`
  const rightKey = `${right.type}:${right.id}`
  return rightKey.localeCompare(leftKey)
}

export function queueSourcesForFilter(filter: OperationsQueueFilter): OperationsQueueSource[] {
  if (filter.priority === 'urgent') return ['report']
  return filter.type === 'all' ? ['report', 'appeal', 'submission'] : [filter.type]
}
