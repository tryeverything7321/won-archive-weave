import { createHash, randomUUID } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { IcsContractError, icsLimits, parseIcs, validatePublicIcsUrl, type IcsEvent } from './ics-service.js'
import { requireActorPolicy } from '../community/actor-policy.js'
import { readEventInstagramPosts } from './event-instagram.js'

if (!getApps().length) initializeApp()

const db = getFirestore()
type CalendarSourceInput = {
  name?: unknown
  sourceType?: unknown
  feedUrl?: unknown
  publicUrl?: unknown
  organizerName?: unknown
  region?: unknown
  visibility?: unknown
}

type SelectedGoogleEventInput = {
  organizerName?: unknown
  region?: unknown
  externalId?: unknown
  title?: unknown
  description?: unknown
  locationName?: unknown
  startAt?: unknown
  endAt?: unknown
  allDay?: unknown
  timeZone?: unknown
}

type SelectedGoogleEventsInput = {
  organizerName?: unknown
  region?: unknown
  visibility?: unknown
  events?: unknown
}

export class GoogleCalendarSelectionError extends Error {}

function selectedText(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== 'string') {
    if (!required) return ''
    throw new GoogleCalendarSelectionError(`${label}을 확인해 주세요`)
  }
  const normalized = value.trim()
  if ((required && !normalized) || normalized.length > max) {
    throw new GoogleCalendarSelectionError(`${label}을 확인해 주세요`)
  }
  return normalized
}

function googleSelectionGlobals(data: SelectedGoogleEventsInput, now: Date) {
  const organizerName = selectedText(data.organizerName, '운영 주체', 80, false)
  const region = selectedText(data.region, '지역', 40, false)
  const visibility = data.visibility === 'member_only' ? 'member_only' : data.visibility === 'public' ? 'public' : null
  if (!visibility) throw new GoogleCalendarSelectionError('공개 범위를 확인해 주세요')
  if (!Array.isArray(data.events) || data.events.length < 1 || data.events.length > 20) {
    throw new GoogleCalendarSelectionError('한 번에 1개부터 20개까지 선택해 주세요')
  }
  return { organizerName, region, visibility, rawEvents: data.events, importWindow: calendarImportWindow(now) }
}

function normalizedSelectedGoogleEvent(
  raw: unknown,
  globals: ReturnType<typeof googleSelectionGlobals>,
) {
  const value = (raw ?? {}) as SelectedGoogleEventInput
  const externalId = selectedText(value.externalId, 'Google 일정 식별자', 300)
  const title = selectedText(value.title, '일정 제목', 120)
  const description = selectedText(value.description, '일정 설명', 2_000, false)
  const locationName = selectedText(value.locationName, '장소', 200, false) || '장소를 확인해 주세요'
  const timeZone = selectedText(value.timeZone, '시간대', 80, false) || 'Asia/Seoul'
  const startAt = new Date(selectedText(value.startAt, '시작 시간', 80))
  const endAt = new Date(selectedText(value.endAt, '종료 시간', 80))
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
    throw new GoogleCalendarSelectionError('일정 시간을 확인해 주세요')
  }
  if (startAt < globals.importWindow.startAt || startAt >= globals.importWindow.endAt || endAt.getTime() - startAt.getTime() > 31 * 86_400_000) {
    throw new GoogleCalendarSelectionError('가져올 수 있는 일정 기간을 벗어났어요')
  }
  return {
    externalId,
    organizerName: selectedText(value.organizerName === undefined ? globals.organizerName : value.organizerName, '일정별 교당·주최', 80),
    region: selectedText(value.region === undefined ? globals.region : value.region, '일정별 지역', 40),
    title,
    description,
    locationName,
    startAt,
    endAt,
    allDay: value.allDay === true,
    timeZone,
  }
}

export function selectedGoogleCalendarEvents(data: SelectedGoogleEventsInput, now = new Date()) {
  const globals = googleSelectionGlobals(data, now)
  const seen = new Set<string>()
  const events = globals.rawEvents.map((raw) => {
    const event = normalizedSelectedGoogleEvent(raw, globals)
    if (seen.has(event.externalId)) throw new GoogleCalendarSelectionError('같은 일정이 두 번 선택됐어요')
    seen.add(event.externalId)
    return event
  })
  return { organizerName: globals.organizerName, region: globals.region, visibility: globals.visibility, events }
}

export function selectedGoogleCalendarImportEntries(data: SelectedGoogleEventsInput, now = new Date()) {
  const globals = googleSelectionGlobals(data, now)
  const seen = new Set<string>()
  const entries = globals.rawEvents.map((raw, index) => {
    try {
      const event = normalizedSelectedGoogleEvent(raw, globals)
      if (seen.has(event.externalId)) return { index, status: 'duplicate' as const }
      seen.add(event.externalId)
      return { index, status: 'ready' as const, event }
    } catch (error) {
      if (error instanceof GoogleCalendarSelectionError) return { index, status: 'failed' as const }
      throw error
    }
  })
  return { visibility: globals.visibility, entries }
}

export type GoogleCalendarImportItemStatus = 'published' | 'duplicate' | 'failed'

export async function settleGoogleCalendarImports<T>(
  events: readonly T[],
  importOne: (event: T, index: number) => Promise<Exclude<GoogleCalendarImportItemStatus, 'failed'>>,
  concurrency = 4,
) {
  const results: Array<{ index: number; status: GoogleCalendarImportItemStatus }> = []
  const width = Number.isInteger(concurrency) ? Math.min(8, Math.max(1, concurrency)) : 4
  for (let offset = 0; offset < events.length; offset += width) {
    const batch = events.slice(offset, offset + width)
    results.push(...await Promise.all(batch.map(async (event, batchIndex) => {
      const index = offset + batchIndex
      try {
        return { index, status: await importOne(event, index) }
      } catch {
        return { index, status: 'failed' as const }
      }
    })))
  }
  results.sort((left, right) => left.index - right.index)
  const submitted = results.filter((result) => result.status === 'published').length
  const duplicates = results.filter((result) => result.status === 'duplicate').length
  const failed = results.filter((result) => result.status === 'failed').length
  return {
    submitted,
    duplicates,
    failed,
    status: failed === 0 ? 'published' as const : submitted + duplicates === 0 ? 'failed' as const : 'partial_failure' as const,
    results,
  }
}

function googleCalendarImportResponse(results: Array<{ index: number; status: GoogleCalendarImportItemStatus }>) {
  const submitted = results.filter((result) => result.status === 'published').length
  const duplicates = results.filter((result) => result.status === 'duplicate').length
  const failed = results.filter((result) => result.status === 'failed').length
  return {
    submitted, duplicates, failed,
    status: failed === 0 ? 'published' as const : submitted + duplicates === 0 ? 'failed' as const : 'partial_failure' as const,
    results: [...results].sort((left, right) => left.index - right.index),
  }
}

