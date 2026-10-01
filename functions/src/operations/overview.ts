import { getApps, initializeApp } from 'firebase-admin/app'
import {
  FieldPath,
  Timestamp,
  getFirestore,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  OPERATIONS_OVERDUE_MS,
  compareOperationsQueueItems,
  decodeOperationsQueueCursor,
  encodeOperationsQueueCursor,
  operationsQueueFilter,
  operationsQueuePageSize,
  projectAppealQueueItem,
  projectReportQueueItem,
  projectSubmissionQueueItem,
  queueSourcesForFilter,
  type OperationsQueueCursor,
  type OperationsQueueCursorPart,
  type OperationsQueueFilter,
  type OperationsQueueItem,
  type OperationsQueueSource,
} from './overview-model.js'

if (!getApps().length) initializeApp()

const overviewCacheTtlMs = 15_000
let overviewCache: { expiresAtMs: number; value: OperationsOverview } | null = null

type OperationsOverview = {
  asOfMs: number
  period: { kind: 'open_queue'; timezone: 'Asia/Seoul' }
  completeness: 'complete'
  counts: Record<'all' | 'urgent' | 'overdue' | OperationsQueueSource, number>
  cards: Array<{
    id: 'urgent' | 'overdue' | OperationsQueueSource
    label: string
    count: number
    filter: OperationsQueueFilter
  }>
  serviceHealth: Array<{
    id: string
    label: string
    source: 'service' | 'cloud'
    status: 'connected' | 'unconnected'
    observedAtMs: number | null
    destination: string
  }>
}

function requireOperator(auth: { uid?: string; token?: Record<string, unknown> } | undefined): void {
  if (!auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  if (auth.token?.role !== 'moderator' && auth.token?.role !== 'administrator') {
    throw new HttpsError('permission-denied', '운영 권한이 필요합니다')
  }
}

function sourceCollection(source: OperationsQueueSource): string {
  if (source === 'report') return 'reports'
  if (source === 'appeal') return 'moderationAppeals'
  return 'submissionOperatorExceptions'
}

export function operationsSourceQuery(
  source: OperationsQueueSource,
  filter: OperationsQueueFilter,
  asOfMs: number,
): Query<DocumentData> {
  let query: Query<DocumentData> = getFirestore().collection(sourceCollection(source))
  if (source === 'report') {
    query = filter.priority === 'urgent'
      ? query.where('status', '==', 'urgent_review')
      : query.where('status', 'in', ['received', 'urgent_review'])
  } else if (source === 'appeal') {
    query = query.where('status', '==', 'received')
  } else {
    query = query.where('status', '==', 'open')
  }
  const upperBound = filter.priority === 'overdue' ? asOfMs - OPERATIONS_OVERDUE_MS : asOfMs
  // Counts must use the same deployed composite index as the paged queue.
  // Without an explicit order Firestore infers ascending createdAt for this
  // inequality, which requires a different index even for count().
  return query.where('createdAt', '<=', Timestamp.fromMillis(upperBound))
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
}

function snapshotCursor(document: QueryDocumentSnapshot<DocumentData>): OperationsQueueCursorPart | null {
  const createdAt = document.get('createdAt')
  return createdAt instanceof Timestamp
    ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds, id: document.id }
    : null
}

function projectedQueueItem(
  source: OperationsQueueSource,
  document: QueryDocumentSnapshot<DocumentData>,
  nowMs: number,
): OperationsQueueItem | null {
  const createdAt = document.get('createdAt')
  if (!(createdAt instanceof Timestamp)) return null
  const createdAtMs = createdAt.toMillis()
  const data = document.data()
  if (source === 'report') return projectReportQueueItem(document.id, data, createdAtMs, nowMs)
  if (source === 'appeal') return projectAppealQueueItem(document.id, data, createdAtMs, nowMs)
  return projectSubmissionQueueItem(document.id, data, createdAtMs, nowMs)
}

async function exactCount(filter: OperationsQueueFilter, asOfMs: number): Promise<number> {
  const sources = queueSourcesForFilter(filter)
  const results = await Promise.all(sources.map(async (source) => {
    const snapshot = await operationsSourceQuery(source, filter, asOfMs).count().get()
    return snapshot.data().count
  }))
  return results.reduce((total, count) => total + count, 0)
}

