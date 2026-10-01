import { httpsCallable } from 'firebase/functions'
import { getFirebaseServices } from '../../lib/firebase/client'

export type OperationsQueueType = 'all' | 'report' | 'appeal' | 'submission'
export type OperationsQueuePriority = 'all' | 'urgent' | 'overdue'
export type OperationsQueueFilter = { type: OperationsQueueType; priority: OperationsQueuePriority }

export type OperationsQueueItem = {
  id: string
  type: Exclude<OperationsQueueType, 'all'>
  status: string
  urgent: boolean
  overdue: boolean
  createdAtMs: number
  targetLabel: string
  issueLabel: string
  href: string
}

export type OperationsOverview = {
  asOfMs: number
  period: { kind: 'open_queue'; timezone: 'Asia/Seoul' }
  completeness: 'complete'
  counts: Record<'all' | 'urgent' | 'overdue' | Exclude<OperationsQueueType, 'all'>, number>
  cards: Array<{
    id: 'urgent' | 'overdue' | Exclude<OperationsQueueType, 'all'>
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

export type OperationsQueuePage = {
  items: OperationsQueueItem[]
  nextCursor: string | null
  hasMore: boolean
  asOfMs: number
  completeness: 'complete'
  filter: OperationsQueueFilter
}

export type OperatorAuditEvent = {
  id: string
  type: string
  category: 'community' | 'submission' | 'calendar' | 'account' | 'members'
  label: string
  occurredAtMs: number
  targetType: 'community' | 'submission' | 'calendar_event' | 'member' | null
  targetId: string | null
  action: string | null
  result: string | null
}

export type OperatorAuditPage = {
  items: OperatorAuditEvent[]
  nextCursor: string | null
  hasMore: boolean
  asOfMs: number
  completeness: 'complete' | 'partial'
}

function functions() {
  const services = getFirebaseServices()
  if (!services) throw new Error('Firebase is not configured')
  return services.functions
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('운영 응답 형식을 확인하지 못했어요')
  return value as Record<string, unknown>
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name}을 확인하지 못했어요`)
  return value
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name}을 확인하지 못했어요`)
  return value
}