export function googleSelectionCandidateIds(uid: string, event: { externalId: string; startAt: Date }) {
  const stable = createHash('sha256')
    .update(`${uid}:google-selection:${event.externalId}`)
    .digest('hex')
    .slice(0, 40)
  const legacy = createHash('sha256')
    .update(`${uid}:google-selection:${event.externalId}:${event.startAt.toISOString()}`)
    .digest('hex')
    .slice(0, 40)
  return { stable, legacy }
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function operator(request: { auth?: { token?: Record<string, unknown> } }) {
  const role = request.auth?.token?.role
  if (role !== 'moderator' && role !== 'administrator') {
    throw new HttpsError('permission-denied', '운영 권한이 필요해요')
  }
}

function sourceInput(data: CalendarSourceInput) {
  const name = text(data.name, 80)
  const organizerName = text(data.organizerName, 80)
  const region = text(data.region, 40) || '전국'
  const visibility = data.visibility === 'member_only' ? 'member_only' : 'public'
  if (!name || !organizerName) {
    throw new HttpsError('invalid-argument', '캘린더 이름과 운영 주체를 확인해 주세요')
  }
  if (data.sourceType === 'google_public_ics' || data.sourceType === 'ics') {
    const feedUrl = validatePublicIcsUrl(text(data.feedUrl, 2_000))
    if (data.sourceType === 'google_public_ics' && new URL(feedUrl).hostname !== 'calendar.google.com') {
      throw new HttpsError('invalid-argument', 'Google Calendar의 공개 iCal 주소를 입력해 주세요')
    }
    return { name, organizerName, region, visibility, sourceType: data.sourceType, feedUrl }
  }
  if (data.sourceType === 'timetree_link') {
    const publicUrl = validatePublicIcsUrl(text(data.publicUrl, 2_000))
    const host = new URL(publicUrl).hostname
    if (host !== 'timetreeapp.com' && !host.endsWith('.timetreeapp.com')) {
      throw new HttpsError('invalid-argument', 'TimeTree 공개 캘린더 주소를 입력해 주세요')
    }
    return { name, organizerName, region, visibility, sourceType: 'timetree_link', publicUrl }
  }
  throw new HttpsError('invalid-argument', '지원하는 캘린더 연결 방식을 선택해 주세요')
}

export const submitCalendarSource = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  let source
  try {
    source = sourceInput(request.data ?? {})
  } catch (error) {
    if (error instanceof IcsContractError) throw new HttpsError('invalid-argument', '안전한 HTTPS 캘린더 주소를 입력해 주세요')
    throw error
  }
  const reference = db.collection('calendarSources').doc()
  await reference.set({
    ...source,
    ownerUid: uid,
    status: 'review_queued',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastSyncStatus: 'not_started',
  })
  return { sourceId: reference.id, status: 'review_queued' }
})

export const submitSelectedGoogleCalendarEvents = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  let selection
  try {
    selection = selectedGoogleCalendarImportEntries(request.data ?? {})
  } catch (error) {
    if (error instanceof GoogleCalendarSelectionError) {
      throw new HttpsError('invalid-argument', error.message)
    }
    throw error
  }
  const ready = selection.entries.filter((entry): entry is Extract<typeof entry, { status: 'ready' }> => entry.status === 'ready')
  const settled = await settleGoogleCalendarImports(ready, async ({ event }) => {
    const ids = googleSelectionCandidateIds(uid, event)
    const candidateRef = db.collection('calendarImportCandidates').doc(ids.stable)
    const legacyCandidateRef = db.collection('calendarImportCandidates').doc(ids.legacy)
    const eventRef = db.collection('calendarEvents').doc(ids.stable)
    return db.runTransaction(async (transaction) => {
      const [existing, legacyExisting] = await Promise.all([
        transaction.get(candidateRef),
        ids.legacy === ids.stable ? Promise.resolve(null) : transaction.get(legacyCandidateRef),
      ])
      if (existing.exists || legacyExisting?.exists) return 'duplicate' as const
      const publishedAt = FieldValue.serverTimestamp()
      const candidate = {
        title: event.title,
        description: event.description,
        locationName: event.locationName,
        startAt: Timestamp.fromDate(event.startAt),
        endAt: Timestamp.fromDate(event.endAt),
        allDay: event.allDay,
        timeZone: event.timeZone,
        sourceType: 'google',
        importMode: 'user_selected',
        organizerName: event.organizerName,
        region: event.region,
        visibility: selection.visibility,
        ownerUid: uid,
        externalFingerprint: createHash('sha256').update(event.externalId).digest('hex'),
        status: 'published',
        selectionConsentAt: publishedAt,
        importedAt: publishedAt,
        publishedAt,
        updatedAt: publishedAt,
      }
      transaction.create(candidateRef, candidate)
      transaction.create(eventRef, publicCalendarEventRecord({
        ...candidate,
        summary: event.description || `${event.organizerName}에서 공유한 일정이에요`,
        monthKeys: monthKeysBetween(event.startAt, event.endAt),
      }))
      return 'published' as const
    })
  })
  const readyResults = settled.results.map((result) => ({ index: ready[result.index].index, status: result.status }))
  const rejectedResults = selection.entries.flatMap((entry) => entry.status === 'ready' ? [] : [{ index: entry.index, status: entry.status }])
  return googleCalendarImportResponse([...readyResults, ...rejectedResults])
})

export const reviewCalendarSource = onCall({ region: 'asia-northeast3' }, async (request) => {
  operator(request)
  const sourceId = text(request.data?.sourceId, 200)
  const decision = request.data?.decision
  const note = text(request.data?.note, 500)
  if (!sourceId || (decision !== 'activate' && decision !== 'reject') || !note) {
    throw new HttpsError('invalid-argument', '검토 결과와 메모를 입력해 주세요')
  }
  const reference = db.collection('calendarSources').doc(sourceId)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists) throw new HttpsError('not-found', '캘린더 연결 요청을 찾지 못했어요')
    if (snapshot.get('status') !== 'review_queued') throw new HttpsError('failed-precondition', '검토 대기 중인 연결만 승인하거나 반려할 수 있어요')
    transaction.update(reference, {
      status: decision === 'activate' ? 'active' : 'rejected',
      ...(decision === 'activate' ? { connectionRevision: randomUUID() } : {}),
      reviewNote: note,
      reviewedBy: request.auth?.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  return { sourceId, status: decision === 'activate' ? 'active' : 'rejected' }
})

export const disconnectCalendarSource = onCall({ region: 'asia-northeast3' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요')
  const role = request.auth?.token?.role
  const privileged = role === 'moderator' || role === 'administrator'
  if (!privileged) await requireActorPolicy(request.auth)
  const sourceId = text(request.data?.sourceId, 200)
  if (!sourceId) throw new HttpsError('invalid-argument', '연결을 확인해 주세요')
  const sourceRef = db.collection('calendarSources').doc(sourceId)
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(sourceRef)
    if (!snapshot.exists) throw new HttpsError('not-found', '캘린더 연결을 찾지 못했어요')
    const value = snapshot.data() ?? {}
    if (!privileged && value.ownerUid !== uid) throw new HttpsError('permission-denied', '이 연결을 관리할 권한이 없어요')
    if (value.status === 'disconnected') return { sourceId, status: 'disconnected' as const, repeated: true }
    if (value.status !== 'active' && value.status !== 'review_queued') {
      throw new HttpsError('failed-precondition', '현재 상태에서는 연결을 해제할 수 없어요')
    }
    transaction.update(sourceRef, {
      status: 'disconnected',
      connectionRevision: randomUUID(),
      disconnectedBy: uid,
      disconnectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(db.collection('auditEvents').doc(), {
      type: 'calendar_source.disconnected', sourceId, uid, at: FieldValue.serverTimestamp(),
    })
    return { sourceId, status: 'disconnected' as const, repeated: false }
  })
  return result
})

export function calendarImportCandidateStableId(sourceId: string, event: Pick<IcsEvent, 'uid' | 'startAt' | 'recurrenceId'>) {
  const occurrenceKey = event.recurrenceId ? `instance:${event.recurrenceId}` : 'master'
  return createHash('sha256').update(`${sourceId}:${event.uid}:${occurrenceKey}`).digest('hex').slice(0, 40)
}

export type CalendarImportSourceSnapshot = {
  title: string
  description: string
  locationName: string
  startAt: string
  endAt: string
  allDay: boolean
  timeZone: string
  sourceUrl: string | null
  organizerName: string
  region: string
  topic: string | null
  visibility: 'public' | 'member_only'
}

export const calendarImportApplyFields = [
  'title', 'summary', 'description', 'locationName', 'startAt', 'endAt', 'allDay', 'timeZone',
  'sourceUrl', 'organizerName', 'region', 'topic', 'visibility',
] as const
export type CalendarImportApplyField = typeof calendarImportApplyFields[number]
type CalendarImportSelectableField = CalendarImportApplyField | 'eventState'
const calendarImportSelectableFields: readonly CalendarImportSelectableField[] = [...calendarImportApplyFields, 'eventState']

const calendarImportFieldLabels: Record<CalendarImportApplyField, string> = {
  title: '제목', summary: '요약', description: '설명', locationName: '장소', startAt: '시작', endAt: '종료',
  allDay: '종일', timeZone: '시간대', sourceUrl: '원문 링크', organizerName: '주최', region: '지역', topic: '주제', visibility: '공개 대상',
}

function sourceSnapshotRevision(snapshot: CalendarImportSourceSnapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function dateIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate(): Date }).toDate()
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
}

