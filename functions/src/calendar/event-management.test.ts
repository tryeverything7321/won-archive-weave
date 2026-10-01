import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'
import {
  EventManagementContractError,
  assertEventOwner,
  assertEventReviewer,
  assertRestorableManualEventProjection,
  assertTrustAdministrator,
  eventApprovalFingerprint,
  eventApprovalMatchesReservation,
  eventApprovalReservationDecision,
  eventScanApplicationDecision,
  eventMediaScanResetRequired,
  ownerEventTransitionPlan,
  ownerEventRestoreAllowed,
  eventPublicationDecision,
  normalizeManualEventInput,
  publicManualEventRecord,
  immediatePublicEventRecord,
  manualEventModerationPlan,
  safeEventUrl,
  staleApprovedEventMediaPaths,
} from './event-management.js'
import { assertAttestationMatchesObjects, parseScanAttestation } from '../uploads/scan-attestation.js'

const ownerUid = 'member-owner-123'
const eventId = 'event-self-service-001'

test('only an owner-unpublished event without a public projection or operator block can return to draft', () => {
  assert.equal(ownerEventRestoreAllowed('unpublished', false, false), true)
  assert.equal(ownerEventRestoreAllowed('published', false, false), false)
  assert.equal(ownerEventRestoreAllowed('unpublished', true, false), false)
  assert.equal(ownerEventRestoreAllowed('unpublished', false, true), false)
})

test('event moderation preserves visible correction and blocks removal without guidance', () => {
  assert.deepEqual(manualEventModerationPlan({ status: 'published', action: 'request_correction', hasPublicProjection: true, hasPriorGuidance: false }), {
    nextStatus: 'draft', publicAction: 'unchanged', markerAction: null,
  })
  assert.deepEqual(manualEventModerationPlan({ status: 'review_queued', action: 'hold', hasPublicProjection: true, hasPriorGuidance: false }), {
    nextStatus: 'unpublished', publicAction: 'hide', markerAction: 'hold',
  })
  assert.throws(() => manualEventModerationPlan({ status: 'published', action: 'remove', hasPublicProjection: true, hasPriorGuidance: false }), { code: 'failed-precondition' })
})

test('event restore requires an operator marker and keeps safe pending workflow', () => {
  assert.deepEqual(manualEventModerationPlan({ status: 'draft', action: 'restore', hasPublicProjection: true, hasPriorGuidance: true, markerAction: 'hold' }), {
    nextStatus: 'draft', publicAction: 'restore', markerAction: null,
  })
})

test('event restore only accepts a hidden manual public projection', () => {
  assert.doesNotThrow(() => assertRestorableManualEventProjection({ status: 'unpublished', sourceType: 'manual' }))
  assert.throws(() => assertRestorableManualEventProjection({ status: 'published', sourceType: 'manual' }), { code: 'failed-precondition' })
  assert.throws(() => assertRestorableManualEventProjection({ status: 'unpublished', sourceType: 'ics' }), { code: 'failed-precondition' })
})

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    eventId,
    title: '청년 여름 마음 공부',
    summary: '함께 쉬고 배우는 이틀',
    description: '지역 청년들이 모여 마음 공부와 대화를 나눕니다.',
    startAt: '2026-08-15T01:00:00.000Z',
    endAt: '2026-08-16T05:00:00.000Z',
    allDay: false,
    timeZone: 'Asia/Seoul',
    region: '서울',
    organizerName: '서울 청년회',
    locationName: '원불교 서울회관',
    address: '서울시 동작구 현충로 75',
    registrationUrl: 'https://example.org/events/summer',
    registrationDeadline: '2026-08-12T14:59:00.000Z',
    registrationStatus: 'open',
    visibility: 'public',
    sourceUrl: 'https://example.org/notices/summer',
    instagramPosts: [],
    mediaUploads: [],
    ...overrides,
  }
}

test('normalizes the complete manual event contract', () => {
  const event = normalizeManualEventInput(validInput(), ownerUid)
  assert.equal(event.title, '청년 여름 마음 공부')
  assert.equal(event.startAt.toISOString(), '2026-08-15T01:00:00.000Z')
  assert.equal(event.registrationStatus, 'open')
  assert.equal(event.visibility, 'public')
})