async function buildOverview(nowMs: number): Promise<OperationsOverview> {
  const filters = {
    all: { type: 'all', priority: 'all' },
    urgent: { type: 'all', priority: 'urgent' },
    overdue: { type: 'all', priority: 'overdue' },
    report: { type: 'report', priority: 'all' },
    appeal: { type: 'appeal', priority: 'all' },
    submission: { type: 'submission', priority: 'all' },
  } as const satisfies Record<string, OperationsQueueFilter>
  const entries = await Promise.all(Object.entries(filters).map(async ([key, filter]) => [key, await exactCount(filter, nowMs)] as const))
  const counts = Object.fromEntries(entries) as OperationsOverview['counts']
  return {
    asOfMs: nowMs,
    period: { kind: 'open_queue', timezone: 'Asia/Seoul' },
    completeness: 'complete',
    counts,
    cards: [
      { id: 'urgent', label: '긴급 신고', count: counts.urgent, filter: filters.urgent },
      { id: 'overdue', label: '처리 기한 초과', count: counts.overdue, filter: filters.overdue },
      { id: 'submission', label: '업로드·공개 오류', count: counts.submission, filter: filters.submission },
      { id: 'appeal', label: '이의 제기', count: counts.appeal, filter: filters.appeal },
    ],
    serviceHealth: [
      {
        id: 'operations-queue',
        label: '서비스 처리함',
        source: 'service',
        status: 'connected',
        observedAtMs: nowMs,
        destination: '/admin',
      },
      {
        id: 'cloud-functions',
        label: 'Cloud Functions 오류·지연',
        source: 'cloud',
        status: 'unconnected',
        observedAtMs: null,
        destination: 'https://console.cloud.google.com/functions',
      },
      {
        id: 'cloud-costs',
        label: '비용·쿼터',
        source: 'cloud',
        status: 'unconnected',
        observedAtMs: null,
        destination: 'https://console.cloud.google.com/billing',
      },
    ],
  }
}

export const getOperationsOverview = onCall({ region: 'asia-northeast3' }, async (request) => {
  requireOperator(request.auth)
  const nowMs = Date.now()
  if (overviewCache && overviewCache.expiresAtMs > nowMs) return overviewCache.value
  const value = await buildOverview(nowMs)
  overviewCache = { expiresAtMs: nowMs + overviewCacheTtlMs, value }
  return value
})

export const listOperationsQueue = onCall({ region: 'asia-northeast3' }, async (request) => {
  requireOperator(request.auth)
  const filter = operationsQueueFilter(request.data)
  const pageSize = operationsQueuePageSize(request.data?.limit)
  const cursor = decodeOperationsQueueCursor(request.data?.cursor)
  const sources = queueSourcesForFilter(filter)
  const nowMs = Date.now()
  const pages = await Promise.all(sources.map(async (source) => {
    let query = operationsSourceQuery(source, filter, nowMs).limit(pageSize + 1)
    const part = cursor.sources[source]
    if (part) query = query.startAfter(new Timestamp(part.seconds, part.nanoseconds), part.id)
    const snapshot = await query.get()
    return {
      source,
      documents: snapshot.docs,
      items: snapshot.docs.map((document) => projectedQueueItem(source, document, nowMs)).filter((item): item is OperationsQueueItem => item !== null),
    }
  }))
  const items = pages.flatMap((page) => page.items).sort(compareOperationsQueueItems).slice(0, pageSize)
  const consumedIds = new Set(items.map((item) => `${item.type}:${item.id}`))
  const next: OperationsQueueCursor = { version: 1, sources: { ...cursor.sources } }
  for (const page of pages) {
    let lastConsumed: QueryDocumentSnapshot<DocumentData> | undefined
    for (let index = page.documents.length - 1; index >= 0; index -= 1) {
      const document = page.documents[index]
      if (document && consumedIds.has(`${page.source}:${document.id}`)) {
        lastConsumed = document
        break
      }
    }
    const part = lastConsumed ? snapshotCursor(lastConsumed) : null
    if (part) next.sources[page.source] = part
  }
  const hasMore = pages.some((page) => page.items.some((item) => !consumedIds.has(`${item.type}:${item.id}`)) || page.documents.length > pageSize)
  return {
    items,
    nextCursor: hasMore ? encodeOperationsQueueCursor(next) : null,
    hasMore,
    asOfMs: nowMs,
    completeness: 'complete' as const,
    filter,
  }
})