function sourceValue(snapshot: CalendarImportSourceSnapshot, field: CalendarImportApplyField): string | boolean | null {
  if (field === 'summary') return snapshot.description || `${snapshot.organizerName}에서 공유한 일정이에요`
  return snapshot[field as keyof CalendarImportSourceSnapshot] as string | boolean | null
}

function eventComparable(value: Record<string, unknown>): Record<CalendarImportApplyField, string | boolean | null> {
  return Object.fromEntries(calendarImportApplyFields.map((field) => {
    if (field === 'startAt' || field === 'endAt') return [field, dateIso(value[field])]
    const raw = value[field]
    if (field === 'allDay') return [field, raw === true]
    if (field === 'sourceUrl' || field === 'topic') return [field, typeof raw === 'string' && raw ? raw : null]
    return [field, typeof raw === 'string' ? raw : null]
  })) as Record<CalendarImportApplyField, string | boolean | null>
}

export function calendarImportChangeComparison(snapshot: CalendarImportSourceSnapshot, event: Record<string, unknown>) {
  const current = eventComparable(event)
  const changes = calendarImportApplyFields.flatMap((field) => {
    const next = sourceValue(snapshot, field)
    return current[field] === next ? [] : [{ field, label: calendarImportFieldLabels[field], currentValue: current[field], sourceValue: next }]
  })
  return {
    sourceRevision: sourceSnapshotRevision(snapshot),
    eventRevision: createHash('sha256').update(JSON.stringify(current)).digest('hex'),
    changes,
  }
}

export function calendarImportReimportPlan(
  existing: Record<string, unknown>,
  incoming: CalendarImportSourceSnapshot,
): Record<string, unknown> {
  const incomingRevision = sourceSnapshotRevision(incoming)
  if (existing.status === 'published' || existing.status === 'rejected') {
    if (existing.status === 'published' && (existing.sourceDispositionApplied === 'canceled' || existing.sourceDispositionApplied === 'deleted')) {
      return {
        ...existing,
        pendingSourceSnapshot: null,
        pendingSourceDisposition: 'confirmed',
        pendingSourceRevision: sourceDispositionRevision('confirmed'),
        sourceChangeStatus: 'pending',
        sourceChangedFields: ['eventState'],
      }
    }
    if (existing.sourceRevision === incomingRevision) return {
      ...existing,
      pendingSourceSnapshot: null,
      pendingSourceDisposition: null,
      pendingSourceRevision: null,
      sourceChangeStatus: 'none',
      sourceChangedFields: [],
    }
    const prior = existing.sourceSnapshot as CalendarImportSourceSnapshot | undefined
    const sourceChangedFields = prior
      ? (Object.keys(incoming) as (keyof CalendarImportSourceSnapshot)[]).filter((field) => prior[field] !== incoming[field])
      : Object.keys(incoming)
    return {
      ...existing,
      status: existing.status,
      pendingSourceSnapshot: incoming,
      pendingSourceRevision: incomingRevision,
      sourceChangeStatus: 'pending',
      sourceChangedFields,
    }
  }
  return { ...existing, sourceSnapshot: incoming, sourceRevision: incomingRevision }
}

export type CalendarImportSourceDisposition = 'canceled' | 'deleted' | 'confirmed'

function sourceDispositionRevision(disposition: CalendarImportSourceDisposition) {
  return createHash('sha256').update(`calendar-source-disposition:${disposition}`).digest('hex')
}

export function calendarImportDispositionPlan(
  existing: Record<string, unknown>,
  disposition: Exclude<CalendarImportSourceDisposition, 'confirmed'>,
): Record<string, unknown> {
  if (existing.sourceDispositionApplied === disposition) return {
    ...existing,
    sourceChangeStatus: 'none',
    pendingSourceDisposition: null,
    pendingSourceRevision: null,
  }
  if (existing.status !== 'published') return {
    ...existing,
    sourceChangeStatus: 'none',
    pendingSourceDisposition: null,
    pendingSourceRevision: null,
    sourceDispositionObserved: disposition,
  }
  return {
    ...existing,
    status: 'published',
    sourceChangeStatus: 'pending',
    sourceChangedFields: ['eventState'],
    pendingSourceDisposition: disposition,
    pendingSourceSnapshot: null,
    pendingSourceRevision: sourceDispositionRevision(disposition),
  }
}

export function calendarImportDispositionComparison(
  disposition: CalendarImportSourceDisposition,
  event: Record<string, unknown>,
) {
  const currentValue = event.status === 'unpublished'
    ? '공개 중단'
    : event.eventState === 'canceled' ? '취소됨' : '진행 예정'
  const sourceValue = disposition === 'canceled' ? '원본에서 취소' : disposition === 'deleted' ? '원본에서 삭제' : '원본에서 정상'
  const comparable = { ...eventComparable(event), status: event.status ?? null, eventState: event.eventState ?? null }
  return {
    sourceRevision: sourceDispositionRevision(disposition),
    eventRevision: createHash('sha256').update(JSON.stringify(comparable)).digest('hex'),
    changes: [{ field: 'eventState' as const, label: '행사 상태', currentValue, sourceValue }],
  }
}

function sourceSnapshotFor(event: IcsEvent, source: Record<string, unknown>, feedUrl: string): CalendarImportSourceSnapshot {
  return {
    title: event.title,
    description: event.description,
    locationName: event.location || '장소를 확인해 주세요',
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    allDay: event.allDay,
    timeZone: event.timeZone,
    sourceUrl: safePublicEventUrl(event.sourceUrl, feedUrl) ?? null,
    organizerName: String(source.organizerName ?? ''),
    region: String(source.region ?? ''),
    topic: typeof source.topic === 'string' ? source.topic : null,
    visibility: source.visibility === 'member_only' ? 'member_only' : 'public',
  }
}

function sourceSnapshotRecord(value: unknown): CalendarImportSourceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('failed-precondition', '원본 일정 변경 정보를 다시 가져와 주세요')
  const record = value as Record<string, unknown>
  const required = ['title', 'description', 'locationName', 'startAt', 'endAt', 'timeZone', 'organizerName', 'region'] as const
  const limits: Partial<Record<keyof CalendarImportSourceSnapshot, number>> = {
    title: 120, description: 5_000, locationName: 200, startAt: 40, endAt: 40, timeZone: 80,
    sourceUrl: 2_000, organizerName: 80, region: 40, topic: 80,
  }
  if (required.some((field) => typeof record[field] !== 'string')
    || typeof record.allDay !== 'boolean'
    || (record.sourceUrl !== null && typeof record.sourceUrl !== 'string')
    || (record.topic !== null && typeof record.topic !== 'string')
    || (record.visibility !== 'public' && record.visibility !== 'member_only')
    || !dateIso(record.startAt) || !dateIso(record.endAt)
    || Object.entries(limits).some(([field, limit]) => typeof record[field] === 'string' && record[field].length > limit)
    || (typeof record.sourceUrl === 'string' && safePublicEventUrl(record.sourceUrl) !== record.sourceUrl)) {
    throw new HttpsError('failed-precondition', '원본 일정 변경 정보를 다시 가져와 주세요')
  }
  return record as CalendarImportSourceSnapshot
}