function nonNegativeInteger(value: unknown, name: string): number {
  const result = finiteNumber(value, name)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${name}을 확인하지 못했어요`)
  return result
}

function queueType(value: unknown): OperationsQueueType {
  if (value === 'all' || value === 'report' || value === 'appeal' || value === 'submission') return value
  throw new Error('처리함 종류를 확인하지 못했어요')
}

function queuePriority(value: unknown): OperationsQueuePriority {
  if (value === 'all' || value === 'urgent' || value === 'overdue') return value
  throw new Error('처리함 우선순위를 확인하지 못했어요')
}

function parseFilter(value: unknown): OperationsQueueFilter {
  const data = object(value)
  return { type: queueType(data.type), priority: queuePriority(data.priority) }
}

function parseQueueItem(value: unknown): OperationsQueueItem {
  const data = object(value)
  const type = queueType(data.type)
  if (type === 'all') throw new Error('처리함 종류를 확인하지 못했어요')
  return {
    id: text(data.id, '운영 항목'),
    type,
    status: text(data.status, '처리 상태'),
    urgent: data.urgent === true,
    overdue: data.overdue === true,
    createdAtMs: finiteNumber(data.createdAtMs, '접수 시각'),
    targetLabel: text(data.targetLabel, '대상'),
    issueLabel: text(data.issueLabel, '문제'),
    href: text(data.href, '이동 경로'),
  }
}

export function parseOperationsOverview(value: unknown): OperationsOverview {
  const data = object(value)
  const counts = object(data.counts)
  const period = object(data.period)
  if (period.kind !== 'open_queue' || period.timezone !== 'Asia/Seoul' || data.completeness !== 'complete') {
    throw new Error('운영 집계 기준을 확인하지 못했어요')
  }
  const parsedCounts: OperationsOverview['counts'] = {
    all: nonNegativeInteger(counts.all, '전체 건수'),
    urgent: nonNegativeInteger(counts.urgent, '긴급 건수'),
    overdue: nonNegativeInteger(counts.overdue, '기한 초과 건수'),
    report: nonNegativeInteger(counts.report, '신고 건수'),
    appeal: nonNegativeInteger(counts.appeal, '이의 제기 건수'),
    submission: nonNegativeInteger(counts.submission, '자료 예외 건수'),
  }
  const cards = Array.isArray(data.cards) ? data.cards.map((value) => {
    const card = object(value)
    const id = text(card.id, '요약 항목')
    if (id !== 'urgent' && id !== 'overdue' && id !== 'report' && id !== 'appeal' && id !== 'submission') throw new Error('요약 항목을 확인하지 못했어요')
    const cardId: OperationsOverview['cards'][number]['id'] = id
    return { id: cardId, label: text(card.label, '요약 이름'), count: nonNegativeInteger(card.count, '요약 건수'), filter: parseFilter(card.filter) }
  }) : []
  const serviceHealth = Array.isArray(data.serviceHealth) ? data.serviceHealth.map((value) => {
    const item = object(value)
    if ((item.source !== 'service' && item.source !== 'cloud') || (item.status !== 'connected' && item.status !== 'unconnected')) {
      throw new Error('서비스 연결 상태를 확인하지 못했어요')
    }
    const source: OperationsOverview['serviceHealth'][number]['source'] = item.source
    const status: OperationsOverview['serviceHealth'][number]['status'] = item.status
    return {
      id: text(item.id, '서비스 상태'),
      label: text(item.label, '서비스 이름'),
      source,
      status,
      observedAtMs: item.observedAtMs === null ? null : finiteNumber(item.observedAtMs, '관측 시각'),
      destination: text(item.destination, '확인 위치'),
    }
  }) : []
  return {
    asOfMs: finiteNumber(data.asOfMs, '집계 시각'),
    period: { kind: 'open_queue', timezone: 'Asia/Seoul' },
    completeness: 'complete',
    counts: parsedCounts,
    cards,
    serviceHealth,
  }
}

export function parseOperationsQueuePage(value: unknown): OperationsQueuePage {
  const data = object(value)
  if (data.completeness !== 'complete') throw new Error('처리함 집계 범위를 확인하지 못했어요')
  return {
    items: Array.isArray(data.items) ? data.items.map(parseQueueItem) : [],
    nextCursor: typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null,
    hasMore: data.hasMore === true,
    asOfMs: finiteNumber(data.asOfMs, '조회 시각'),
    completeness: 'complete',
    filter: parseFilter(data.filter),
  }
}

function parseAuditEvent(value: unknown): OperatorAuditEvent {
  const data = object(value)
  const category = data.category
  if (category !== 'community' && category !== 'submission' && category !== 'calendar' && category !== 'account' && category !== 'members') {
    throw new Error('운영 이력 종류를 확인하지 못했어요')
  }
  const targetType = data.targetType
  if (targetType !== null && targetType !== 'community' && targetType !== 'submission' && targetType !== 'calendar_event' && targetType !== 'member') {
    throw new Error('운영 이력 대상을 확인하지 못했어요')
  }
  return {
    id: text(data.id, '운영 이력'),
    type: text(data.type, '운영 이력 종류'),
    category,
    label: text(data.label, '운영 이력 이름'),
    occurredAtMs: finiteNumber(data.occurredAtMs, '운영 이력 시각'),
    targetType,
    targetId: typeof data.targetId === 'string' && data.targetId ? data.targetId : null,
    action: typeof data.action === 'string' && data.action ? data.action : null,
    result: typeof data.result === 'string' && data.result ? data.result : null,
  }
}

export function parseOperatorAuditPage(value: unknown): OperatorAuditPage {
  const data = object(value)
  if (data.completeness !== 'complete' && data.completeness !== 'partial') throw new Error('운영 이력 조회 범위를 확인하지 못했어요')
  return {
    items: Array.isArray(data.items) ? data.items.map(parseAuditEvent) : [],
    nextCursor: typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null,
    hasMore: data.hasMore === true,
    asOfMs: finiteNumber(data.asOfMs, '운영 이력 조회 시각'),
    completeness: data.completeness,
  }
}

export async function getOperationsOverview(): Promise<OperationsOverview> {
  const callable = httpsCallable<Record<string, never>, unknown>(functions(), 'getOperationsOverview')
  return parseOperationsOverview((await callable({})).data)
}

export async function listOperationsQueue(input: OperationsQueueFilter & { cursor?: string | null; limit?: number }): Promise<OperationsQueuePage> {
  const callable = httpsCallable<typeof input, unknown>(functions(), 'listOperationsQueue')
  return parseOperationsQueuePage((await callable(input)).data)
}

export async function listOperatorAuditEvents(input: { cursor?: string | null; limit?: number } = {}): Promise<OperatorAuditPage> {
  const callable = httpsCallable<typeof input, unknown>(functions(), 'listOperatorAuditEvents')
  return parseOperatorAuditPage((await callable(input)).data)
}