test('normalizes image display mode and Instagram posts through the manual event contract', () => {
  const upload = {
    role: 'thumbnail',
    storagePath: `quarantined/${ownerUid}/calendar-events/${eventId}/poster.jpg`,
    fileName: 'poster.jpg', contentType: 'image/jpeg', size: 1024, alt: '세로형 행사 포스터', displayMode: 'cover',
  }
  const event = normalizeManualEventInput(validInput({
    mediaUploads: [upload],
    instagramPosts: [{ sourceUrl: 'https://www.instagram.com/p/ABCDE/?igsh=x', mediaType: 'post', shortcode: 'ABCDE' }],
  }), ownerUid)
  assert.equal(event.mediaUploads[0].displayMode, 'cover')
  assert.equal(event.instagramPosts[0].sourceUrl, 'https://www.instagram.com/p/ABCDE/')
  assert.throws(() => normalizeManualEventInput(validInput({ mediaUploads: [{ ...upload, displayMode: 'stretch' }] }), ownerUid), EventManagementContractError)
})

test('normalizes inclusive all-day dates in the declared timezone', () => {
  const sameDay = normalizeManualEventInput(validInput({
    allDay: true,
    startAt: '2026-10-03',
    endAt: '2026-10-03',
    timeZone: 'Asia/Seoul',
  }), ownerUid)
  assert.equal(sameDay.startAt.toISOString(), '2026-10-02T15:00:00.000Z')
  assert.equal(sameDay.endAt.toISOString(), '2026-10-03T15:00:00.000Z')

  const multiDay = normalizeManualEventInput(validInput({
    allDay: true,
    startAt: '2026-10-03',
    endAt: '2026-10-05',
    timeZone: 'Asia/Seoul',
  }), ownerUid)
  assert.equal(multiDay.endAt.toISOString(), '2026-10-05T15:00:00.000Z')

  const acrossDst = normalizeManualEventInput(validInput({
    allDay: true,
    startAt: '2026-10-15',
    endAt: '2026-11-14',
    timeZone: 'America/New_York',
  }), ownerUid)
  assert.equal(acrossDst.startAt.toISOString(), '2026-10-15T04:00:00.000Z')
  assert.equal(acrossDst.endAt.toISOString(), '2026-11-15T05:00:00.000Z')

  const legacyExclusiveInstants = normalizeManualEventInput(validInput({
    allDay: true,
    startAt: '2026-10-02T15:00:00.000Z',
    endAt: '2026-10-03T15:00:00.000Z',
  }), ownerUid)
  assert.equal(legacyExclusiveInstants.startAt.toISOString(), '2026-10-02T15:00:00.000Z')
  assert.equal(legacyExclusiveInstants.endAt.toISOString(), '2026-10-03T15:00:00.000Z')
})

test('normalizes local timed input in the declared timezone', () => {
  const event = normalizeManualEventInput(validInput({
    startAt: '2026-10-03T10:00',
    endAt: '2026-10-03T12:00',
    timeZone: 'Asia/Seoul',
  }), ownerUid)
  assert.equal(event.startAt.toISOString(), '2026-10-03T01:00:00.000Z')
  assert.equal(event.endAt.toISOString(), '2026-10-03T03:00:00.000Z')
})

test('no-registration strips stale deadline and URL before validating them', () => {
  const event = normalizeManualEventInput(validInput({
    registrationStatus: 'not_required',
    registrationDeadline: '2099-01-01T00:00:00.000Z',
    registrationUrl: 'javascript:stale',
  }), ownerUid)
  assert.equal(event.registrationDeadline, undefined)
  assert.equal(event.registrationUrl, undefined)
})