async function resolveCalendarImportCandidateId(sourceId: string, event: IcsEvent): Promise<string> {
  const stableId = calendarImportCandidateStableId(sourceId, event)
  const aliasSnapshot = await db.collection('calendarImportCandidateAliases').doc(stableId).get()
  if (aliasSnapshot.exists) {
    const aliased = aliasSnapshot.get('candidateId')
    if (typeof aliased !== 'string' || !/^[a-f0-9]{40}$/.test(aliased)) throw new HttpsError('failed-precondition', '가져온 일정 연결 정보를 확인해 주세요')
    return aliased
  }
  const stableSnapshot = await db.collection('calendarImportCandidates').doc(stableId).get()
  if (stableSnapshot.exists) {
    if (stableSnapshot.get('sourceId') !== sourceId || stableSnapshot.get('externalUid') !== event.uid) {
      throw new HttpsError('failed-precondition', '가져온 일정 식별자가 충돌해 직접 확인이 필요해요')
    }
    return stableId
  }
  const legacyMatches = await db.collection('calendarImportCandidates')
    .where('sourceId', '==', sourceId)
    .where('externalUid', '==', event.uid)
    .limit(3)
    .get()
  if (legacyMatches.empty) return stableId
  if (event.recurrenceId) {
    const exact = legacyMatches.docs.filter((item) => dateIso(item.get('startAt')) === event.recurrenceId)
    if (exact.length === 1) return exact[0].id
    throw new HttpsError('failed-precondition', '반복 일정 회차를 자동으로 연결할 수 없어 직접 확인이 필요해요')
  }
  if (legacyMatches.size === 1) return legacyMatches.docs[0].id
  throw new HttpsError('failed-precondition', '같은 원본 식별자의 기존 일정이 여러 개라 직접 확인이 필요해요')
}

function candidateTopLevel(snapshot: CalendarImportSourceSnapshot, event: IcsEvent) {
  return {
    title: snapshot.title,
    description: snapshot.description,
    locationName: snapshot.locationName,
    startAt: Timestamp.fromDate(new Date(snapshot.startAt)),
    endAt: Timestamp.fromDate(new Date(snapshot.endAt)),
    allDay: snapshot.allDay,
    timeZone: snapshot.timeZone,
    recurrenceRule: event.recurrenceRule ?? null,
    recurrenceId: event.recurrenceId ?? null,
    sourceUrl: snapshot.sourceUrl ?? FieldValue.delete(),
    organizerName: snapshot.organizerName,
    region: snapshot.region,
    topic: snapshot.topic ?? FieldValue.delete(),
    visibility: snapshot.visibility,
  }
}

const SECRET_QUERY_KEY = /(?:token|secret|signature|sig|key|auth|access[_-]?token|private)/i
const MAX_GALLERY_IMAGES = 8

export function safePublicEventUrl(value: unknown, feedUrl?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const candidate = new URL(validatePublicIcsUrl(value.trim()))
    const feed = feedUrl ? new URL(validatePublicIcsUrl(feedUrl)) : null
    if (feed && candidate.toString() === feed.toString()) return undefined
    if ([...candidate.searchParams.keys()].some((key) => SECRET_QUERY_KEY.test(key))) return undefined
    if (candidate.hostname === 'calendar.google.com' && candidate.pathname.toLowerCase().endsWith('.ics')) return undefined
    return candidate.toString()
  } catch {
    return undefined
  }
}

function approvedImageRecord(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const image = value as Record<string, unknown>
  if (typeof image.url !== 'string' || typeof image.alt !== 'string') return undefined
  const alt = image.alt.trim().slice(0, 180)
  if (!alt) return undefined
  try {
    const url = new URL(image.url)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    if ([...url.searchParams.keys()].some((key) => SECRET_QUERY_KEY.test(key))) return undefined
    const width = typeof image.width === 'number' && image.width >= 1 && image.width <= 10_000
      ? Math.floor(image.width)
      : undefined
    const height = typeof image.height === 'number' && image.height >= 1 && image.height <= 10_000
      ? Math.floor(image.height)
      : undefined
    const displayMode = image.displayMode === 'cover' ? 'cover' : 'contain'
    return { url: url.toString(), alt, ...(width ? { width } : {}), ...(height ? { height } : {}), displayMode }
  } catch {
    return undefined
  }
}

export function approvedCalendarMediaRecord(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const media = value as Record<string, unknown>
  if (media.status !== 'approved') return undefined
  const thumbnail = approvedImageRecord(media.thumbnail)
  const gallery = Array.isArray(media.gallery)
    ? media.gallery.map(approvedImageRecord).filter((image) => image !== undefined).slice(0, MAX_GALLERY_IMAGES)
    : []
  if (!thumbnail && gallery.length === 0) return undefined
  return { status: 'approved', ...(thumbnail ? { thumbnail } : {}), ...(gallery.length ? { gallery } : {}) }
}

export function publicCalendarEventRecord(value: Record<string, unknown>) {
  const sourceUrl = safePublicEventUrl(value.sourceUrl, typeof value.feedUrl === 'string' ? value.feedUrl : undefined)
  const media = approvedCalendarMediaRecord(value.media)
  return {
    title: value.title,
    summary: value.summary,
    description: value.description,
    organizerName: value.organizerName,
    startAt: value.startAt,
    endAt: value.endAt,
    allDay: value.allDay === true,
    timeZone: value.timeZone || 'Asia/Seoul',
    ...(typeof value.topic === 'string' ? { topic: value.topic } : {}),
    region: value.region,
    locationName: value.locationName,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(media ? { media } : {}),
    instagramPosts: readEventInstagramPosts(value.instagramPosts),
    visibility: value.visibility === 'member_only' ? 'member_only' : 'public',
    eventState: 'confirmed',
    sourceType: value.sourceType === 'google_public_ics' || value.sourceType === 'google'
      ? 'google'
      : value.sourceType === 'timetree_link' ? 'timetree_link' : 'ics',
    monthKeys: value.monthKeys,
    status: 'published',
    publishedAt: value.publishedAt,
    updatedAt: value.updatedAt,
  }
}

export class CalendarReviewContractError extends Error {}

export function reviewedCalendarEventRecord(value: Record<string, unknown>) {
  if (value.status !== 'pending_review') throw new CalendarReviewContractError('검토 대기 중인 일정만 공개할 수 있어요')
  return publicCalendarEventRecord(value)
}

