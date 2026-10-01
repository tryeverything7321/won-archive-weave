import { createHash, randomUUID } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore, type DocumentData } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireActorPolicy } from '../community/actor-policy.js'
import {
  assertAttestationMatchesObjects,
  parseScanAttestation,
  requireScanAttestor,
  type QuarantinedObjectFingerprint,
  type ScanAttestation,
} from '../uploads/scan-attestation.js'
import {
  operatorModerationBlocksPublication,
  operatorModerationCommandKey,
  projectOperatorModerationNotice,
  validateReasonedContentModeration,
  type OperatorVisibilityAction,
  type ReasonedContentModerationAction,
} from '../uploads/content-moderation.js'
import { normalizeEventInstagramPosts, readEventInstagramPosts, type EventInstagramPost } from './event-instagram.js'

if (!getApps().length) initializeApp()

const db = getFirestore()
const EVENT_COLLECTION = 'calendarEventSubmissions'
const PUBLIC_EVENT_COLLECTION = 'calendarEvents'
const TRUST_COLLECTION = 'calendarOrganizerTrust'
const MAX_GALLERY = 8
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const APPROVAL_LEASE_MS = 5 * 60 * 1_000
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const SECRET_QUERY_KEY = /(?:token|secret|signature|sig|key|auth|access[_-]?token|private)/i

export type EventManagementStatus = 'draft' | 'review_queued' | 'publishing' | 'publishing_failed' | 'published' | 'updated' | 'canceled' | 'unpublished'
export type EventRegistrationStatus = 'open' | 'closing_soon' | 'closed' | 'not_required'
export type EventVisibility = 'public' | 'member_only'

export function ownerEventTransitionPlan(
  status: EventManagementStatus,
  action: 'cancel' | 'unpublish',
  hasPublicProjection: boolean,
): {
  nextStatus: 'canceled' | 'unpublished'
  publicAction: 'mark_canceled' | 'remove' | 'unchanged'
  repeated: boolean
} {
  if (status === 'publishing') {
    throw new EventManagementContractError('invalid_transition')
  }
  if (action === 'cancel') {
    if (status === 'unpublished') throw new EventManagementContractError('invalid_transition')
    if (status === 'canceled') {
      return { nextStatus: 'canceled', publicAction: 'unchanged', repeated: true }
    }
  } else if (status === 'unpublished') {
    return { nextStatus: 'unpublished', publicAction: 'unchanged', repeated: true }
  }
  return {
    nextStatus: action === 'cancel' ? 'canceled' : 'unpublished',
    publicAction: action === 'cancel' && hasPublicProjection
      ? 'mark_canceled'
      : action === 'unpublish' && hasPublicProjection
        ? 'remove'
        : 'unchanged',
    repeated: false,
  }
}

export function ownerEventRestoreAllowed(status: EventManagementStatus, hasPublicProjection: boolean, operatorBlocked: boolean): boolean {
  return status === 'unpublished' && !hasPublicProjection && !operatorBlocked
}

export function assertRestorableManualEventProjection(value: Record<string, unknown>): void {
  if (value.status !== 'unpublished' || value.sourceType !== 'manual') {
    throw new HttpsError('failed-precondition', '복원할 안전한 행사 공개본을 찾지 못했어요')
  }
}

export function manualEventModerationPlan(input: {
  status: EventManagementStatus
  action: ReasonedContentModerationAction
  hasPublicProjection: boolean
  hasPriorGuidance: boolean
  markerAction?: OperatorVisibilityAction
}): {
  nextStatus: EventManagementStatus
  publicAction: 'unchanged' | 'hide' | 'restore'
  markerAction: OperatorVisibilityAction | null
} {
  if (input.action === 'warn') {
    if (input.status === 'canceled') throw new HttpsError('failed-precondition', '취소된 행사에는 운영 안내를 보낼 수 없어요')
    return { nextStatus: input.status, publicAction: 'unchanged', markerAction: input.markerAction ?? null }
  }
  if (input.action === 'request_correction') {
    if (!input.hasPublicProjection || input.status === 'canceled' || input.status === 'publishing') throw new HttpsError('failed-precondition', '현재 행사에는 수정 요청을 보낼 수 없어요')
    return { nextStatus: 'draft', publicAction: 'unchanged', markerAction: input.markerAction ?? null }
  }
  if (input.action === 'hold') {
    if (!input.hasPublicProjection || input.status === 'canceled') throw new HttpsError('failed-precondition', '공개된 행사만 숨길 수 있어요')
    return { nextStatus: 'unpublished', publicAction: 'hide', markerAction: 'hold' }
  }
  if (input.action === 'remove') {
    if (!input.hasPublicProjection || !input.hasPriorGuidance) throw new HttpsError('failed-precondition', '먼저 작성자에게 경고 또는 수정 요청을 보내 주세요')
    return { nextStatus: 'unpublished', publicAction: 'hide', markerAction: 'remove' }
  }
  if (!input.hasPublicProjection || !input.markerAction) throw new HttpsError('failed-precondition', '운영자가 숨기거나 내린 행사만 복원할 수 있어요')
  const nextStatus = input.status === 'unpublished' ? 'published' : input.status
  return { nextStatus, publicAction: 'restore', markerAction: null }
}

export type EventMediaUpload = {
  role: 'thumbnail' | 'gallery'
  storagePath: string
  fileName: string
  contentType: string
  size: number
  alt: string
  displayMode?: 'contain' | 'cover'
}

export type ManualEventInput = {
  eventId?: unknown
  title?: unknown
  summary?: unknown
  description?: unknown
  startAt?: unknown
  endAt?: unknown
  allDay?: unknown
  timeZone?: unknown
  region?: unknown
  organizerName?: unknown
  locationName?: unknown
  address?: unknown
  onlineUrl?: unknown
  registrationUrl?: unknown
  registrationDeadline?: unknown
  registrationStatus?: unknown
  visibility?: unknown
  sourceUrl?: unknown
  mediaUploads?: unknown
  instagramPosts?: unknown
}

export type NormalizedManualEvent = {
  eventId: string
  title: string
  summary: string
  description: string
  startAt: Date
  endAt: Date
  allDay: boolean
  timeZone: string
  region: string
  organizerName: string
  locationName: string
  address?: string
  onlineUrl?: string
  registrationUrl?: string
  registrationDeadline?: Date
  registrationStatus: EventRegistrationStatus
  visibility: EventVisibility
  sourceUrl?: string
  mediaUploads: EventMediaUpload[]
  instagramPosts: EventInstagramPost[]
}

export class EventManagementContractError extends Error {
  constructor(public readonly code: 'invalid_event' | 'invalid_media' | 'invalid_url' | 'invalid_transition') {
    super(code)
  }
}

function requiredText(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string') throw new EventManagementContractError('invalid_event')
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < min || normalized.length > max) throw new EventManagementContractError('invalid_event')
  return normalized
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, max)
}

export function safeEventUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 2_000) throw new EventManagementContractError('invalid_url')
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) throw new EventManagementContractError('invalid_url')
    if ([...url.searchParams.keys()].some((key) => SECRET_QUERY_KEY.test(key))) {
      throw new EventManagementContractError('invalid_url')
    }
    return url.toString()
  } catch (error) {
    if (error instanceof EventManagementContractError) throw error
    throw new EventManagementContractError('invalid_url')
  }
}

function eventId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{12,80}$/.test(value)) {
    throw new EventManagementContractError('invalid_event')
  }
  return value
}

function eventDate(value: unknown): Date {
  if (typeof value !== 'string') throw new EventManagementContractError('invalid_event')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new EventManagementContractError('invalid_event')
  return date
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value)
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') }
}