test('accepts a concise event and requires either a place or an online link', () => {
  const concise = normalizeManualEventInput(validInput({
    summary: '',
    description: '',
    locationName: '',
    onlineUrl: 'https://meet.example.org/youth',
  }), ownerUid)

  assert.equal(concise.summary, '서울 청년회에서 준비한 행사입니다.')
  assert.equal(concise.description, '')
  assert.equal(concise.locationName, '온라인')
  assert.equal(concise.onlineUrl, 'https://meet.example.org/youth')
  assert.throws(() => normalizeManualEventInput(validInput({
    locationName: '',
    onlineUrl: '',
  }), ownerUid), EventManagementContractError)
})

test('rejects malformed dates, long events and secret-bearing URLs', () => {
  assert.throws(() => normalizeManualEventInput(validInput({ endAt: 'invalid' }), ownerUid), EventManagementContractError)
  assert.throws(() => normalizeManualEventInput(validInput({ endAt: '2026-10-01T00:00:00.000Z' }), ownerUid), EventManagementContractError)
  assert.throws(() => safeEventUrl('https://example.org/event?access_token=secret'), EventManagementContractError)
  assert.throws(() => safeEventUrl('http://example.org/event'), EventManagementContractError)
})

test('enforces one thumbnail, eight gallery images, MIME, size, alt and owner path', () => {
  const upload = (index: number, role: 'thumbnail' | 'gallery' = 'gallery') => ({
    role,
    storagePath: `quarantined/${ownerUid}/calendar-events/${eventId}/${index}.jpg`,
    fileName: `${index}.jpg`,
    contentType: 'image/jpeg',
    size: 1024,
    alt: `행사 사진 ${index + 1}`,
  })
  assert.equal(normalizeManualEventInput(validInput({ mediaUploads: [upload(0, 'thumbnail'), ...Array.from({ length: 8 }, (_, i) => upload(i + 1))] }), ownerUid).mediaUploads.length, 9)
  assert.throws(() => normalizeManualEventInput(validInput({ mediaUploads: [upload(0, 'thumbnail'), upload(1, 'thumbnail')] }), ownerUid), EventManagementContractError)
  assert.throws(() => normalizeManualEventInput(validInput({ mediaUploads: [upload(0), ...Array.from({ length: 9 }, (_, i) => upload(i + 1))] }), ownerUid), EventManagementContractError)
  assert.throws(() => normalizeManualEventInput(validInput({ mediaUploads: [{ ...upload(0), storagePath: `quarantined/other/calendar-events/${eventId}/0.jpg` }] }), ownerUid), EventManagementContractError)
  assert.throws(() => normalizeManualEventInput(validInput({ mediaUploads: [{ ...upload(0), contentType: 'image/svg+xml' }] }), ownerUid), EventManagementContractError)
  assert.throws(() => normalizeManualEventInput(validInput({ mediaUploads: [{ ...upload(0), alt: '' }] }), ownerUid), EventManagementContractError)
})

test('publishes ordinary event metadata without organizer approval', () => {
  const next = normalizeManualEventInput(validInput(), ownerUid)
  assert.deepEqual(eventPublicationDecision({ trustedOrganizer: false, next }), { status: 'published' })
  assert.deepEqual(eventPublicationDecision({ trustedOrganizer: true, next }), { status: 'published' })
  assert.deepEqual(eventPublicationDecision({
    trustedOrganizer: true,
    existing: { ...next, status: 'published' },
    next: { ...next, title: '제목만 안전하게 수정' },
  }), { status: 'updated' })
  assert.deepEqual(eventPublicationDecision({
    trustedOrganizer: true,
    existing: { ...next, status: 'published' },
    next: { ...next, visibility: 'member_only' },
  }), { status: 'updated' })
})

test('new media waits only for automatic safety scanning', () => {
  const next = normalizeManualEventInput(validInput({
    mediaUploads: [{
      role: 'thumbnail',
      storagePath: `quarantined/${ownerUid}/calendar-events/${eventId}/cover.jpg`,
      fileName: 'cover.jpg', contentType: 'image/jpeg', size: 2048, alt: '행사 대표 사진',
    }],
  }), ownerUid)
  assert.deepEqual(eventPublicationDecision({ trustedOrganizer: true, next }), {
    status: 'review_queued', reviewReason: 'media_scan_pending',
  })
})