export const getCalendarImportChange = onCall({ region: 'asia-northeast3' }, async (request) => {
  operator(request)
  const candidateIdValue = text(request.data?.candidateId, 200)
  if (!candidateIdValue) throw new HttpsError('invalid-argument', '가져온 일정을 확인해 주세요')
  const candidateRef = db.collection('calendarImportCandidates').doc(candidateIdValue)
  const eventRef = db.collection('calendarEvents').doc(candidateIdValue)
  const [candidateSnapshot, eventSnapshot] = await Promise.all([candidateRef.get(), eventRef.get()])
  if (!candidateSnapshot.exists || !eventSnapshot.exists) throw new HttpsError('not-found', '비교할 공개 일정을 찾지 못했어요')
  const candidate = candidateSnapshot.data() ?? {}
  if (candidate.status !== 'published' || candidate.sourceChangeStatus !== 'pending') {
    throw new HttpsError('failed-precondition', '적용을 기다리는 원본 변경이 없어요')
  }
  const sourceId = String(candidate.sourceId ?? '')
  const sourceSnapshot = await db.collection('calendarSources').doc(sourceId).get()
  if (!sourceSnapshot.exists) throw new HttpsError('failed-precondition', '원본 캘린더 연결을 찾지 못했어요')
  const disposition = candidate.pendingSourceDisposition === 'canceled' || candidate.pendingSourceDisposition === 'deleted' || candidate.pendingSourceDisposition === 'confirmed'
    ? candidate.pendingSourceDisposition
    : null
  const comparison = disposition
    ? calendarImportDispositionComparison(disposition, eventSnapshot.data() ?? {})
    : (() => {
        const pending = sourceSnapshotRecord(candidate.pendingSourceSnapshot)
        if (candidate.pendingSourceRevision !== sourceSnapshotRevision(pending)) {
          throw new HttpsError('failed-precondition', '원본 일정 변경 정보를 다시 가져와 주세요')
        }
        return calendarImportChangeComparison(pending, eventSnapshot.data() ?? {})
      })()
  if (candidate.pendingSourceRevision !== comparison.sourceRevision) {
    throw new HttpsError('failed-precondition', '원본 일정 변경 정보를 다시 가져와 주세요')
  }
  return {
    candidateId: candidateIdValue,
    sourceId,
    sourceStatus: sourceSnapshot.get('status') === 'active' ? 'active' : 'disconnected',
    ...comparison,
  }
})

export const applyCalendarImportChange = onCall({ region: 'asia-northeast3' }, async (request) => {
  operator(request)
  const candidateIdValue = text(request.data?.candidateId, 200)
  const expectedSourceRevision = text(request.data?.expectedSourceRevision, 128)
  const expectedEventRevision = text(request.data?.expectedEventRevision, 128)
  const requestedFields = request.data?.fields
  if (!candidateIdValue || !expectedSourceRevision || !expectedEventRevision || !Array.isArray(requestedFields)
    || requestedFields.length < 1 || requestedFields.length > calendarImportSelectableFields.length) {
    throw new HttpsError('invalid-argument', '적용할 변경을 선택해 주세요')
  }
  const fields = [...new Set(requestedFields)]
  if (fields.length !== requestedFields.length || fields.some((field) => typeof field !== 'string' || !calendarImportSelectableFields.includes(field as CalendarImportSelectableField))) {
    throw new HttpsError('invalid-argument', '적용할 변경 항목을 확인해 주세요')
  }
  const selectedFields = fields as CalendarImportSelectableField[]
  const candidateRef = db.collection('calendarImportCandidates').doc(candidateIdValue)
  const eventRef = db.collection('calendarEvents').doc(candidateIdValue)
  return db.runTransaction(async (transaction) => {
    const candidateSnapshot = await transaction.get(candidateRef)
    if (!candidateSnapshot.exists) throw new HttpsError('not-found', '가져온 일정을 찾지 못했어요')
    const candidate = candidateSnapshot.data() ?? {}
    const sourceRef = db.collection('calendarSources').doc(String(candidate.sourceId ?? ''))
    const [eventSnapshot, sourceSnapshot] = await Promise.all([transaction.get(eventRef), transaction.get(sourceRef)])
    if (!eventSnapshot.exists) throw new HttpsError('not-found', '비교할 공개 일정을 찾지 못했어요')
    if (!sourceSnapshot.exists || sourceSnapshot.get('status') !== 'active') {
      throw new HttpsError('failed-precondition', '연결이 해제된 원본 변경은 적용할 수 없어요')
    }
    if (candidate.status !== 'published' || candidate.sourceChangeStatus !== 'pending') {
      throw new HttpsError('failed-precondition', '적용을 기다리는 원본 변경이 없어요')
    }
    const disposition = candidate.pendingSourceDisposition === 'canceled' || candidate.pendingSourceDisposition === 'deleted' || candidate.pendingSourceDisposition === 'confirmed'
      ? candidate.pendingSourceDisposition
      : null
    const pending = disposition ? null : sourceSnapshotRecord(candidate.pendingSourceSnapshot)
    const comparison = disposition
      ? calendarImportDispositionComparison(disposition, eventSnapshot.data() ?? {})
      : calendarImportChangeComparison(pending as CalendarImportSourceSnapshot, eventSnapshot.data() ?? {})
    if (candidate.pendingSourceRevision !== expectedSourceRevision || comparison.sourceRevision !== expectedSourceRevision
      || comparison.eventRevision !== expectedEventRevision) {
      throw new HttpsError('aborted', '원본 또는 위브 일정이 바뀌었어요 다시 비교해 주세요')
    }
    const changed = new Set(comparison.changes.map((item) => item.field))
    if (selectedFields.some((field) => !changed.has(field))) throw new HttpsError('failed-precondition', '이미 같은 값인 항목이 포함되어 있어 다시 비교해 주세요')
    if (disposition) {
      if (selectedFields.length !== 1 || selectedFields[0] !== 'eventState') {
        throw new HttpsError('failed-precondition', '원본 행사 상태를 다시 비교해 주세요')
      }
      transaction.set(eventRef, disposition === 'canceled'
        ? { eventState: 'canceled', updatedAt: FieldValue.serverTimestamp() }
        : disposition === 'deleted'
          ? { status: 'unpublished', updatedAt: FieldValue.serverTimestamp() }
          : { status: 'published', eventState: 'confirmed', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      transaction.update(candidateRef, {
        pendingSourceDisposition: null,
        pendingSourceRevision: null,
        sourceChangeStatus: 'applied',
        sourceChangedFields: [],
        sourceDispositionApplied: disposition === 'confirmed' ? null : disposition,
        sourceAppliedAt: FieldValue.serverTimestamp(),
        sourceAppliedBy: request.auth?.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('auditEvents').doc(), {
        type: 'calendar_import.source_disposition_applied',
        candidateId: candidateIdValue,
        sourceId: String(candidate.sourceId ?? ''),
        disposition,
        sourceRevision: expectedSourceRevision,
        priorEventRevision: expectedEventRevision,
        operatorUid: request.auth?.uid,
        at: FieldValue.serverTimestamp(),
      })
      return {
        candidateId: candidateIdValue,
        status: 'applied' as const,
        remainingChanges: 0,
        sourceRevision: expectedSourceRevision,
        eventRevision: calendarImportDispositionComparison(disposition, {
          ...(eventSnapshot.data() ?? {}),
          ...(disposition === 'canceled'
            ? { eventState: 'canceled' }
            : disposition === 'deleted' ? { status: 'unpublished' } : { status: 'published', eventState: 'confirmed' }),
        }).eventRevision,
      }
    }
    const event = eventSnapshot.data() ?? {}
    const simulated: Record<string, unknown> = { ...event }
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    for (const field of selectedFields as CalendarImportApplyField[]) {
      const next = sourceValue(pending as CalendarImportSourceSnapshot, field)
      simulated[field] = next
      if (field === 'startAt' || field === 'endAt') update[field] = Timestamp.fromDate(new Date(String(next)))
      else if ((field === 'sourceUrl' || field === 'topic') && next === null) update[field] = FieldValue.delete()
      else update[field] = next
    }
    const nextStart = dateIso(simulated.startAt)
    const nextEnd = dateIso(simulated.endAt)
    if (!nextStart || !nextEnd || Date.parse(nextEnd) <= Date.parse(nextStart)
      || Date.parse(nextEnd) - Date.parse(nextStart) > 31 * 86_400_000) {
      throw new HttpsError('failed-precondition', '적용할 원본 일정 시간을 확인해 주세요')
    }
    if (selectedFields.some((field) => field === 'startAt' || field === 'endAt' || field === 'allDay' || field === 'timeZone')) {
      update.monthKeys = monthKeysBetween(new Date(nextStart), new Date(nextEnd))
    }
    const remaining = calendarImportChangeComparison(pending as CalendarImportSourceSnapshot, simulated).changes.length
    transaction.set(eventRef, update, { merge: true })
    transaction.update(candidateRef, remaining === 0 ? {
      sourceSnapshot: pending,
      sourceRevision: expectedSourceRevision,
      pendingSourceSnapshot: null,
      pendingSourceRevision: null,
      sourceChangeStatus: 'applied',
      sourceChangedFields: [],
      sourceAppliedAt: FieldValue.serverTimestamp(),
      sourceAppliedBy: request.auth?.uid,
      updatedAt: FieldValue.serverTimestamp(),
    } : {
      sourceChangedFields: calendarImportChangeComparison(pending as CalendarImportSourceSnapshot, simulated).changes.map((item) => item.field),
      sourceChangeStatus: 'pending',
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(db.collection('auditEvents').doc(), {
      type: 'calendar_import.source_changes_applied',
      candidateId: candidateIdValue,
      sourceId: String(candidate.sourceId ?? ''),
      fields: selectedFields,
      sourceRevision: expectedSourceRevision,
      priorEventRevision: expectedEventRevision,
      remainingChanges: remaining,
      operatorUid: request.auth?.uid,
      at: FieldValue.serverTimestamp(),
    })
    const nextComparison = calendarImportChangeComparison(pending as CalendarImportSourceSnapshot, simulated)
    return {
      candidateId: candidateIdValue,
      status: remaining === 0 ? 'applied' as const : 'partially_applied' as const,
      remainingChanges: remaining,
      sourceRevision: expectedSourceRevision,
      eventRevision: nextComparison.eventRevision,
    }
  })
})

export function calendarImportWindow(now: Date) {
  return {
    startAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    endAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 13, 1)),
  }
}

function recurrenceParts(value: string) {
  const parts = Object.fromEntries(value.split(';').map((part) => {
    const delimiter = part.indexOf('=')
    if (delimiter <= 0) throw new IcsContractError('unsupported_recurrence')
    return [part.slice(0, delimiter).toUpperCase(), part.slice(delimiter + 1).toUpperCase()]
  }))
  if (Object.keys(parts).some((key) => !['FREQ', 'COUNT', 'UNTIL', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH'].includes(key))) {
    throw new IcsContractError('unsupported_recurrence')
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(parts.FREQ)) throw new IcsContractError('unsupported_recurrence')
  const interval = parts.INTERVAL === undefined ? 1 : Number(parts.INTERVAL)
  const count = parts.COUNT === undefined ? undefined : Number(parts.COUNT)
  if (!Number.isInteger(interval) || interval < 1 || interval > 366
    || (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 500))) {
    throw new IcsContractError('unsupported_recurrence')
  }
  let until: Date | undefined
  if (parts.UNTIL) {
    const match = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/)
    if (!match) throw new IcsContractError('unsupported_recurrence')
    until = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 23), Number(match[5] ?? 59), Number(match[6] ?? 59)))
  }
  const list = (key: string, minimum: number, maximum: number, allowNegative = false) => {
    if (!parts[key]) return undefined
    const values = parts[key].split(',').map(Number)
    if (values.some((item) => !Number.isInteger(item) || item === 0 || item > maximum || item < (allowNegative ? -maximum : minimum))) {
      throw new IcsContractError('unsupported_recurrence')
    }
    return [...new Set(values)]
  }
  const byMonth = list('BYMONTH', 1, 12)
  const byMonthDay = list('BYMONTHDAY', 1, 31, true)
  const weekdays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  const byDay = parts.BYDAY?.split(',').map((item) => {
    const match = item.match(/^([+-]?[1-5])?(SU|MO|TU|WE|TH|FR|SA)$/)
    if (!match) throw new IcsContractError('unsupported_recurrence')
    return { ordinal: match[1] ? Number(match[1]) : undefined, weekday: weekdays.indexOf(match[2]) }
  })
  if (byDay && byMonthDay) throw new IcsContractError('unsupported_recurrence')
  if (parts.FREQ === 'DAILY' && (byDay || byMonthDay || byMonth)) throw new IcsContractError('unsupported_recurrence')
  if (parts.FREQ === 'WEEKLY' && (byMonthDay || byMonth || byDay?.some((item) => item.ordinal !== undefined))) {
    throw new IcsContractError('unsupported_recurrence')
  }
  if (parts.FREQ === 'MONTHLY' && byMonth) throw new IcsContractError('unsupported_recurrence')
  if (parts.FREQ === 'YEARLY' && !byMonth && (byDay || byMonthDay)) {
    throw new IcsContractError('unsupported_recurrence')
  }
  return { frequency: parts.FREQ, interval, count, until, byMonth, byMonthDay, byDay }
}