function zonedDateTime(parts: { year: number; month: number; day: number; hour: number; minute: number; second: number }, timeZone: string): Date {
  const intended = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  let candidate = intended
  for (let index = 0; index < 3; index += 1) {
    const actual = zonedParts(new Date(candidate), timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    candidate += intended - represented
  }
  const result = new Date(candidate)
  const actual = zonedParts(result, timeZone)
  if (Object.keys(parts).some((key) => actual[key as keyof typeof actual] !== parts[key as keyof typeof parts])) {
    throw new EventManagementContractError('invalid_event')
  }
  return result
}

function validLocalDate(value: string): RegExpMatchArray {
  const match = LOCAL_DATE.exec(value)
  if (!match) throw new EventManagementContractError('invalid_event')
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.toISOString().slice(0, 10) !== value) throw new EventManagementContractError('invalid_event')
  return match
}

function eventDateInTimeZone(value: unknown, timeZone: string): Date {
  if (typeof value !== 'string') throw new EventManagementContractError('invalid_event')
  const match = LOCAL_DATE_TIME.exec(value)
  if (!match) return eventDate(value)
  return zonedDateTime({
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0),
  }, timeZone)
}

function localDateKey(value: unknown, timeZone: string): string {
  if (typeof value === 'string' && LOCAL_DATE.test(value)) {
    validLocalDate(value)
    return value
  }
  const parts = zonedParts(eventDate(value), timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function nextDateKey(value: string): string {
  const match = validLocalDate(value)
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1))
  return date.toISOString().slice(0, 10)
}

function allDayEventRange(startValue: unknown, endValue: unknown, timeZone: string) {
  const startKey = localDateKey(startValue, timeZone)
  const inclusiveEndKey = localDateKey(endValue, timeZone)
  const atMidnight = (key: string) => {
    const match = validLocalDate(key)
    return zonedDateTime({
      year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 0, minute: 0, second: 0,
    }, timeZone)
  }
  const exclusiveEndKey = nextDateKey(inclusiveEndKey)
  const dayCount = (Date.parse(`${exclusiveEndKey}T00:00:00.000Z`) - Date.parse(`${startKey}T00:00:00.000Z`)) / 86_400_000
  return { startAt: atMidnight(startKey), endAt: atMidnight(exclusiveEndKey), dayCount }
}

function mediaUploads(value: unknown, ownerUid: string, id: string): EventMediaUpload[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_GALLERY + 1) throw new EventManagementContractError('invalid_media')
  let thumbnails = 0
  const seen = new Set<string>()
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new EventManagementContractError('invalid_media')
    const item = raw as Record<string, unknown>
    const role = item.role === 'thumbnail' ? 'thumbnail' : item.role === 'gallery' ? 'gallery' : null
    const storagePath = typeof item.storagePath === 'string' ? item.storagePath : ''
    const expectedPrefix = `quarantined/${ownerUid}/calendar-events/${id}/`
    const fileName = requiredText(item.fileName, 160)
    const contentType = typeof item.contentType === 'string' ? item.contentType : ''
    const size = typeof item.size === 'number' ? item.size : Number.NaN
    const alt = requiredText(item.alt, 180, 2)
    if (!role || !storagePath.startsWith(expectedPrefix) || storagePath.includes('..') || seen.has(storagePath)) {
      throw new EventManagementContractError('invalid_media')
    }
    if (!ALLOWED_IMAGE_MIME.has(contentType) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
      throw new EventManagementContractError('invalid_media')
    }
    if (role === 'thumbnail' && ++thumbnails > 1) throw new EventManagementContractError('invalid_media')
    seen.add(storagePath)
    const displayMode = item.displayMode === undefined
      ? undefined
      : item.displayMode === 'contain' || item.displayMode === 'cover'
        ? item.displayMode
        : null
    if (displayMode === null) throw new EventManagementContractError('invalid_media')
    return { role, storagePath, fileName, contentType, size, alt, ...(displayMode ? { displayMode } : {}) }
  })
}

export function normalizeManualEventInput(data: ManualEventInput, ownerUid: string): NormalizedManualEvent {
  const id = eventId(data.eventId)
  const title = requiredText(data.title, 120, 2)
  const organizerName = requiredText(data.organizerName, 80, 2)
  const onlineUrl = safeEventUrl(data.onlineUrl)
  const locationName = optionalText(data.locationName, 160)
  if (!locationName && !onlineUrl) throw new EventManagementContractError('invalid_event')
  const timeZone = requiredText(data.timeZone, 80)
  try {
    new Intl.DateTimeFormat('ko-KR', { timeZone }).format(new Date())
  } catch {
    throw new EventManagementContractError('invalid_event')
  }
  const allDay = data.allDay === true
  const inclusiveAllDayDates = allDay
    && typeof data.startAt === 'string' && LOCAL_DATE.test(data.startAt)
    && typeof data.endAt === 'string' && LOCAL_DATE.test(data.endAt)
  const range = inclusiveAllDayDates
    ? allDayEventRange(data.startAt, data.endAt, timeZone)
    : { startAt: eventDateInTimeZone(data.startAt, timeZone), endAt: eventDateInTimeZone(data.endAt, timeZone), dayCount: undefined }
  const { startAt, endAt } = range
  if (endAt <= startAt || (inclusiveAllDayDates ? !range.dayCount || range.dayCount > 31 : endAt.getTime() - startAt.getTime() > 31 * 86_400_000)) {
    throw new EventManagementContractError('invalid_event')
  }
  const registrationStatus = data.registrationStatus === 'open'
    || data.registrationStatus === 'closing_soon'
    || data.registrationStatus === 'closed'
    || data.registrationStatus === 'not_required'
    ? data.registrationStatus
    : null
  const registrationDeadline = registrationStatus && registrationStatus !== 'not_required' && data.registrationDeadline
    ? eventDateInTimeZone(data.registrationDeadline, timeZone)
    : undefined
  if (registrationDeadline && registrationDeadline > endAt) throw new EventManagementContractError('invalid_event')
  const registrationUrl = registrationStatus === 'not_required' ? undefined : safeEventUrl(data.registrationUrl)
  const visibility = data.visibility === 'public' || data.visibility === 'member_only' ? data.visibility : null
  if (!registrationStatus || !visibility) throw new EventManagementContractError('invalid_event')
  let instagramPosts: EventInstagramPost[]
  try { instagramPosts = normalizeEventInstagramPosts(data.instagramPosts) } catch { throw new EventManagementContractError('invalid_event') }
  return {
    eventId: id,
    title,
    summary: optionalText(data.summary, 240) ?? `${organizerName}에서 준비한 행사입니다.`,
    description: optionalText(data.description, 5_000) ?? '',
    startAt,
    endAt,
    allDay,
    timeZone,
    region: requiredText(data.region, 40),
    organizerName,
    locationName: locationName ?? '온라인',
    ...(optionalText(data.address, 240) ? { address: optionalText(data.address, 240) } : {}),
    ...(onlineUrl ? { onlineUrl } : {}),
    ...(registrationUrl ? { registrationUrl } : {}),
    ...(registrationDeadline ? { registrationDeadline } : {}),
    registrationStatus,
    visibility,
    ...(safeEventUrl(data.sourceUrl) ? { sourceUrl: safeEventUrl(data.sourceUrl) } : {}),
    mediaUploads: mediaUploads(data.mediaUploads, ownerUid, id),
    instagramPosts,
  }
}

export function assertEventOwner(ownerUid: unknown, requesterUid: string): void {
  if (ownerUid !== requesterUid) throw new HttpsError('permission-denied', '이 행사를 관리할 권한이 없어요')
}

export function assertTrustAdministrator(token: Record<string, unknown> | undefined): void {
  if (token?.role !== 'administrator') throw new HttpsError('permission-denied', '운영 관리자 권한이 필요해요')
}

export function assertEventReviewer(token: Record<string, unknown> | undefined): void {
  if (token?.role !== 'administrator' && token?.role !== 'moderator') {
    throw new HttpsError('permission-denied', '운영 검토 권한이 필요해요')
  }
}

function mediaFingerprint(value: unknown): string {
  if (!Array.isArray(value)) return '[]'
  return JSON.stringify(value.map((item) => {
    const record = item as Partial<EventMediaUpload>
    return [record.role, record.storagePath, record.contentType, record.size, record.alt, record.displayMode === 'cover' ? 'cover' : 'contain']
  }))
}