test('owner checks reject another user and trust grants remain administrator-only', () => {
  assert.doesNotThrow(() => assertEventOwner(ownerUid, ownerUid))
  assert.throws(() => assertEventOwner(ownerUid, 'member-other-456'), (error: HttpsError) => error.code === 'permission-denied')
  assert.doesNotThrow(() => assertTrustAdministrator({ role: 'administrator' }))
  assert.throws(() => assertTrustAdministrator({ role: 'moderator' }), (error: HttpsError) => error.code === 'permission-denied')
  assert.throws(() => assertTrustAdministrator(undefined), (error: HttpsError) => error.code === 'permission-denied')
})

test('manual event review accepts only moderator or administrator roles', () => {
  assert.doesNotThrow(() => assertEventReviewer({ role: 'moderator' }))
  assert.doesNotThrow(() => assertEventReviewer({ role: 'administrator' }))
  assert.throws(() => assertEventReviewer({ role: 'member' }), (error: HttpsError) => error.code === 'permission-denied')
  assert.throws(() => assertEventReviewer(undefined), (error: HttpsError) => error.code === 'permission-denied')
})

test('public projection excludes ownership and quarantined media while retaining registration fields', () => {
  const event = normalizeManualEventInput(validInput(), ownerUid)
  const record = publicManualEventRecord(event)
  assert.equal(record.status, 'published')
  assert.equal(record.registrationStatus, 'open')
  assert.equal(record.sourceType, 'manual')
  assert.equal('ownerUid' in record, false)
  assert.equal('mediaUploads' in record, false)
  assert.deepEqual(record.monthKeys, ['2026-08'])
  assert.deepEqual(record.instagramPosts, [])
})

test('manual public projection and approval fingerprint retain presentation and Instagram metadata', () => {
  const base = normalizeManualEventInput(validInput({
    instagramPosts: [{ sourceUrl: 'https://www.instagram.com/reel/Abcde_1/', mediaType: 'reel', shortcode: 'Abcde_1' }],
  }), ownerUid)
  assert.deepEqual(publicManualEventRecord(base).instagramPosts, base.instagramPosts)
  assert.notEqual(eventApprovalFingerprint(base), eventApprovalFingerprint({ ...base, instagramPosts: [] }))
  assert.notEqual(
    eventApprovalFingerprint({ ...base, mediaUploads: [{ role: 'gallery', storagePath: `quarantined/${ownerUid}/calendar-events/${eventId}/a.jpg`, fileName: 'a.jpg', contentType: 'image/jpeg', size: 1, alt: '사진 설명', displayMode: 'contain' }] }),
    eventApprovalFingerprint({ ...base, mediaUploads: [{ role: 'gallery', storagePath: `quarantined/${ownerUid}/calendar-events/${eventId}/a.jpg`, fileName: 'a.jpg', contentType: 'image/jpeg', size: 1, alt: '사진 설명', displayMode: 'cover' }] }),
  )
})

test('an all-day event ending on the last local day does not leak into the next month key', () => {
  const event = normalizeManualEventInput(validInput({
    allDay: true,
    startAt: '2026-10-31',
    endAt: '2026-10-31',
  }), ownerUid)
  assert.deepEqual(publicManualEventRecord(event).monthKeys, ['2026-10'])
})

test('a canceled event remains canceled when its owner edits details', () => {
  const next = normalizeManualEventInput(validInput(), ownerUid)
  assert.deepEqual(
    eventPublicationDecision({ trustedOrganizer: true, existing: { ...next, status: 'canceled' }, next: { ...next, locationName: '변경된 장소' } }),
    { status: 'canceled' },
  )
})

test('unpublished and publishing events cannot re-enter the ordinary update path', () => {
  const next = normalizeManualEventInput(validInput(), ownerUid)
  assert.throws(() => eventPublicationDecision({ trustedOrganizer: true, existing: { ...next, status: 'unpublished' }, next }), EventManagementContractError)
  assert.throws(() => eventPublicationDecision({ trustedOrganizer: true, existing: { ...next, status: 'publishing' }, next }), EventManagementContractError)
})