type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function localDateTime(value: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second) }
}

function fromLocalDateTime(value: LocalDateTime, timeZone: string) {
  const desiredUtc = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second)
  const zoneOffset = (date: Date) => {
    const zoned = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)
    const values = Object.fromEntries(zoned.map((part) => [part.type, part.value]))
    return Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second),
    ) - date.getTime()
  }
  let next = new Date(desiredUtc - zoneOffset(new Date(desiredUtc)))
  next = new Date(desiredUtc - zoneOffset(next))
  return next
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function weekday(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function monthDay(value: number, total: number) {
  const day = value > 0 ? value : total + value + 1
  return day >= 1 && day <= total ? day : null
}

function daysForPeriod(
  year: number,
  month: number,
  masterDay: number,
  rule: ReturnType<typeof recurrenceParts>,
) {
  const total = daysInMonth(year, month)
  if (rule.byMonthDay) return rule.byMonthDay.flatMap((value) => {
    const day = monthDay(value, total)
    return day === null ? [] : [day]
  })
  if (!rule.byDay) return masterDay <= total ? [masterDay] : []
  return rule.byDay.flatMap(({ weekday: target, ordinal }) => {
    const matches = Array.from({ length: total }, (_, index) => index + 1).filter((day) => weekday(year, month, day) === target)
    if (ordinal === undefined) return matches
    const selected = ordinal > 0 ? matches[ordinal - 1] : matches[matches.length + ordinal]
    return selected === undefined ? [] : [selected]
  })
}

function recurrencePeriodCandidates(
  master: LocalDateTime,
  timeZone: string,
  rule: ReturnType<typeof recurrenceParts>,
  period: number,
) {
  const locals: LocalDateTime[] = []
  if (rule.frequency === 'DAILY') {
    const date = new Date(Date.UTC(master.year, master.month - 1, master.day + period * rule.interval))
    locals.push({ ...master, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() })
  } else if (rule.frequency === 'WEEKLY') {
    const masterDate = new Date(Date.UTC(master.year, master.month - 1, master.day))
    const mondayOffset = (masterDate.getUTCDay() + 6) % 7
    const weekStart = new Date(masterDate.getTime() - mondayOffset * 86_400_000 + period * rule.interval * 7 * 86_400_000)
    const weekdays = rule.byDay?.map((item) => item.weekday) ?? [masterDate.getUTCDay()]
    for (const target of weekdays) {
      const offset = (target + 6) % 7
      const date = new Date(weekStart.getTime() + offset * 86_400_000)
      locals.push({ ...master, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() })
    }
  } else if (rule.frequency === 'MONTHLY') {
    const monthIndex = master.year * 12 + master.month - 1 + period * rule.interval
    const year = Math.floor(monthIndex / 12)
    const month = monthIndex % 12 + 1
    for (const day of daysForPeriod(year, month, master.day, rule)) locals.push({ ...master, year, month, day })
  } else {
    const year = master.year + period * rule.interval
    for (const month of rule.byMonth ?? [master.month]) {
      for (const day of daysForPeriod(year, month, master.day, rule)) locals.push({ ...master, year, month, day })
    }
  }
  return [...new Map(locals.map((item) => [`${item.year}-${item.month}-${item.day}`, item])).values()]
    .map((item) => fromLocalDateTime(item, timeZone))
    .sort((left, right) => left.getTime() - right.getTime())
}

export function expandRecurringIcsEvents(events: IcsEvent[], now = new Date()) {
  const window = calendarImportWindow(now)
  const exceptions = new Map(events.filter((event) => event.recurrenceId).map((event) => [`${event.uid}:${event.recurrenceId}`, event]))
  const expanded: IcsEvent[] = []
  for (const event of events) {
    if (event.recurrenceId) continue
    if (!event.recurrenceRule) {
      expanded.push(event)
      continue
    }
    const rule = recurrenceParts(event.recurrenceRule)
    const duration = event.endAt.getTime() - event.startAt.getTime()
    let occurrence = 0
    let bounded = false
    const master = localDateTime(event.startAt, event.timeZone)
    periods: for (let period = 0; period < 10_000; period += 1) {
      const scheduledDates = recurrencePeriodCandidates(master, event.timeZone, rule, period)
        .filter((date) => date >= event.startAt)
      if (scheduledDates[0] && scheduledDates[0] >= window.endAt) {
        bounded = true
        break
      }
      for (const scheduled of scheduledDates) {
        if (rule.until && scheduled > rule.until) {
          bounded = true
          break periods
        }
        if (rule.count !== undefined && occurrence >= rule.count) {
          bounded = true
          break periods
        }
        const recurrenceId = scheduled.toISOString()
        const exception = exceptions.get(`${event.uid}:${recurrenceId}`)
        const nextEvent = exception ?? {
          ...event,
          startAt: new Date(scheduled),
          endAt: new Date(scheduled.getTime() + duration),
          ...(scheduled.getTime() === event.startAt.getTime() ? {} : { recurrenceId }),
        }
        if (nextEvent.endAt > window.startAt && nextEvent.startAt < window.endAt) expanded.push(nextEvent)
        occurrence += 1
        if (expanded.length > 500) throw new IcsContractError('too_many_events')
      }
    }
    if (!bounded && (rule.count === undefined || occurrence < rule.count)) throw new IcsContractError('unsupported_recurrence')
  }
  if (expanded.length > 500) throw new IcsContractError('too_many_events')
  return expanded
}

export function boundedUniqueIcsEvents(events: IcsEvent[], now = new Date()) {
  const window = calendarImportWindow(now)
  const seen = new Set<string>()
  return events.filter((event) => {
    if (event.startAt >= window.endAt || event.endAt <= window.startAt) return false
    const fingerprint = `${event.uid}:${event.startAt.toISOString()}`
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

export function shouldMarkMissingCalendarCandidate(input: {
  candidateId: string
  startAt: unknown
  seenCandidateIds: ReadonlySet<string>
  window: { startAt: Date; endAt: Date }
  completeSnapshot: boolean
}) {
  if (!input.completeSnapshot || input.seenCandidateIds.has(input.candidateId)) return false
  const startAt = dateIso(input.startAt)
  return startAt !== null && new Date(startAt) >= input.window.startAt && new Date(startAt) < input.window.endAt
}

export async function ingestCalendarIcs(options: {
  sourceId: string
  feedUrl: string
  body: string
  source: Record<string, unknown>
  expectedConnectionRevision?: string
  now?: Date
}) {
  let parsedEvents: IcsEvent[]
  try {
    parsedEvents = expandRecurringIcsEvents(parseIcs(options.body, icsLimits.maxEventsPerSync), options.now)
  } catch (error) {
    if (error instanceof IcsContractError && error.code === 'too_many_events') {
      throw new HttpsError('resource-exhausted', '한 번에 가져올 수 있는 일정은 500개까지예요')
    }
    if (error instanceof IcsContractError && error.code === 'unsupported_recurrence') {
      throw new HttpsError('failed-precondition', '지원하지 않는 반복 규칙이 있어 자동으로 가져오지 않았어요')
    }
    throw error
  }
  const events = boundedUniqueIcsEvents(parsedEvents, options.now)
  const stableIdentities = events.map((event) => calendarImportCandidateStableId(options.sourceId, event))
  if (new Set(stableIdentities).size !== stableIdentities.length) {
    throw new HttpsError('failed-precondition', '같은 원본 식별자의 일정이 여러 회차로 보여 직접 확인이 필요해요')
  }
  const seenCandidateIds = new Set<string>()
  for (const event of events) {
    const id = await resolveCalendarImportCandidateId(options.sourceId, event)
    seenCandidateIds.add(id)
    const stableId = calendarImportCandidateStableId(options.sourceId, event)
    const candidateRef = db.collection('calendarImportCandidates').doc(id)
    const aliasRef = db.collection('calendarImportCandidateAliases').doc(stableId)
    const sourceRef = db.collection('calendarSources').doc(options.sourceId)
    const incoming = sourceSnapshotFor(event, options.source, options.feedUrl)
    await db.runTransaction(async (transaction) => {
      const [candidateSnapshot, sourceSnapshot, aliasSnapshot] = await Promise.all([
        transaction.get(candidateRef), transaction.get(sourceRef), transaction.get(aliasRef),
      ])
      if (options.expectedConnectionRevision !== undefined) {
        const liveSource = sourceSnapshot.data() ?? {}
        const liveRevision = String(liveSource.connectionRevision ?? 'legacy-active')
        if (liveSource.status !== 'active' || liveRevision !== options.expectedConnectionRevision) {
          throw new HttpsError('aborted', '연결 상태가 바뀌어 가져오기를 중단했어요')
        }
      }
      if (aliasSnapshot.exists && aliasSnapshot.get('candidateId') !== id) {
        throw new HttpsError('aborted', '가져온 일정 연결 상태가 바뀌었어요 다시 시도해 주세요')
      }
      const existing = candidateSnapshot.data() ?? {}
      if (event.status === 'cancelled' && !candidateSnapshot.exists) return
      if (event.status === 'cancelled') {
        transaction.set(candidateRef, {
          ...calendarImportDispositionPlan(existing, 'canceled'),
          importedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        transaction.set(aliasRef, { candidateId: id, sourceId: options.sourceId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        return
      }
      if (candidateSnapshot.exists && (existing.sourceId !== options.sourceId || existing.externalUid !== event.uid)) {
        throw new HttpsError('failed-precondition', '가져온 일정 식별자가 충돌해 직접 확인이 필요해요')
      }
      const plan = candidateSnapshot.exists
        ? calendarImportReimportPlan(existing, incoming)
        : {
            sourceSnapshot: incoming,
            sourceRevision: sourceSnapshotRevision(incoming),
            sourceChangeStatus: 'none',
            sourceChangedFields: [],
            status: 'pending_review',
          }
      const reviewed = existing.status === 'published' || existing.status === 'rejected'
      transaction.set(candidateRef, {
        ...plan,
        sourceId: options.sourceId,
        externalUid: event.uid,
        stableIdentity: stableId,
        sourceType: options.source.sourceType,
        ...(!reviewed ? candidateTopLevel(incoming, event) : {}),
        importedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.set(aliasRef, { candidateId: id, sourceId: options.sourceId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
  }
  const importWindow = calendarImportWindow(options.now ?? new Date())
  const existingCandidates = await db.collection('calendarImportCandidates').where('sourceId', '==', options.sourceId).get()
  for (const candidate of existingCandidates.docs) {
    if (!shouldMarkMissingCalendarCandidate({
      candidateId: candidate.id,
      startAt: candidate.get('startAt'),
      seenCandidateIds,
      window: importWindow,
      completeSnapshot: true,
    })) continue
    const candidateRef = db.collection('calendarImportCandidates').doc(candidate.id)
    const sourceRef = db.collection('calendarSources').doc(options.sourceId)
    await db.runTransaction(async (transaction) => {
      const [currentCandidate, currentSource] = await Promise.all([transaction.get(candidateRef), transaction.get(sourceRef)])
      if (!currentCandidate.exists) return
      if (options.expectedConnectionRevision !== undefined) {
        const liveSource = currentSource.data() ?? {}
        if (liveSource.status !== 'active' || String(liveSource.connectionRevision ?? 'legacy-active') !== options.expectedConnectionRevision) {
          throw new HttpsError('aborted', '연결 상태가 바뀌어 가져오기를 중단했어요')
        }
      }
      transaction.set(candidateRef, {
        ...calendarImportDispositionPlan(currentCandidate.data() ?? {}, 'deleted'),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
  }
  const sourceRef = db.collection('calendarSources').doc(options.sourceId)
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(sourceRef)
    if (options.expectedConnectionRevision !== undefined) {
      const value = current.data() ?? {}
      if (value.status !== 'active' || String(value.connectionRevision ?? 'legacy-active') !== options.expectedConnectionRevision) {
        throw new HttpsError('aborted', '연결 상태가 바뀌어 가져오기 결과를 기록하지 않았어요')
      }
    }
    transaction.update(sourceRef, {
      lastSyncStatus: 'succeeded',
      lastSyncAt: FieldValue.serverTimestamp(),
      lastSyncCount: events.filter((event) => event.status !== 'cancelled').length,
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  return events.filter((event) => event.status !== 'cancelled').length
}

export const syncCalendarSourcePreview = onCall({ region: 'asia-northeast3', timeoutSeconds: 30 }, async (request) => {
  operator(request)
  const sourceId = text(request.data?.sourceId, 200)
  const body = typeof request.data?.icsText === 'string' ? request.data.icsText : ''
  if (!sourceId || !body) throw new HttpsError('invalid-argument', '캘린더 연결 요청과 확인할 ICS 내용을 입력해 주세요')
  const reference = db.collection('calendarSources').doc(sourceId)
  const snapshot = await reference.get()
  if (!snapshot.exists || snapshot.get('status') !== 'active') {
    throw new HttpsError('failed-precondition', '승인된 캘린더만 동기화할 수 있어요')
  }
  const source = snapshot.data() ?? {}
  if (source.sourceType === 'timetree_link') {
    throw new HttpsError('failed-precondition', 'TimeTree 공개 링크는 위브에서 바로 열어 볼 수 있도록 연결돼요')
  }
  const feedUrl = validatePublicIcsUrl(String(source.feedUrl ?? ''))
  const expectedConnectionRevision = String(source.connectionRevision ?? 'legacy-active')
  const count = await ingestCalendarIcs({ sourceId, feedUrl, body, source, expectedConnectionRevision })
  return { sourceId, imported: count, status: 'pending_review' }
})

export const syncGooglePublicCalendarSource = onCall({ region: 'asia-northeast3', timeoutSeconds: 30 }, async (request) => {
  operator(request)
  const sourceId = text(request.data?.sourceId, 200)
  const reference = db.collection('calendarSources').doc(sourceId)
  const snapshot = await reference.get()
  if (!snapshot.exists || snapshot.get('status') !== 'active' || snapshot.get('sourceType') !== 'google_public_ics') {
    throw new HttpsError('failed-precondition', '승인된 Google 공개 캘린더만 동기화할 수 있어요')
  }
  const source = snapshot.data() ?? {}
  const feedUrl = validatePublicIcsUrl(String(source.feedUrl ?? ''))
  if (new URL(feedUrl).hostname !== 'calendar.google.com') {
    throw new HttpsError('failed-precondition', 'Google Calendar의 공개 iCal 주소를 다시 확인해 주세요')
  }
  const response = await fetch(feedUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(icsLimits.timeoutMs),
    headers: { accept: 'text/calendar,text/plain;q=0.8' },
  }).catch(() => {
    throw new HttpsError('unavailable', 'Google Calendar에서 일정을 가져오지 못했어요')
  })
  if (!response.ok) throw new HttpsError('unavailable', 'Google Calendar 공개 설정과 iCal 주소를 확인해 주세요')
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > icsLimits.maxBytes) throw new HttpsError('resource-exhausted', '캘린더 파일이 5MB를 넘어요')
  const body = await response.text()
  if (Buffer.byteLength(body, 'utf8') > icsLimits.maxBytes) throw new HttpsError('resource-exhausted', '캘린더 파일이 5MB를 넘어요')
  const expectedConnectionRevision = String(source.connectionRevision ?? 'legacy-active')
  const count = await ingestCalendarIcs({ sourceId, feedUrl, body, source, expectedConnectionRevision })
  return { sourceId, imported: count, status: 'pending_review' }
})

function monthKeysBetween(startAt: Date, endAt: Date) {
  if (endAt.getTime() - startAt.getTime() > 31 * 86_400_000) {
    throw new HttpsError('failed-precondition', '31일이 넘는 일정은 내용을 확인한 뒤 직접 등록해 주세요')
  }
  const cursor = new Date(Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth(), 1))
  const end = new Date(Date.UTC(endAt.getUTCFullYear(), endAt.getUTCMonth(), 1))
  const keys: string[] = []
  while (cursor <= end) {
    keys.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`)
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return keys
}

export const reviewCalendarImportCandidate = onCall({ region: 'asia-northeast3' }, async (request) => {
  operator(request)
  const candidateId = text(request.data?.candidateId, 200)
  const decision = request.data?.decision
  const note = text(request.data?.note, 500)
  if (!candidateId || (decision !== 'publish' && decision !== 'reject') || !note) {
    throw new HttpsError('invalid-argument', '검토 결과와 메모를 입력해 주세요')
  }
  const candidateRef = db.collection('calendarImportCandidates').doc(candidateId)
  const eventRef = db.collection('calendarEvents').doc(candidateId)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(candidateRef)
    if (!snapshot.exists) throw new HttpsError('not-found', '가져온 일정을 찾지 못했어요')
    const value = snapshot.data() ?? {}
    if (value.status !== 'pending_review') throw new HttpsError('failed-precondition', '이미 검토를 마친 일정이에요')
    if (decision === 'publish') {
      const startAt = value.startAt as Timestamp
      const endAt = value.endAt as Timestamp
      if (!(startAt instanceof Timestamp) || !(endAt instanceof Timestamp)) {
        throw new HttpsError('failed-precondition', '일정의 시작과 종료 시간을 확인해 주세요')
      }
      transaction.set(eventRef, reviewedCalendarEventRecord({
        status: value.status,
        title: value.title,
        summary: value.description || `${value.organizerName}에서 공유한 일정이에요`,
        description: value.description || '',
        organizerName: value.organizerName,
        startAt,
        endAt,
        allDay: value.allDay === true,
        timeZone: value.timeZone || 'Asia/Seoul',
        ...(typeof value.topic === 'string' ? { topic: value.topic } : {}),
        region: value.region,
        locationName: value.locationName || '장소를 확인해 주세요',
        sourceUrl: value.sourceUrl,
        media: value.media,
        visibility: value.visibility === 'member_only' ? 'member_only' : 'public',
        sourceType: value.sourceType,
        monthKeys: monthKeysBetween(startAt.toDate(), endAt.toDate()),
        publishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }))
    }
    transaction.update(candidateRef, {
      status: decision === 'publish' ? 'published' : 'rejected',
      reviewNote: note,
      reviewedBy: request.auth?.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  return { candidateId, status: decision === 'publish' ? 'published' : 'rejected' }
})