export function eventApprovalFingerprint(event: NormalizedManualEvent, attestation?: ScanAttestation): string {
  const payload = {
    eventId: event.eventId,
    title: event.title,
    summary: event.summary,
    description: event.description,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    allDay: event.allDay,
    timeZone: event.timeZone,
    region: event.region,
    organizerName: event.organizerName,
    locationName: event.locationName,
    address: event.address ?? '',
    onlineUrl: event.onlineUrl ?? '',
    registrationUrl: event.registrationUrl ?? '',
    registrationDeadline: event.registrationDeadline?.toISOString() ?? '',
    registrationStatus: event.registrationStatus,
    visibility: event.visibility,
    sourceUrl: event.sourceUrl ?? '',
    mediaUploads: event.mediaUploads.map((item) => ({
      role: item.role,
      storagePath: item.storagePath,
      fileName: item.fileName,
      contentType: item.contentType,
      size: item.size,
      alt: item.alt,
      displayMode: item.displayMode === 'cover' ? 'cover' : 'contain',
    })),
    instagramPosts: event.instagramPosts,
    scanId: attestation?.scanId ?? '',
    scanObjects: attestation?.objects ?? [],
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function eventApprovalReservationDecision(input: {
  status: unknown
  leaseExpiresAtMs?: number
  nowMs: number
}): 'reserve' | 'busy' | 'invalid' {
  if (input.status === 'review_queued' || input.status === 'publishing_failed') return 'reserve'
  if (input.status === 'publishing') {
    return (input.leaseExpiresAtMs ?? 0) <= input.nowMs ? 'reserve' : 'busy'
  }
  return 'invalid'
}

export function eventScanApplicationDecision(input: {
  status: unknown
  capturedRevision: unknown
  currentRevision: unknown
}): 'apply' | 'ignore' {
  return (input.status === 'review_queued' || input.status === 'publishing_failed')
    && typeof input.capturedRevision === 'string'
    && input.capturedRevision.length > 0
    && input.currentRevision === input.capturedRevision
    ? 'apply'
    : 'ignore'
}

export function eventApprovalMatchesReservation(input: {
  status: unknown
  attemptId: unknown
  storedFingerprint: unknown
  computedFingerprint: string
  expectedAttemptId: string
  expectedFingerprint: string
}): boolean {
  return input.status === 'publishing'
    && input.attemptId === input.expectedAttemptId
    && input.storedFingerprint === input.expectedFingerprint
    && input.computedFingerprint === input.expectedFingerprint
}

export function eventPublicationDecision(input: {
  trustedOrganizer: boolean
  existing?: Partial<NormalizedManualEvent> & { status?: EventManagementStatus; mediaUploads?: unknown }
  next: NormalizedManualEvent
}): { status: 'review_queued' | 'published' | 'updated' | 'canceled'; reviewReason?: string } {
  if (!input.existing) {
    return input.next.mediaUploads.length
      ? { status: 'review_queued', reviewReason: 'media_scan_pending' }
      : { status: 'published' }
  }
  if (input.existing.status === 'canceled') return { status: 'canceled' }
  if (input.existing.status === 'unpublished' || input.existing.status === 'publishing') {
    throw new EventManagementContractError('invalid_transition')
  }
  if (!input.next.mediaUploads.length) return { status: 'updated' }
  if (input.existing.status === 'publishing_failed') {
    return { status: 'review_queued', reviewReason: 'automatic_publication_retry' }
  }
  const mediaChanged = mediaFingerprint(input.existing.mediaUploads) !== mediaFingerprint(input.next.mediaUploads)
  if (mediaChanged || input.existing.status === 'review_queued' || input.existing.visibility !== input.next.visibility) {
    return { status: 'review_queued', reviewReason: 'media_scan_pending' }
  }
  return { status: 'updated' }
}

export function eventMediaScanResetRequired(
  existing: Partial<NormalizedManualEvent> & { status?: EventManagementStatus; mediaUploads?: unknown },
  next: NormalizedManualEvent,
): boolean {
  if (existing.status === 'publishing_failed') return true
  return mediaFingerprint(existing.mediaUploads) !== mediaFingerprint(next.mediaUploads)
    || existing.visibility !== next.visibility
}

function monthKeys(startAt: Date, endAt: Date, allDay = false, timeZone = 'UTC'): string[] {
  const keys: string[] = []
  const effectiveEnd = allDay ? new Date(endAt.getTime() - 1) : endAt
  const startKey = localDateKey(startAt.toISOString(), timeZone)
  const endKey = localDateKey(effectiveEnd.toISOString(), timeZone)
  const cursor = new Date(`${startKey.slice(0, 7)}-01T00:00:00.000Z`)
  const last = new Date(`${endKey.slice(0, 7)}-01T00:00:00.000Z`)
  while (cursor <= last && keys.length < 3) {
    keys.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`)
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return keys
}

export function publicManualEventRecord(event: NormalizedManualEvent, previous?: DocumentData) {
  return {
    title: event.title,
    summary: event.summary,
    description: event.description,
    organizerName: event.organizerName,
    startAt: Timestamp.fromDate(event.startAt),
    endAt: Timestamp.fromDate(event.endAt),
    allDay: event.allDay,
    timeZone: event.timeZone,
    region: event.region,
    locationName: event.locationName,
    ...(event.address ? { address: event.address } : {}),
    ...(event.onlineUrl ? { onlineUrl: event.onlineUrl } : {}),
    ...(event.registrationUrl ? { registrationUrl: event.registrationUrl } : {}),
    ...(event.registrationDeadline ? { registrationDeadline: Timestamp.fromDate(event.registrationDeadline) } : {}),
    registrationStatus: event.registrationStatus,
    ...(event.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
    instagramPosts: event.instagramPosts,
    ...(previous?.media ? { media: previous.media } : {}),
    visibility: event.visibility,
    eventState: 'confirmed',
    sourceType: 'manual',
    status: 'published',
    monthKeys: monthKeys(event.startAt, event.endAt, event.allDay, event.timeZone),
    updatedAt: FieldValue.serverTimestamp(),
    ...(previous?.publishedAt ? { publishedAt: previous.publishedAt } : { publishedAt: FieldValue.serverTimestamp() }),
  }
}

// The public event exists independently of quarantined photo processing.
export function immediatePublicEventRecord(event: NormalizedManualEvent, existing?: DocumentData, previousPublic?: DocumentData) {
  const keepMedia = event.mediaUploads.length > 0
    && existing?.visibility === event.visibility
    && mediaFingerprint(existing?.mediaUploads) === mediaFingerprint(event.mediaUploads)
  const metadata = { ...previousPublic }
  delete metadata.media
  return publicManualEventRecord(event, keepMedia ? previousPublic : metadata)
}

async function verifyMediaObjects(event: NormalizedManualEvent, ownerUid: string): Promise<void> {
  await Promise.all(event.mediaUploads.map(async (item) => {
    const [metadata] = await getStorage().bucket().file(item.storagePath).getMetadata()
    const custom = metadata.metadata ?? {}
    if (
      Number(metadata.size) !== item.size
      || metadata.contentType !== item.contentType
      || custom.ownerUid !== ownerUid
      || custom.eventId !== event.eventId
      || custom.role !== item.role
      || custom.alt !== item.alt
    ) throw new EventManagementContractError('invalid_media')
  }))
}

async function eventMediaObjects(event: NormalizedManualEvent, ownerUid: string): Promise<QuarantinedObjectFingerprint[]> {
  return Promise.all(event.mediaUploads.map(async (item) => {
    const [metadata] = await getStorage().bucket().file(item.storagePath).getMetadata()
    const custom = metadata.metadata ?? {}
    const contentHash = typeof custom.weaveSha256 === 'string'
      ? `sha256:${custom.weaveSha256}`
      : metadata.md5Hash
        ? `md5:${metadata.md5Hash}`
        : metadata.crc32c
          ? `crc32c:${metadata.crc32c}`
          : undefined
    if (
      Number(metadata.size) !== item.size
      || metadata.contentType !== item.contentType
      || custom.ownerUid !== ownerUid
      || custom.eventId !== event.eventId
      || custom.role !== item.role
      || custom.alt !== item.alt
      || typeof metadata.generation !== 'string'
      || !contentHash
    ) throw new EventManagementContractError('invalid_media')
    return {
      path: item.storagePath,
      generation: metadata.generation,
      size: Number(metadata.size),
      contentHash,
    }
  }))
}

function storedEvent(snapshot: DocumentData): NormalizedManualEvent {
  const startAt = snapshot.startAt instanceof Timestamp ? snapshot.startAt.toDate() : null
  const endAt = snapshot.endAt instanceof Timestamp ? snapshot.endAt.toDate() : null
  if (!startAt || !endAt) throw new EventManagementContractError('invalid_event')
  const timeZone = String(snapshot.timeZone ?? 'Asia/Seoul')
  const allDay = snapshot.allDay === true
  return normalizeManualEventInput({
    ...snapshot,
    startAt: allDay ? localDateKey(startAt.toISOString(), timeZone) : startAt.toISOString(),
    endAt: allDay ? localDateKey(new Date(endAt.getTime() - 1).toISOString(), timeZone) : endAt.toISOString(),
    registrationDeadline: snapshot.registrationDeadline instanceof Timestamp
      ? snapshot.registrationDeadline.toDate().toISOString()
      : '',
  }, String(snapshot.ownerUid ?? ''))
}

function approvedMediaUrl(bucketName: string, storagePath: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`
}

async function approveEventMedia(event: NormalizedManualEvent, ownerUid: string, attestation: ScanAttestation) {
  if (!event.mediaUploads.length) return undefined
  const actualObjects = await eventMediaObjects(event, ownerUid)
  assertAttestationMatchesObjects(attestation, actualObjects)
  const bucket = getStorage().bucket()
  const images = await Promise.all(event.mediaUploads.map(async (item) => {
    const storedName = item.storagePath.split('/').pop() ?? `${item.role}-${item.fileName}`
    const approvedPath = `approved/${event.visibility === 'public' ? 'public' : 'members'}/calendar-events/${event.eventId}/${storedName}`
    await bucket.file(item.storagePath).copy(bucket.file(approvedPath), {
      contentType: item.contentType,
      cacheControl: 'private,no-store,max-age=0',
      metadata: { ownerUid, eventId: event.eventId, role: item.role, alt: item.alt, displayMode: item.displayMode ?? 'contain' },
    })
    return {
      role: item.role,
      storagePath: approvedPath,
      alt: item.alt,
      displayMode: item.displayMode === 'cover' ? 'cover' : 'contain',
      ...(event.visibility === 'public' ? { url: approvedMediaUrl(bucket.name, approvedPath) } : {}),
    }
  }))
  const thumbnail = images.find((item) => item.role === 'thumbnail')
  const gallery = images.filter((item) => item.role === 'gallery')
  return {
    status: 'approved',
    ...(thumbnail ? { thumbnail } : {}),
    ...(gallery.length ? { gallery } : {}),
  }
}

function approvedEventMediaPaths(value: unknown, eventId: string): string[] {
  if (!value || typeof value !== 'object') return []
  const media = value as Record<string, unknown>
  const candidates = [media.thumbnail, ...(Array.isArray(media.gallery) ? media.gallery : [])]
  return candidates.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const storagePath = (item as Record<string, unknown>).storagePath
    return typeof storagePath === 'string'
      && (storagePath.startsWith(`approved/public/calendar-events/${eventId}/`)
        || storagePath.startsWith(`approved/members/calendar-events/${eventId}/`))
      ? [storagePath]
      : []
  })
}

export function staleApprovedEventMediaPaths(previous: string[], next: string[]): string[] {
  const nextPaths = new Set(next)
  return previous.filter((path) => !nextPaths.has(path))
}

function requireAuth(request: { auth?: { uid: string } }): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요해요')
  return request.auth.uid
}