test('owner cancellation and unpublication are distinct and retry safe', () => {
  assert.deepEqual(ownerEventTransitionPlan('published', 'cancel', true), {
    nextStatus: 'canceled', publicAction: 'mark_canceled', repeated: false,
  })
  assert.deepEqual(ownerEventTransitionPlan('canceled', 'cancel', true), {
    nextStatus: 'canceled', publicAction: 'unchanged', repeated: true,
  })
  assert.deepEqual(ownerEventTransitionPlan('canceled', 'unpublish', true), {
    nextStatus: 'unpublished', publicAction: 'remove', repeated: false,
  })
  assert.deepEqual(ownerEventTransitionPlan('unpublished', 'unpublish', false), {
    nextStatus: 'unpublished', publicAction: 'unchanged', repeated: true,
  })
  assert.throws(() => ownerEventTransitionPlan('publishing', 'cancel', true), EventManagementContractError)
})

test('event approval fingerprint is stable and changes with content, media or scan changes', () => {
  const event = normalizeManualEventInput(validInput(), ownerUid)
  const clean = {
    schemaVersion: 1 as const,
    verdict: 'clean' as const,
    provider: 'test-scanner',
    scanId: 'scan-001',
    engineVersion: '1.0',
    scannedAtMs: 1_785_000_000_000,
    objects: [{ path: 'quarantined/a.jpg', generation: '1', size: 10, contentHash: 'abc' }],
  }
  assert.equal(eventApprovalFingerprint(event, clean), eventApprovalFingerprint(event, clean))
  assert.notEqual(eventApprovalFingerprint(event, clean), eventApprovalFingerprint({ ...event, title: '바뀐 행사' }, clean))
  assert.notEqual(eventApprovalFingerprint(event, clean), eventApprovalFingerprint(event, { ...clean, scanId: 'scan-002' }))
})

test('event publication reservation blocks an active lease and recovers an expired one', () => {
  assert.equal(eventApprovalReservationDecision({ status: 'review_queued', nowMs: 100 }), 'reserve')
  assert.equal(eventApprovalReservationDecision({ status: 'publishing_failed', nowMs: 100 }), 'reserve')
  assert.equal(eventApprovalReservationDecision({ status: 'publishing', leaseExpiresAtMs: 200, nowMs: 100 }), 'busy')
  assert.equal(eventApprovalReservationDecision({ status: 'publishing', leaseExpiresAtMs: 99, nowMs: 100 }), 'reserve')
  assert.equal(eventApprovalReservationDecision({ status: 'published', nowMs: 100 }), 'invalid')
})

test('removing failed photos allows the event to update without another scan', () => {
  const next = normalizeManualEventInput(validInput(), ownerUid)
  assert.deepEqual(eventPublicationDecision({
    trustedOrganizer: true,
    existing: { ...next, status: 'publishing_failed' },
    next,
  }), { status: 'updated' })
})

test('event content publishes immediately while new photos remain absent from the public record', () => {
  const next = normalizeManualEventInput(validInput({
    mediaUploads: [{
      role: 'thumbnail',
      storagePath: `quarantined/${ownerUid}/calendar-events/${eventId}/cover.jpg`,
      fileName: 'cover.jpg', contentType: 'image/jpeg', size: 2048, alt: '행사 대표 사진',
    }],
  }), ownerUid)
  const record = immediatePublicEventRecord(next)
  assert.equal(record.status, 'published')
  assert.equal(record.title, next.title)
  assert.equal('media' in record, false)
  assert.equal('mediaUploads' in record, false)
  const changed = { ...next, title: '검사 중 수정한 행사' }
  assert.equal(immediatePublicEventRecord(changed, next, record).title, changed.title)
  assert.equal(eventPublicationDecision({ trustedOrganizer: false, existing: { ...next, status: 'review_queued' }, next: changed }).status, 'review_queued')
  assert.equal(eventMediaScanResetRequired({ ...next, status: 'review_queued' }, changed), false)
  assert.equal(eventMediaScanResetRequired({ ...next, status: 'review_queued' }, { ...changed, visibility: 'member_only' }), true)
  assert.equal(eventMediaScanResetRequired({ ...next, status: 'publishing_failed' }, changed), true)
})

test('photo removal and visibility changes never retain obsolete public photos', () => {
  const next = normalizeManualEventInput(validInput({
    mediaUploads: [{
      role: 'thumbnail',
      storagePath: `quarantined/${ownerUid}/calendar-events/${eventId}/cover.jpg`,
      fileName: 'cover.jpg', contentType: 'image/jpeg', size: 2048, alt: '행사 대표 사진',
    }],
  }), ownerUid)
  const previousPublic = { media: { thumbnail: { url: 'approved-image' } }, publishedAt: 'original-date' }
  assert.deepEqual(immediatePublicEventRecord(next, next, previousPublic).media, previousPublic.media)
  const removed = immediatePublicEventRecord({ ...next, mediaUploads: [] }, next, previousPublic)
  assert.equal('media' in removed, false)
  assert.equal(removed.publishedAt, 'original-date')
  const restricted = { ...next, visibility: 'member_only' as const }
  assert.equal('media' in immediatePublicEventRecord(restricted, next, previousPublic), false)
  assert.equal(eventPublicationDecision({ trustedOrganizer: false, existing: { ...next, status: 'published' }, next: restricted }).status, 'review_queued')
})

test('event media scan evidence must be clean and match the exact object generation and hash', () => {
  const actual = [{ path: 'quarantined/member/event/cover.jpg', generation: '7', size: 2048, contentHash: 'hash-a' }]
  const attestation = parseScanAttestation({
    schemaVersion: 1,
    verdict: 'clean',
    provider: 'test-scanner',
    scanId: 'scan-event-001',
    engineVersion: '1.0',
    scannedAtMs: Date.now(),
    objects: actual,
  })
  assert.doesNotThrow(() => assertAttestationMatchesObjects(attestation, actual))
  assert.throws(() => assertAttestationMatchesObjects(attestation, [{ ...actual[0], generation: '8' }]), HttpsError)
  assert.throws(() => assertAttestationMatchesObjects(attestation, [{ ...actual[0], contentHash: 'hash-b' }]), HttpsError)
})

test('final publication accepts only the exact reserved attempt and revision', () => {
  const base = {
    status: 'publishing',
    attemptId: 'attempt-a',
    storedFingerprint: 'fingerprint-a',
    computedFingerprint: 'fingerprint-a',
    expectedAttemptId: 'attempt-a',
    expectedFingerprint: 'fingerprint-a',
  }
  assert.equal(eventApprovalMatchesReservation(base), true)
  assert.equal(eventApprovalMatchesReservation({ ...base, attemptId: 'attempt-b' }), false)
  assert.equal(eventApprovalMatchesReservation({ ...base, computedFingerprint: 'fingerprint-b' }), false)
  assert.equal(eventApprovalMatchesReservation({ ...base, status: 'review_queued' }), false)
})

test('late event media results require an eligible state and the same scan revision', () => {
  const eligible = {
    status: 'review_queued',
    capturedRevision: 'revision-a',
    currentRevision: 'revision-a',
  }
  assert.equal(eventScanApplicationDecision(eligible), 'apply')
  assert.equal(eventScanApplicationDecision({ ...eligible, currentRevision: 'revision-b' }), 'ignore')
  assert.equal(eventScanApplicationDecision({ ...eligible, status: 'canceled' }), 'ignore')
  assert.equal(eventScanApplicationDecision({ ...eligible, status: 'unpublished' }), 'ignore')
})

test('stale approved event media is removed for every visibility transition', () => {
  assert.deepEqual(staleApprovedEventMediaPaths(
    ['approved/public/calendar-events/event/a.jpg', 'approved/members/calendar-events/event/b.jpg'],
    ['approved/public/calendar-events/event/c.jpg'],
  ), ['approved/public/calendar-events/event/a.jpg', 'approved/members/calendar-events/event/b.jpg'])
})