async function isTrustedOrganizer(uid: string): Promise<boolean> {
  const snapshot = await db.collection(TRUST_COLLECTION).doc(uid).get()
  return snapshot.get('status') === 'trusted'
}

async function authorPseudonym(uid: string): Promise<string | undefined> {
  const snapshot = await db.collection('users').doc(uid).get()
  const pseudonym = snapshot.get('pseudonym')
  return typeof pseudonym === 'string' && pseudonym.trim() ? pseudonym.trim().slice(0, 40) : undefined
}

function contractError(error: unknown): never {
  if (error instanceof HttpsError) throw error
  if (error instanceof EventManagementContractError) {
    const message = error.code === 'invalid_media'
      ? '사진과 설명을 다시 확인해 주세요'
      : error.code === 'invalid_url'
        ? '공개된 HTTPS 링크만 입력해 주세요'
        : error.code === 'invalid_transition'
          ? '현재 상태에서는 이 작업을 할 수 없어요'
          : '행사 내용을 다시 확인해 주세요'
    throw new HttpsError('invalid-argument', message)
  }
  throw error
}

export const createManualEvent = onCall({ region: 'asia-northeast3' }, async (request) => {
  try {
    const { uid } = await requireActorPolicy(request.auth)
    const event = normalizeManualEventInput(request.data ?? {}, uid)
    await verifyMediaObjects(event, uid)
    const ref = db.collection(EVENT_COLLECTION).doc(event.eventId)
    const existing = await ref.get()
    if (existing.exists) throw new HttpsError('already-exists', '이미 등록된 행사예요')
    const [trusted, pseudonym] = await Promise.all([isTrustedOrganizer(uid), authorPseudonym(uid)])
    const decision = eventPublicationDecision({ trustedOrganizer: trusted, next: event })
    const privateRecord = {
      ...event,
      startAt: Timestamp.fromDate(event.startAt),
      endAt: Timestamp.fromDate(event.endAt),
      ...(event.registrationDeadline ? { registrationDeadline: Timestamp.fromDate(event.registrationDeadline) } : {}),
      ownerUid: uid,
      ...(pseudonym ? { authorPseudonym: pseudonym } : {}),
      status: decision.status,
      contentPublished: true,
      mediaScanRevision: randomUUID(),
      ...(decision.reviewReason ? { reviewReason: decision.reviewReason } : {}),
      sourceType: 'manual',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    const batch = db.batch()
    batch.create(ref, privateRecord)
    batch.set(db.collection(PUBLIC_EVENT_COLLECTION).doc(event.eventId), immediatePublicEventRecord(event))
    batch.create(db.collection('auditEvents').doc(), {
      type: 'calendar_event.created', uid, eventId: event.eventId, status: decision.status, at: FieldValue.serverTimestamp(),
    })
    await batch.commit()
    return { eventId: event.eventId, status: decision.status }
  } catch (error) {
    contractError(error)
  }
})

export const updateManualEvent = onCall({ region: 'asia-northeast3' }, async (request) => {
  try {
    const { uid } = await requireActorPolicy(request.auth)
    const event = normalizeManualEventInput(request.data ?? {}, uid)
    await verifyMediaObjects(event, uid)
    const trusted = await isTrustedOrganizer(uid)
    const privateRef = db.collection(EVENT_COLLECTION).doc(event.eventId)
    const publicRef = db.collection(PUBLIC_EVENT_COLLECTION).doc(event.eventId)
    return await db.runTransaction(async (transaction) => {
      const [privateSnapshot, publicSnapshot] = await Promise.all([transaction.get(privateRef), transaction.get(publicRef)])
      if (!privateSnapshot.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
      const previous = privateSnapshot.data() ?? {}
      assertEventOwner(previous.ownerUid, uid)
      const decision = eventPublicationDecision({
        trustedOrganizer: trusted,
        existing: {
          ...previous,
          startAt: previous.startAt instanceof Timestamp ? previous.startAt.toDate() : undefined,
          endAt: previous.endAt instanceof Timestamp ? previous.endAt.toDate() : undefined,
        },
        next: event,
      })
      const resetMediaScan = decision.status === 'review_queued' && eventMediaScanResetRequired(previous, event)
      transaction.update(privateRef, {
        ...event,
        startAt: Timestamp.fromDate(event.startAt),
        endAt: Timestamp.fromDate(event.endAt),
        registrationUrl: event.registrationUrl ?? FieldValue.delete(),
        registrationDeadline: event.registrationDeadline ? Timestamp.fromDate(event.registrationDeadline) : FieldValue.delete(),
        status: decision.status,
        contentPublished: decision.status === 'canceled' ? publicSnapshot.exists : true,
        reviewReason: decision.reviewReason ?? FieldValue.delete(),
        ...(resetMediaScan ? {
          mediaScanRevision: randomUUID(),
          mediaScanStatus: FieldValue.delete(),
          mediaScanAttestation: FieldValue.delete(),
          mediaScanFingerprint: FieldValue.delete(),
          mediaScanRecordedAt: FieldValue.delete(),
          mediaScanRecordedByUid: FieldValue.delete(),
        } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      })
      const publicRecord = {
        ...immediatePublicEventRecord(event, previous, publicSnapshot.data()),
        ...(decision.status === 'canceled' ? { eventState: 'canceled' } : {}),
      }
      transaction.set(publicRef, operatorModerationBlocksPublication(previous.operatorModeration)
        ? { ...publicRecord, status: 'unpublished' }
        : publicRecord)
      transaction.create(db.collection('auditEvents').doc(), {
        type: 'calendar_event.updated', uid, eventId: event.eventId, status: decision.status, at: FieldValue.serverTimestamp(),
      })
      return { eventId: event.eventId, status: decision.status }
    })
  } catch (error) {
    contractError(error)
  }
})

async function ownerTransition(request: { data?: unknown }, uid: string, action: 'cancel' | 'unpublish') {
  const data = (request.data ?? {}) as { eventId?: unknown }
  const id = eventId(data.eventId)
  const privateRef = db.collection(EVENT_COLLECTION).doc(id)
  const publicRef = db.collection(PUBLIC_EVENT_COLLECTION).doc(id)
  const plan = await db.runTransaction(async (transaction) => {
    const [privateSnapshot, publicSnapshot] = await Promise.all([transaction.get(privateRef), transaction.get(publicRef)])
    if (!privateSnapshot.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
    const previous = privateSnapshot.data() ?? {}
    assertEventOwner(previous.ownerUid, uid)
    const next = ownerEventTransitionPlan(previous.status as EventManagementStatus, action, publicSnapshot.exists)
    if (next.repeated) return next
    transaction.update(privateRef, {
      status: next.nextStatus,
      contentPublished: next.nextStatus === 'canceled' && publicSnapshot.exists,
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (next.publicAction === 'mark_canceled') {
      transaction.update(publicRef, { eventState: 'canceled', updatedAt: FieldValue.serverTimestamp() })
    } else if (next.publicAction === 'remove') {
      transaction.delete(publicRef)
    }
    transaction.create(db.collection('auditEvents').doc(), {
      type: action === 'cancel' ? 'calendar_event.canceled' : 'calendar_event.unpublished',
      uid, eventId: id, at: FieldValue.serverTimestamp(),
    })
    return next
  })
  return { eventId: id, status: plan.nextStatus, repeated: plan.repeated }
}

export const cancelOwnedEvent = onCall({ region: 'asia-northeast3' }, async (request) => {
  try {
    const { uid } = await requireActorPolicy(request.auth)
    return await ownerTransition(request, uid, 'cancel')
  } catch (error) {
    contractError(error)
  }
})

export const unpublishOwnedEvent = onCall({ region: 'asia-northeast3' }, async (request) => {
  try {
    const { uid } = await requireActorPolicy(request.auth)
    return await ownerTransition(request, uid, 'unpublish')
  } catch (error) {
    contractError(error)
  }
})

export const restoreOwnedEvent = onCall({ region: 'asia-northeast3' }, async (request) => {
  try {
    const { uid } = await requireActorPolicy(request.auth)
    const id = eventId((request.data ?? {}).eventId)
    const privateRef = db.collection(EVENT_COLLECTION).doc(id)
    const publicRef = db.collection(PUBLIC_EVENT_COLLECTION).doc(id)
    await db.runTransaction(async (transaction) => {
      const [privateSnapshot, publicSnapshot] = await Promise.all([transaction.get(privateRef), transaction.get(publicRef)])
      if (!privateSnapshot.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
      const previous = privateSnapshot.data() ?? {}
      assertEventOwner(previous.ownerUid, uid)
      if (!ownerEventRestoreAllowed(previous.status as EventManagementStatus, publicSnapshot.exists, operatorModerationBlocksPublication(previous.operatorModeration))) {
        throw new HttpsError('failed-precondition', '현재는 이 행사를 복원할 수 없어요')
      }
      transaction.update(privateRef, { status: 'draft', contentPublished: false, updatedAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('auditEvents').doc(), {
        type: 'calendar_event.restored_private_draft', uid, eventId: id, at: FieldValue.serverTimestamp(),
      })
    })
    return { eventId: id, status: 'draft' as const }
  } catch (error) {
    contractError(error)
  }
})

function clientEventRecord(id: string, value: DocumentData) {
  const date = (item: unknown) => item instanceof Timestamp ? item.toDate().toISOString() : ''
  return {
    id,
    title: String(value.title ?? ''),
    summary: String(value.summary ?? ''),
    description: String(value.description ?? ''),
    startAt: date(value.startAt),
    endAt: date(value.endAt),
    allDay: value.allDay === true,
    timeZone: String(value.timeZone ?? 'Asia/Seoul'),
    region: String(value.region ?? ''),
    organizerName: String(value.organizerName ?? ''),
    locationName: String(value.locationName ?? ''),
    address: String(value.address ?? ''),
    onlineUrl: String(value.onlineUrl ?? ''),
    registrationUrl: String(value.registrationUrl ?? ''),
    registrationDeadline: date(value.registrationDeadline),
    registrationStatus: value.registrationStatus ?? 'open',
    visibility: value.visibility ?? 'public',
    sourceUrl: String(value.sourceUrl ?? ''),
    status: value.status ?? 'review_queued',
    contentPublished: value.contentPublished === true,
    createdAt: date(value.createdAt),
    updatedAt: date(value.updatedAt),
    createdByLabel: typeof value.authorPseudonym === 'string' ? value.authorPseudonym : '내가 등록한 행사',
    mediaUploads: Array.isArray(value.mediaUploads) ? value.mediaUploads : [],
    instagramPosts: readEventInstagramPosts(value.instagramPosts),
    gallery: [],
    ...(typeof value.reviewReason === 'string' ? { reviewReason: value.reviewReason } : {}),
    ...(projectOperatorModerationNotice(value.moderationNotice)
      ? { moderationNotice: projectOperatorModerationNotice(value.moderationNotice) }
      : {}),
  }
}

export const listOwnedEvents = onCall({ region: 'asia-northeast3' }, async (request) => {
  const uid = requireAuth(request)
  const snapshot = await db.collection(EVENT_COLLECTION).where('ownerUid', '==', uid).limit(100).get()
  const events = snapshot.docs.map((item) => clientEventRecord(item.id, item.data()))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return { events }
})

export const moderateManualEventContent = onCall({ region: 'asia-northeast3' }, async (request) => {
  try {
    const operatorUid = requireAuth(request)
    assertEventReviewer(request.auth?.token as Record<string, unknown> | undefined)
    const data = (request.data ?? {}) as Record<string, unknown>
    const id = eventId(data.eventId)
    const command = validateReasonedContentModeration(data)
    const privateRef = db.collection(EVENT_COLLECTION).doc(id)
    const publicRef = db.collection(PUBLIC_EVENT_COLLECTION).doc(id)
    const commandRef = db.collection('auditEvents').doc(operatorModerationCommandKey(operatorUid, command.requestId))
    return await db.runTransaction(async (transaction) => {
      const [privateSnapshot, publicSnapshot, existingCommand] = await Promise.all([
        transaction.get(privateRef),
        transaction.get(publicRef),
        transaction.get(commandRef),
      ])
      if (!privateSnapshot.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
      if (existingCommand.exists) {
        const same = existingCommand.get('commandType') === 'content.moderation_command'
          && existingCommand.get('targetType') === 'manual_event'
          && existingCommand.get('targetId') === id
          && existingCommand.get('action') === command.action
          && existingCommand.get('reason') === command.reason
        const status = existingCommand.get('nextStatus')
        if (!same || typeof status !== 'string') throw new HttpsError('already-exists', '같은 요청 식별자가 다른 운영 조치에 사용됐어요')
        return { status, action: command.action, repeated: true }
      }
      const value = privateSnapshot.data() ?? {}
      const marker = value.operatorModeration as Record<string, unknown> | undefined
      const markerAction = operatorModerationBlocksPublication(marker) ? marker?.action as OperatorVisibilityAction : undefined
      const plan = manualEventModerationPlan({
        status: value.status as EventManagementStatus,
        action: command.action,
        hasPublicProjection: publicSnapshot.get('status') === 'published' || Boolean(markerAction && publicSnapshot.exists),
        hasPriorGuidance: Boolean(value.moderationGuidance),
        markerAction,
      })
      const timestamp = FieldValue.serverTimestamp()
      const notice = { action: command.action, reason: command.reason, createdAt: timestamp }
      transaction.update(privateRef, {
        status: plan.nextStatus,
        moderationNotice: notice,
        ...(command.action === 'warn' || command.action === 'request_correction' ? { moderationGuidance: notice } : {}),
        ...(command.action === 'remove' || command.action === 'restore' ? { moderationGuidance: FieldValue.delete() } : {}),
        ...(command.action === 'hold' || command.action === 'remove'
          ? { operatorModeration: { action: command.action, reason: command.reason, requestId: command.requestId, createdAt: timestamp } }
          : command.action === 'restore'
            ? { operatorModeration: FieldValue.delete() }
            : {}),
        updatedAt: timestamp,
      })
      if (plan.publicAction === 'hide') {
        transaction.update(publicRef, { status: 'unpublished', updatedAt: timestamp })
      } else if (plan.publicAction === 'restore') {
        assertRestorableManualEventProjection(publicSnapshot.data() as Record<string, unknown>)
        transaction.update(publicRef, { status: 'published', updatedAt: timestamp })
      }
      transaction.create(commandRef, {
        type: `calendar_event.${command.action}`,
        commandType: 'content.moderation_command',
        targetType: 'manual_event',
        targetId: id,
        action: command.action,
        reason: command.reason,
        requestId: command.requestId,
        previousStatus: value.status,
        nextStatus: plan.nextStatus,
        uid: operatorUid,
        at: timestamp,
      })
      return { status: plan.nextStatus, action: command.action, repeated: false }
    })
  } catch (error) {
    contractError(error)
  }
})

export const setEventOrganizerTrust = onCall({ region: 'asia-northeast3' }, async (request) => {
  const operatorUid = requireAuth(request)
  assertTrustAdministrator(request.auth?.token as Record<string, unknown> | undefined)
  const data = (request.data ?? {}) as { ownerUid?: unknown; trusted?: unknown }
  const ownerUid = requiredText(data.ownerUid, 128, 8)
  if (typeof data.trusted !== 'boolean') throw new HttpsError('invalid-argument', '신뢰 상태를 확인해 주세요')
  await db.collection(TRUST_COLLECTION).doc(ownerUid).set({
    status: data.trusted ? 'trusted' : 'untrusted',
    updatedBy: operatorUid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  await db.collection('auditEvents').add({
    type: 'calendar_organizer.trust_updated', operatorUid, ownerUid, trusted: data.trusted, at: FieldValue.serverTimestamp(),
  })
  return { ownerUid, trusted: data.trusted }
})

export const recordEventMediaScanResult = onCall({ region: 'asia-northeast3' }, async (request) => {
  try {
    const attestorUid = requireAuth(request)
    requireScanAttestor(request.auth?.token as Record<string, unknown> | undefined)
    const data = (request.data ?? {}) as { eventId?: unknown; attestation?: unknown }
    const id = eventId(data.eventId)
    const attestation = parseScanAttestation(data.attestation)
    const ref = db.collection(EVENT_COLLECTION).doc(id)
    const snapshot = await ref.get()
    if (!snapshot.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
    const record = snapshot.data() ?? {}
    const capturedRevision = record.mediaScanRevision
    if (eventScanApplicationDecision({
      status: record.status,
      capturedRevision,
      currentRevision: capturedRevision,
    }) === 'ignore') {
      throw new HttpsError('failed-precondition', '사진 검사 결과를 기록할 수 없는 행사 상태예요')
    }
    const event = storedEvent(record)
    if (!event.mediaUploads.length) {
      throw new HttpsError('failed-precondition', '검사할 행사 사진이 없어요')
    }
    const ownerUid = String(record.ownerUid ?? '')
    const objects = await eventMediaObjects(event, ownerUid)
    assertAttestationMatchesObjects(attestation, objects)
    const fingerprint = eventApprovalFingerprint(event, attestation)
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      if (!current.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
      if (eventScanApplicationDecision({
        status: current.get('status'),
        capturedRevision,
        currentRevision: current.get('mediaScanRevision'),
      }) === 'ignore') {
        throw new HttpsError('aborted', '행사 상태가 바뀌었어요 다시 확인해 주세요')
      }
      const currentEvent = storedEvent(current.data() ?? {})
      if (eventApprovalFingerprint(currentEvent, attestation) !== fingerprint) {
        throw new HttpsError('aborted', '사진 검사 중 행사 내용이 바뀌었어요 다시 검사해 주세요')
      }
      transaction.update(ref, {
        mediaScanStatus: attestation.verdict,
        mediaScanAttestation: attestation,
        mediaScanFingerprint: fingerprint,
        mediaScanRecordedAt: FieldValue.serverTimestamp(),
        mediaScanRecordedByUid: attestorUid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('auditEvents').doc(), {
        type: 'calendar_event.media_scan_recorded',
        eventId: id,
        scanId: attestation.scanId,
        verdict: attestation.verdict,
        uid: attestorUid,
        at: FieldValue.serverTimestamp(),
      })
    })
    return { eventId: id, scanStatus: attestation.verdict, scanId: attestation.scanId }
  } catch (error) {
    contractError(error)
  }
})

export async function recordAndPublishAutomatedEventScan(
  id: string,
  ownerUid: string,
  attestation: ScanAttestation,
) {
  const eventIdValue = eventId(id)
  const privateRef = db.collection(EVENT_COLLECTION).doc(eventIdValue)
  const snapshot = await privateRef.get()
  if (!snapshot.exists || snapshot.get('ownerUid') !== ownerUid) return { status: 'ignored' as const }
  const record = snapshot.data() ?? {}
  const capturedRevision = record.mediaScanRevision
  if (eventScanApplicationDecision({
    status: record.status,
    capturedRevision,
    currentRevision: capturedRevision,
  }) === 'ignore') return { status: 'ignored' as const }
  const event = storedEvent(record)
  if (!event.mediaUploads.length) return { status: 'ignored' as const }
  const objects = await eventMediaObjects(event, ownerUid)
  assertAttestationMatchesObjects(attestation, objects)
  const fingerprint = eventApprovalFingerprint(event, attestation)
  const recorded = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(privateRef)
    if (!current.exists || current.get('ownerUid') !== ownerUid) return false
    if (eventScanApplicationDecision({
      status: current.get('status'),
      capturedRevision,
      currentRevision: current.get('mediaScanRevision'),
    }) === 'ignore') return false
    const currentEvent = storedEvent(current.data() ?? {})
    if (eventApprovalFingerprint(currentEvent, attestation) !== fingerprint) {
      throw new HttpsError('aborted', '사진 검사 중 행사 내용이 바뀌었어요 다시 검사해 주세요')
    }
    transaction.update(privateRef, {
      mediaScanStatus: attestation.verdict,
      mediaScanAttestation: attestation,
      mediaScanFingerprint: fingerprint,
      mediaScanRecordedAt: FieldValue.serverTimestamp(),
      scanRecordedBy: 'event-driven-file-scanner',
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(db.collection('auditEvents').doc(), {
      type: 'calendar_event.automated_media_scan_recorded',
      eventId: eventIdValue,
      scanId: attestation.scanId,
      verdict: attestation.verdict,
      at: FieldValue.serverTimestamp(),
    })
    return true
  })
  if (!recorded) return { status: 'ignored' as const }
  if (attestation.verdict !== 'clean') {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(privateRef)
      if (!current.exists || current.get('ownerUid') !== ownerUid
        || eventScanApplicationDecision({
          status: current.get('status'),
          capturedRevision,
          currentRevision: current.get('mediaScanRevision'),
        }) === 'ignore'
        || current.get('mediaScanFingerprint') !== fingerprint) return
      transaction.update(privateRef, {
        status: 'publishing_failed',
        reviewReason: 'media_scan_blocked',
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.set(db.collection('calendarEventOperatorExceptions').doc(eventIdValue), {
        eventId: eventIdValue,
        type: 'media_scan_blocked',
        status: 'open',
        scanId: attestation.scanId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    return { status: 'blocked' as const }
  }
  return publishCleanEventMedia(eventIdValue)
}

export async function recordAutomatedEventScanFailure(id: string, ownerUid: string, code: string) {
  const eventIdValue = eventId(id)
  const privateRef = db.collection(EVENT_COLLECTION).doc(eventIdValue)
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(privateRef)
    if (!current.exists || current.get('ownerUid') !== ownerUid
      || !['review_queued', 'publishing_failed'].includes(current.get('status'))) return
    transaction.update(privateRef, {
      status: 'publishing_failed',
      reviewReason: 'automatic_media_scan_failed',
      mediaScanStatus: 'error',
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(db.collection('calendarEventOperatorExceptions').doc(eventIdValue), {
      eventId: eventIdValue,
      type: 'media_scan_failed',
      status: 'open',
      code: code.slice(0, 160),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })
}

async function publishCleanEventMedia(id: string) {
  const privateRef = db.collection(EVENT_COLLECTION).doc(id)
  const publicRef = db.collection(PUBLIC_EVENT_COLLECTION).doc(id)
  const attemptId = randomUUID()
  const nowMs = Date.now()
  const reservation = await db.runTransaction(async (transaction) => {
    const [privateSnapshot, publicSnapshot] = await Promise.all([
      transaction.get(privateRef),
      transaction.get(publicRef),
    ])
    if (!privateSnapshot.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
    const privateRecord = privateSnapshot.data() ?? {}
    if (operatorModerationBlocksPublication(privateRecord.operatorModeration)) {
      throw new HttpsError('failed-precondition', '운영자가 공개를 중단한 행사는 복원 뒤에만 다시 공개할 수 있어요')
    }
    const reservationDecision = eventApprovalReservationDecision({
      status: privateRecord.status,
      leaseExpiresAtMs: privateRecord.approvalLeaseExpiresAt instanceof Timestamp
        ? privateRecord.approvalLeaseExpiresAt.toMillis()
        : 0,
      nowMs,
    })
    if (reservationDecision === 'busy') throw new HttpsError('aborted', '다른 공개 작업이 진행 중이에요')
    if (reservationDecision === 'invalid') throw new HttpsError('failed-precondition', '자동 공개할 수 없는 행사 상태예요')
    const event = storedEvent(privateRecord)
    if (!event.mediaUploads.length || privateRecord.mediaScanStatus !== 'clean') {
      throw new HttpsError('failed-precondition', '사진 안전 검사가 끝나기 전에는 공개할 수 없어요')
    }
    const attestation = parseScanAttestation(privateRecord.mediaScanAttestation, nowMs)
    if (attestation.verdict !== 'clean') throw new HttpsError('failed-precondition', '안전한 사진만 공개할 수 있어요')
    const fingerprint = eventApprovalFingerprint(event, attestation)
    if (privateRecord.mediaScanFingerprint !== fingerprint) {
      throw new HttpsError('failed-precondition', '사진 검사 뒤 행사 내용이 바뀌었어요 다시 검사해 주세요')
    }
    transaction.update(privateRef, {
      status: 'publishing',
      approvalAttemptId: attemptId,
      approvalFingerprint: fingerprint,
      approvalLeaseExpiresAt: Timestamp.fromMillis(nowMs + APPROVAL_LEASE_MS),
      approvalFailure: FieldValue.delete(),
      publicationMode: 'automatic_media_scan',
      publishingStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return {
      event,
      ownerUid: String(privateRecord.ownerUid ?? ''),
      attestation,
      fingerprint,
      previousMediaPaths: approvedEventMediaPaths(publicSnapshot.get('media'), id),
    }
  })

  try {
    const media = await approveEventMedia(reservation.event, reservation.ownerUid, reservation.attestation)
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(privateRef)
      if (!current.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
      const currentRecord = current.data() ?? {}
      if (operatorModerationBlocksPublication(currentRecord.operatorModeration)) {
        throw new HttpsError('aborted', '운영자가 공개를 중단해 행사 공개를 마칠 수 없어요')
      }
      const currentEvent = storedEvent(currentRecord)
      const currentAttestation = parseScanAttestation(currentRecord.mediaScanAttestation)
      if (!eventApprovalMatchesReservation({
        status: currentRecord.status,
        attemptId: currentRecord.approvalAttemptId,
        storedFingerprint: currentRecord.approvalFingerprint,
        computedFingerprint: eventApprovalFingerprint(currentEvent, currentAttestation),
        expectedAttemptId: attemptId,
        expectedFingerprint: reservation.fingerprint,
      })) throw new HttpsError('aborted', '공개 준비 중 행사 내용이 바뀌었어요 다시 확인해 주세요')
      transaction.set(publicRef, { ...publicManualEventRecord(reservation.event), media })
      transaction.update(privateRef, {
        status: 'published',
        reviewReason: FieldValue.delete(),
        approvalAttemptId: FieldValue.delete(),
        approvalFingerprint: FieldValue.delete(),
        approvalLeaseExpiresAt: FieldValue.delete(),
        approvalFailure: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('auditEvents').doc(), {
        type: 'calendar_event.automatically_published',
        eventId: id,
        at: FieldValue.serverTimestamp(),
      })
      transaction.set(db.collection('calendarEventOperatorExceptions').doc(id), {
        status: 'resolved',
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    const staleMediaPaths = staleApprovedEventMediaPaths(reservation.previousMediaPaths, approvedEventMediaPaths(media, id))
    await Promise.all(staleMediaPaths.map((path) => getStorage().bucket().file(path).delete({ ignoreNotFound: true })))
    return { eventId: id, status: 'published' as const }
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(privateRef)
      if (current.get('status') !== 'publishing' || current.get('approvalAttemptId') !== attemptId) return
      transaction.update(privateRef, {
        status: 'publishing_failed',
        reviewReason: 'automatic_publication_failed',
        approvalAttemptId: FieldValue.delete(),
        approvalFingerprint: FieldValue.delete(),
        approvalLeaseExpiresAt: FieldValue.delete(),
        approvalFailure: { code: 'copy_or_finalize_failed', at: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.set(db.collection('calendarEventOperatorExceptions').doc(id), {
        eventId: id,
        type: 'automatic_publication_failed',
        status: 'open',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    throw error
  }
}

export const reviewManualEvent = onCall({ region: 'asia-northeast3', timeoutSeconds: 120 }, async (request) => {
  try {
    const operatorUid = requireAuth(request)
    assertEventReviewer(request.auth?.token as Record<string, unknown> | undefined)
    const data = (request.data ?? {}) as { eventId?: unknown; decision?: unknown; note?: unknown; requestId?: unknown }
    const id = eventId(data.eventId)
    const decision = data.decision === 'approve' || data.decision === 'reject' ? data.decision : null
    const note = requiredText(data.note, 500, 2)
    if (!decision) throw new HttpsError('invalid-argument', '검토 결과를 확인해 주세요')
    const privateRef = db.collection(EVENT_COLLECTION).doc(id)
    const publicRef = db.collection(PUBLIC_EVENT_COLLECTION).doc(id)
    if (decision === 'reject') {
      const command = validateReasonedContentModeration({ action: 'request_correction', reason: note, requestId: data.requestId })
      const commandRef = db.collection('auditEvents').doc(operatorModerationCommandKey(operatorUid, command.requestId))
      await db.runTransaction(async (transaction) => {
        const [current, existingCommand] = await Promise.all([transaction.get(privateRef), transaction.get(commandRef)])
        if (existingCommand.exists) {
          if (existingCommand.get('commandType') !== 'calendar_event.review_correction'
            || existingCommand.get('eventId') !== id
            || existingCommand.get('reason') !== command.reason) {
            throw new HttpsError('already-exists', '같은 요청 식별자가 다른 운영 조치에 사용됐어요')
          }
          return
        }
        if (!current.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
        if (current.get('status') !== 'review_queued' && current.get('status') !== 'publishing_failed') {
          throw new HttpsError('failed-precondition', '검토 대기 중인 행사만 처리할 수 있어요')
        }
        const notice = { action: 'request_correction', reason: command.reason, createdAt: FieldValue.serverTimestamp() }
        transaction.update(privateRef, {
          status: 'draft',
          moderationNotice: notice,
          moderationGuidance: notice,
          reviewReason: 'operator_rejected',
          reviewNote: note,
          reviewedBy: operatorUid,
          reviewedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        transaction.create(commandRef, {
          type: 'calendar_event.rejected', operatorUid, eventId: id, note, at: FieldValue.serverTimestamp(),
          commandType: 'calendar_event.review_correction', reason: command.reason, requestId: command.requestId,
        })
      })
      return { eventId: id, status: 'draft' }
    }

    const attemptId = randomUUID()
    const nowMs = Date.now()
    const reservation = await db.runTransaction(async (transaction) => {
      const [privateSnapshot, publicSnapshot] = await Promise.all([
        transaction.get(privateRef),
        transaction.get(publicRef),
      ])
      if (!privateSnapshot.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
      const privateRecord = privateSnapshot.data() ?? {}
      if (operatorModerationBlocksPublication(privateRecord.operatorModeration)) {
        throw new HttpsError('failed-precondition', '운영자가 공개를 중단한 행사는 복원 뒤에만 다시 공개할 수 있어요')
      }
      const reservationDecision = eventApprovalReservationDecision({
        status: privateRecord.status,
        leaseExpiresAtMs: privateRecord.approvalLeaseExpiresAt instanceof Timestamp
          ? privateRecord.approvalLeaseExpiresAt.toMillis()
          : 0,
        nowMs,
      })
      if (reservationDecision === 'busy') {
        throw new HttpsError('aborted', '다른 공개 작업이 진행 중이에요 잠시 뒤 다시 확인해 주세요')
      }
      if (reservationDecision === 'invalid') {
        throw new HttpsError('failed-precondition', '검토 대기 중인 행사만 처리할 수 있어요')
      }
      const event = storedEvent(privateRecord)
      let attestation: ScanAttestation | undefined
      if (event.mediaUploads.length) {
        if (privateRecord.mediaScanStatus !== 'clean') {
          throw new HttpsError('failed-precondition', '사진 안전 검사가 끝나기 전에는 공개할 수 없어요')
        }
        attestation = parseScanAttestation(privateRecord.mediaScanAttestation, nowMs)
        if (attestation.verdict !== 'clean') {
          throw new HttpsError('failed-precondition', '안전한 사진만 공개할 수 있어요')
        }
      }
      const fingerprint = eventApprovalFingerprint(event, attestation)
      if (event.mediaUploads.length && privateRecord.mediaScanFingerprint !== fingerprint) {
        throw new HttpsError('failed-precondition', '사진 검사 뒤 행사 내용이 바뀌었어요 다시 검사해 주세요')
      }
      transaction.update(privateRef, {
        status: 'publishing',
        approvalAttemptId: attemptId,
        approvalFingerprint: fingerprint,
        approvalLeaseExpiresAt: Timestamp.fromMillis(nowMs + APPROVAL_LEASE_MS),
        approvalFailure: FieldValue.delete(),
        publishingStartedAt: FieldValue.serverTimestamp(),
        reviewedBy: operatorUid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return {
        event,
        ownerUid: String(privateRecord.ownerUid ?? ''),
        attestation,
        fingerprint,
        previousMediaPaths: approvedEventMediaPaths(publicSnapshot.get('media'), id),
      }
    })

    try {
      const media = reservation.attestation
        ? await approveEventMedia(reservation.event, reservation.ownerUid, reservation.attestation)
        : undefined
      const actualFingerprint = eventApprovalFingerprint(reservation.event, reservation.attestation)
      if (actualFingerprint !== reservation.fingerprint) {
        throw new HttpsError('aborted', '공개할 행사 버전이 바뀌었어요 다시 확인해 주세요')
      }
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(privateRef)
        if (!current.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
        const currentRecord = current.data() ?? {}
        if (operatorModerationBlocksPublication(currentRecord.operatorModeration)) {
          throw new HttpsError('aborted', '운영자가 공개를 중단해 행사 공개를 마칠 수 없어요')
        }
        const currentEvent = storedEvent(currentRecord)
        const currentAttestation = currentRecord.mediaScanAttestation
          ? parseScanAttestation(currentRecord.mediaScanAttestation)
          : undefined
        const currentFingerprint = eventApprovalFingerprint(currentEvent, currentAttestation)
        if (!eventApprovalMatchesReservation({
          status: currentRecord.status,
          attemptId: currentRecord.approvalAttemptId,
          storedFingerprint: currentRecord.approvalFingerprint,
          computedFingerprint: currentFingerprint,
          expectedAttemptId: attemptId,
          expectedFingerprint: reservation.fingerprint,
        })) throw new HttpsError('aborted', '공개 준비 중 행사 내용이 바뀌었어요 다시 확인해 주세요')
        transaction.set(publicRef, {
          ...publicManualEventRecord(reservation.event),
          ...(media ? { media } : {}),
        })
        transaction.update(privateRef, {
          status: 'published',
          reviewReason: FieldValue.delete(),
          reviewNote: note,
          reviewedBy: operatorUid,
          reviewedAt: FieldValue.serverTimestamp(),
          approvalAttemptId: FieldValue.delete(),
          approvalFingerprint: FieldValue.delete(),
          approvalLeaseExpiresAt: FieldValue.delete(),
          approvalFailure: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        transaction.create(db.collection('auditEvents').doc(), {
          type: 'calendar_event.approved', operatorUid, eventId: id, note, at: FieldValue.serverTimestamp(),
        })
      })
      const staleMediaPaths = staleApprovedEventMediaPaths(reservation.previousMediaPaths, approvedEventMediaPaths(media, id))
      await Promise.all(staleMediaPaths.map((path) => getStorage().bucket().file(path).delete({ ignoreNotFound: true })))
      return { eventId: id, status: 'published' }
    } catch (error) {
      try {
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(privateRef)
          if (current.get('status') !== 'publishing' || current.get('approvalAttemptId') !== attemptId) return
          transaction.update(privateRef, {
            status: 'publishing_failed',
            approvalAttemptId: FieldValue.delete(),
            approvalFingerprint: FieldValue.delete(),
            approvalLeaseExpiresAt: FieldValue.delete(),
            approvalFailure: { code: 'copy_or_finalize_failed', at: FieldValue.serverTimestamp() },
            updatedAt: FieldValue.serverTimestamp(),
          })
          transaction.create(db.collection('auditEvents').doc(), {
            type: 'calendar_event.publish_failed', operatorUid, eventId: id, at: FieldValue.serverTimestamp(),
          })
        })
      } catch (failureStateError) {
        console.error('Event publication failure state could not be persisted', { eventId: id, failureStateError })
      }
      if (error instanceof HttpsError) throw error
      console.error('Event publication failed', { eventId: id, error })
      throw new HttpsError('unavailable', '행사를 공개하지 못했어요 잠시 뒤 자동으로 다시 시도합니다')
    }
  } catch (error) {
    contractError(error)
  }
})
