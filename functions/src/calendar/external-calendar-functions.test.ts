import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CalendarReviewContractError,
  GoogleCalendarSelectionError,
  boundedUniqueIcsEvents,
  calendarImportCandidateStableId,
  calendarImportChangeComparison,
  calendarImportDispositionComparison,
  calendarImportDispositionPlan,
  calendarImportReimportPlan,
  calendarImportWindow,
  expandRecurringIcsEvents,
  googleSelectionCandidateIds,
  settleGoogleCalendarImports,
  publicCalendarEventRecord,
  reviewedCalendarEventRecord,
  safePublicEventUrl,
  selectedGoogleCalendarImportEntries,
  shouldMarkMissingCalendarCandidate,
  selectedGoogleCalendarEvents,
} from './external-calendar-functions.js'
import { IcsContractError, parseIcs } from './ics-service.js'

test('keeps recurring rules as review metadata instead of expanding without bounds', () => {
  const [event] = parseIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:weekly@example.com',
    'DTSTART;TZID=Asia/Seoul:20260725T140000',
    'DTEND;TZID=Asia/Seoul:20260725T160000',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    'SUMMARY:매주 함께하는 공부 모임',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'))
  assert.equal(event.recurrenceRule, 'FREQ=WEEKLY;COUNT=4')
  assert.equal(event.startAt.toISOString(), '2026-07-25T05:00:00.000Z')
})

test('candidate identity survives source time edits and separates recurrence exceptions', () => {
  const base = { uid: 'same@example.com', startAt: new Date('2026-09-20T01:00:00Z') }
  assert.equal(
    calendarImportCandidateStableId('source-a', base),
    calendarImportCandidateStableId('source-a', { ...base, startAt: new Date('2026-09-20T02:00:00Z') }),
  )
  assert.notEqual(
    calendarImportCandidateStableId('source-a', { ...base, recurrenceId: '2026-09-20T01:00:00.000Z' }),
    calendarImportCandidateStableId('source-a', { ...base, recurrenceId: '2026-09-27T01:00:00.000Z' }),
  )
})

test('expands a bounded weekly series while replacing moved and canceled instances', () => {
  const parsed = parseIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:weekly@example.com',
    'DTSTART;TZID=Asia/Seoul:20260906T100000',
    'DTEND;TZID=Asia/Seoul:20260906T110000',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    'SUMMARY:주간 모임',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:weekly@example.com',
    'RECURRENCE-ID;TZID=Asia/Seoul:20260913T100000',
    'DTSTART;TZID=Asia/Seoul:20260913T110000',
    'DTEND;TZID=Asia/Seoul:20260913T120000',
    'SUMMARY:시간 변경 회차',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:weekly@example.com',
    'RECURRENCE-ID;TZID=Asia/Seoul:20260920T100000',
    'DTSTART;TZID=Asia/Seoul:20260920T100000',
    'DTEND;TZID=Asia/Seoul:20260920T110000',
    'SUMMARY:취소 회차',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'))
  const expanded = expandRecurringIcsEvents(parsed, new Date('2026-09-01T00:00:00.000Z'))
  assert.deepEqual(expanded.map((event) => [event.recurrenceId ?? 'master', event.startAt.toISOString(), event.status ?? 'confirmed']), [
    ['master', '2026-09-06T01:00:00.000Z', 'confirmed'],
    ['2026-09-13T01:00:00.000Z', '2026-09-13T02:00:00.000Z', 'confirmed'],
    ['2026-09-20T01:00:00.000Z', '2026-09-20T01:00:00.000Z', 'cancelled'],
    ['2026-09-27T01:00:00.000Z', '2026-09-27T01:00:00.000Z', 'confirmed'],
  ])
})

test('weekly expansion preserves local wall time across daylight-saving changes', () => {
  const [master] = parseIcs([
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:dst@example.com',
    'DTSTART;TZID=America/New_York:20261025T100000',
    'DTEND;TZID=America/New_York:20261025T110000',
    'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:DST series', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'))
  assert.deepEqual(
    expandRecurringIcsEvents([master], new Date('2026-10-01T00:00:00Z')).map((event) => event.startAt.toISOString()),
    ['2026-10-25T14:00:00.000Z', '2026-11-01T15:00:00.000Z', '2026-11-08T15:00:00.000Z'],
  )
})

test('expands monthly and yearly rules without inventing invalid month-end dates', () => {
  const base = {
    uid: 'month-end@example.com', title: '월말 모임', description: '', location: '',
    startAt: new Date('2024-01-31T01:00:00.000Z'), endAt: new Date('2024-01-31T02:00:00.000Z'),
    allDay: false, timeZone: 'Asia/Seoul',
  }
  assert.deepEqual(
    expandRecurringIcsEvents([{ ...base, recurrenceRule: 'FREQ=MONTHLY;COUNT=4' }], new Date('2024-01-01T00:00:00Z'))
      .map((event) => event.startAt.toISOString()),
    ['2024-01-31T01:00:00.000Z', '2024-03-31T01:00:00.000Z', '2024-05-31T01:00:00.000Z', '2024-07-31T01:00:00.000Z'],
  )
  assert.deepEqual(
    expandRecurringIcsEvents([{
      ...base, uid: 'leap@example.com', startAt: new Date('2024-02-29T01:00:00.000Z'), endAt: new Date('2024-02-29T02:00:00.000Z'),
      recurrenceRule: 'FREQ=YEARLY;COUNT=3',
    }], new Date('2027-02-01T00:00:00Z')).map((event) => event.startAt.toISOString()),
    ['2028-02-29T01:00:00.000Z'],
  )
})

test('supports bounded common BY rules and overlays a moved exception', () => {
  const master = {
    uid: 'monthly-byday@example.com', title: '둘째 월요일', description: '', location: '',
    startAt: new Date('2026-09-14T01:00:00.000Z'), endAt: new Date('2026-09-14T02:00:00.000Z'),
    allDay: false, timeZone: 'Asia/Seoul', recurrenceRule: 'FREQ=MONTHLY;BYDAY=2MO;COUNT=4',
  }
  const moved = {
    ...master, recurrenceRule: undefined, recurrenceId: '2026-10-12T01:00:00.000Z',
    startAt: new Date('2026-10-13T01:00:00.000Z'), endAt: new Date('2026-10-13T02:00:00.000Z'),
  }
  assert.deepEqual(
    expandRecurringIcsEvents([master, moved], new Date('2026-09-01T00:00:00Z')).map((event) => event.startAt.toISOString()),
    ['2026-09-14T01:00:00.000Z', '2026-10-13T01:00:00.000Z', '2026-11-09T01:00:00.000Z', '2026-12-14T01:00:00.000Z'],
  )
  assert.throws(
    () => expandRecurringIcsEvents([{ ...master, recurrenceRule: 'FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO;COUNT=3' }], new Date('2026-09-01T00:00:00Z')),
    (error) => error instanceof IcsContractError && error.code === 'unsupported_recurrence',
  )
})

test('honors interval and inclusive until with common BYMONTH and BYMONTHDAY rules', () => {
  const base = {
    uid: 'bounded@example.com', title: '정기 모임', description: '', location: '',
    startAt: new Date('2026-01-31T01:00:00.000Z'), endAt: new Date('2026-01-31T02:00:00.000Z'),
    allDay: false, timeZone: 'Asia/Seoul',
  }
  assert.deepEqual(
    expandRecurringIcsEvents([{
      ...base, recurrenceRule: 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1;UNTIL=20260731T010000Z',
    }], new Date('2026-01-01T00:00:00Z')).map((event) => event.startAt.toISOString()),
    ['2026-01-31T01:00:00.000Z', '2026-03-31T01:00:00.000Z', '2026-05-31T01:00:00.000Z', '2026-07-31T01:00:00.000Z'],
  )
  assert.deepEqual(
    expandRecurringIcsEvents([{
      ...base, startAt: new Date('2024-02-29T01:00:00.000Z'), endAt: new Date('2024-02-29T02:00:00.000Z'),
      recurrenceRule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=2',
    }], new Date('2027-02-01T00:00:00Z')).map((event) => event.startAt.toISOString()),
    ['2028-02-29T01:00:00.000Z'],
  )
})

test('rejects yearly BY expansion without an explicit month instead of silently omitting the year', () => {
  const base = {
    uid: 'yearly-by@example.com', title: '연중 월요일', description: '', location: '',
    startAt: new Date('2026-01-05T01:00:00.000Z'), endAt: new Date('2026-01-05T02:00:00.000Z'),
    allDay: false, timeZone: 'Asia/Seoul',
  }
  for (const recurrenceRule of ['FREQ=YEARLY;BYDAY=MO;COUNT=5', 'FREQ=YEARLY;BYMONTHDAY=1;COUNT=5']) {
    assert.throws(
      () => expandRecurringIcsEvents([{ ...base, recurrenceRule }], new Date('2026-01-01T00:00:00Z')),
      (error) => error instanceof IcsContractError && error.code === 'unsupported_recurrence',
    )
  }
})

test('reimport preserves reviewed state and exposes source changes without overwriting Weave', () => {
  const original = {
    title: '원본', description: '원본 설명', locationName: '서울', startAt: '2026-09-20T01:00:00.000Z',
    endAt: '2026-09-20T02:00:00.000Z', allDay: false, timeZone: 'Asia/Seoul', sourceUrl: null,
    organizerName: '청년회', region: '서울', topic: null, visibility: 'public' as const,
  }
  const changed = { ...original, title: '원본 수정', startAt: '2026-09-20T03:00:00.000Z', endAt: '2026-09-20T04:00:00.000Z' }
  const plan = calendarImportReimportPlan({ status: 'published', sourceRevision: 'old', sourceSnapshot: original }, changed)
  assert.equal(plan.status, 'published')
  assert.equal(plan.sourceSnapshot, original)
  assert.equal(plan.sourceChangeStatus, 'pending')
  assert.deepEqual(plan.sourceChangedFields, ['title', 'startAt', 'endAt'])
})

test('source cancellation and deletion remain explicit changes without reactivating reviewed state', () => {
  const canceled = calendarImportDispositionPlan({ status: 'published', sourceRevision: 'prior' }, 'canceled')
  assert.equal(canceled.status, 'published')
  assert.equal(canceled.sourceChangeStatus, 'pending')
  assert.equal(canceled.pendingSourceDisposition, 'canceled')
  const comparison = calendarImportDispositionComparison('canceled', {
    status: 'published', eventState: 'confirmed', title: '위브에서 수정한 제목',
  })
  assert.deepEqual(comparison.changes, [{
    field: 'eventState', label: '행사 상태', currentValue: '진행 예정', sourceValue: '원본에서 취소',
  }])

  const rejected = calendarImportDispositionPlan({ status: 'rejected', sourceRevision: 'prior' }, 'deleted')
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.sourceChangeStatus, 'none')
  assert.equal(rejected.sourceDispositionObserved, 'deleted')
})

test('a confirmed source creates an explicit restoration only after a disposition was applied', () => {
  const original = {
    title: '원본', description: '', locationName: '서울', startAt: '2026-09-20T01:00:00.000Z',
    endAt: '2026-09-20T02:00:00.000Z', allDay: false, timeZone: 'Asia/Seoul', sourceUrl: null,
    organizerName: '청년회', region: '서울', topic: null, visibility: 'public' as const,
  }
  const restored = calendarImportReimportPlan({
    status: 'published', sourceRevision: 'old', sourceSnapshot: original,
    sourceDispositionApplied: 'deleted', sourceChangeStatus: 'applied',
  }, original)
  assert.equal(restored.sourceChangeStatus, 'pending')
  assert.equal(restored.pendingSourceDisposition, 'confirmed')
  assert.deepEqual(calendarImportDispositionComparison('confirmed', {
    status: 'unpublished', eventState: 'confirmed', title: '보존한 제목',
  }).changes, [{ field: 'eventState', label: '행사 상태', currentValue: '공개 중단', sourceValue: '원본에서 정상' }])

  const baseline = calendarImportReimportPlan({ status: 'pending_review' }, original)
  const neverApplied = calendarImportReimportPlan({
    status: 'published', sourceRevision: baseline.sourceRevision, sourceSnapshot: original,
    pendingSourceDisposition: 'canceled', sourceChangeStatus: 'pending',
  }, original)
  assert.equal(neverApplied.sourceChangeStatus, 'none')
  assert.equal(neverApplied.pendingSourceDisposition, null)
})

test('missing source events are inferred only from a complete snapshot inside the same sync window', () => {
  const window = calendarImportWindow(new Date('2026-09-18T00:00:00Z'))
  const base = { candidateId: 'missing', startAt: '2026-10-01T00:00:00Z', seenCandidateIds: new Set<string>(), window }
  assert.equal(shouldMarkMissingCalendarCandidate({ ...base, completeSnapshot: true }), true)
  assert.equal(shouldMarkMissingCalendarCandidate({ ...base, completeSnapshot: false }), false)
  assert.equal(shouldMarkMissingCalendarCandidate({ ...base, seenCandidateIds: new Set(['missing']), completeSnapshot: true }), false)
  assert.equal(shouldMarkMissingCalendarCandidate({ ...base, startAt: '2028-10-01T00:00:00Z', completeSnapshot: true }), false)
})

test('comparison returns serializable values and revisions fence concurrent Weave edits', () => {
  const source = {
    title: '원본 수정', description: '새 설명', locationName: '서울', startAt: '2026-09-20T03:00:00.000Z',
    endAt: '2026-09-20T04:00:00.000Z', allDay: false, timeZone: 'Asia/Seoul', sourceUrl: null,
    organizerName: '청년회', region: '서울', topic: null, visibility: 'public' as const,
  }
  const comparison = calendarImportChangeComparison(source, {
    title: '위브 수정', summary: '위브 요약', description: '위브 설명', locationName: '서울',
    startAt: new Date('2026-09-20T01:00:00Z'), endAt: new Date('2026-09-20T02:00:00Z'),
    allDay: false, timeZone: 'Asia/Seoul', organizerName: '청년회', region: '서울', visibility: 'public',
  })
  assert.deepEqual(comparison.changes.map((item) => item.field), ['title', 'summary', 'description', 'startAt', 'endAt'])
  assert.ok(comparison.changes.every((item) => ['string', 'boolean', 'object'].includes(typeof item.currentValue)))
  assert.notEqual(comparison.eventRevision, calendarImportChangeComparison(source, {
    title: '동시 수정', summary: '위브 요약', description: '위브 설명', locationName: '서울',
    startAt: new Date('2026-09-20T01:00:00Z'), endAt: new Date('2026-09-20T02:00:00Z'),
    allDay: false, timeZone: 'Asia/Seoul', organizerName: '청년회', region: '서울', visibility: 'public',
  }).eventRevision)
})

test('never substitutes an external calendar feed URL for an event source URL', () => {
  const feedUrl = 'https://calendar.google.com/calendar/ical/public/basic.ics'
  assert.equal(safePublicEventUrl(undefined, feedUrl), undefined)
  assert.equal(safePublicEventUrl(feedUrl, feedUrl), undefined)
})

test('rejects secret-bearing event URLs while retaining a separate canonical public URL', () => {
  const feedUrl = 'https://calendar.google.com/calendar/ical/public/private-secret/basic.ics'
  assert.equal(safePublicEventUrl('https://example.com/events/meeting', feedUrl), 'https://example.com/events/meeting')
  assert.equal(safePublicEventUrl('https://example.com/events/meeting?access_token=secret', feedUrl), undefined)
  assert.equal(safePublicEventUrl('https://example.com/events/meeting?signature=secret', feedUrl), undefined)
  assert.equal(safePublicEventUrl('https://calendar.google.com/calendar/ical/id/private-secret/basic.ics'), undefined)
})

test('public event projection allowlists fields and excludes feed, token and owner identifiers', () => {
  const record = publicCalendarEventRecord({
    title: '청년 모임', summary: '함께 만나요', description: '', organizerName: '서울 청년회',
    startAt: 'start', endAt: 'end', allDay: false, region: '서울',
    locationName: '회관', sourceUrl: 'https://example.com/event', sourceType: 'google_public_ics',
    monthKeys: ['2026-07'], visibility: 'public', publishedAt: 'now', updatedAt: 'now',
    feedUrl: 'https://calendar.google.com/calendar/ical/private-secret/basic.ics',
    token: 'secret', ownerUid: 'member-1', sourceId: 'private-source', externalUid: 'provider-uid',
  })
  assert.equal(record.sourceUrl, 'https://example.com/event')
  assert.equal('feedUrl' in record, false)
  assert.equal('token' in record, false)
  assert.equal('ownerUid' in record, false)
  assert.equal('sourceId' in record, false)
  assert.equal('externalUid' in record, false)
})

test('projects only approved safe event media and caps the public gallery', () => {
  const record = publicCalendarEventRecord({
    title: '청년 모임', startAt: 'start', endAt: 'end', sourceType: 'ics',
    media: {
      status: 'approved',
      thumbnail: { url: 'https://images.example.com/thumb.jpg', alt: '함께 모인 청년들', width: 1200, height: 800, displayMode: 'cover' },
      gallery: [
        { url: 'http://unsafe.example.com/image.jpg', alt: '안전하지 않은 사진' },
        { url: 'https://images.example.com/private.jpg?access_token=secret', alt: '비밀 값이 든 사진' },
        ...Array.from({ length: 9 }, (_, index) => ({ url: `https://images.example.com/${index}.jpg`, alt: `행사 사진 ${index + 1}` })),
      ],
    },
  })
  assert.equal(record.media?.thumbnail?.alt, '함께 모인 청년들')
  assert.equal(record.media?.thumbnail?.displayMode, 'cover')
  assert.equal(record.media?.gallery?.length, 8)
  assert.equal(record.media?.gallery?.[0]?.displayMode, 'contain')
  assert.equal(record.media?.gallery?.some((image) => image.url.includes('secret')), false)

  const pending = publicCalendarEventRecord({
    title: '청년 모임', startAt: 'start', endAt: 'end', sourceType: 'ics',
    media: { status: 'pending_review', thumbnail: { url: 'https://images.example.com/thumb.jpg', alt: '미검토 사진' } },
  })
  assert.equal('media' in pending, false)
})

test('public event projection safely normalizes optional Instagram links', () => {
  const record = publicCalendarEventRecord({
    title: '청년 모임', startAt: 'start', endAt: 'end', sourceType: 'ics',
    instagramPosts: [
      { sourceUrl: 'https://www.instagram.com/p/ABCDE/?igsh=x', mediaType: 'post', shortcode: 'ABCDE' },
      { sourceUrl: 'https://evil.example/p/ABCDE/', mediaType: 'post', shortcode: 'ABCDE' },
    ],
  })
  assert.deepEqual(record.instagramPosts, [{ sourceUrl: 'https://www.instagram.com/p/ABCDE/', mediaType: 'post', shortcode: 'ABCDE' }])
})

test('requires the review gate before producing a published calendar record', () => {
  assert.throws(
    () => reviewedCalendarEventRecord({ status: 'imported', title: '검토 전 일정' }),
    CalendarReviewContractError,
  )
  const record = reviewedCalendarEventRecord({
    status: 'pending_review', title: '검토한 일정', startAt: 'start', endAt: 'end', sourceType: 'ics',
  })
  assert.equal(record.status, 'published')
})

test('bounds ICS candidates to the import window and removes duplicate occurrences', () => {
  const now = new Date('2026-07-22T00:00:00.000Z')
  const window = calendarImportWindow(now)
  assert.equal(window.startAt.toISOString(), '2026-06-01T00:00:00.000Z')
  assert.equal(window.endAt.toISOString(), '2027-08-01T00:00:00.000Z')
  const base = {
    uid: 'event-1', title: '여름 모임', description: '', location: '서울',
    startAt: new Date('2026-08-02T10:00:00.000Z'), endAt: new Date('2026-08-02T12:00:00.000Z'),
    allDay: false, timeZone: 'Asia/Seoul',
  }
  const result = boundedUniqueIcsEvents([
    base,
    { ...base },
    { ...base, uid: 'too-old', startAt: new Date('2026-05-01T00:00:00.000Z'), endAt: new Date('2026-05-01T01:00:00.000Z') },
    { ...base, uid: 'too-far', startAt: new Date('2027-08-01T00:00:00.000Z'), endAt: new Date('2027-08-01T01:00:00.000Z') },
  ], now)
  assert.deepEqual(result.map((event) => event.uid), ['event-1'])
})

test('accepts only explicitly selected Google events and normalizes shared metadata', () => {
  const selection = selectedGoogleCalendarEvents({
    organizerName: ' 서울 청년회 ',
    region: '서울',
    visibility: 'public',
    events: [{
      externalId: 'google-event-1',
      title: ' 함께 걷는 저녁 ',
      description: '산책하며 이야기를 나눠요',
      locationName: '한강공원',
      startAt: '2026-08-02T10:00:00.000Z',
      endAt: '2026-08-02T12:00:00.000Z',
      allDay: false,
      timeZone: 'Asia/Seoul',
    }],
  }, new Date('2026-07-22T00:00:00.000Z'))
  assert.equal(selection.organizerName, '서울 청년회')
  assert.equal(selection.events[0]?.title, '함께 걷는 저녁')
  assert.equal(selection.events[0]?.startAt.toISOString(), '2026-08-02T10:00:00.000Z')
})

test('rejects duplicate, oversized and out-of-range Google event selections', () => {
  const base = {
    organizerName: '서울 청년회', region: '서울', visibility: 'public',
  }
  const event = {
    externalId: 'same', title: '함께 걷는 저녁', startAt: '2026-08-02T10:00:00.000Z',
    endAt: '2026-08-02T12:00:00.000Z', timeZone: 'Asia/Seoul',
  }
  assert.throws(
    () => selectedGoogleCalendarEvents({ ...base, events: [event, event] }, new Date('2026-07-22T00:00:00.000Z')),
    GoogleCalendarSelectionError,
  )
  assert.throws(
    () => selectedGoogleCalendarEvents({ ...base, events: [{ ...event, startAt: '2030-01-01T00:00:00.000Z' }] }, new Date('2026-07-22T00:00:00.000Z')),
    GoogleCalendarSelectionError,
  )
  assert.throws(
    () => selectedGoogleCalendarEvents({ ...base, events: Array.from({ length: 21 }, (_, index) => ({ ...event, externalId: String(index) })) }, new Date('2026-07-22T00:00:00.000Z')),
    GoogleCalendarSelectionError,
  )
})

test('maps each selected Google event to its own organizer and region with legacy defaults', () => {
  const event = { title: '모임', startAt: '2026-08-02T10:00:00.000Z', endAt: '2026-08-02T12:00:00.000Z' }
  const selection = selectedGoogleCalendarEvents({
    organizerName: '서울교당', region: '서울', visibility: 'member_only',
    events: [
      { ...event, externalId: 'first' },
      { ...event, externalId: 'second', organizerName: ' 부산교당 ', region: ' 부산 ' },
    ],
  }, new Date('2026-07-22T00:00:00.000Z'))
  assert.deepEqual(selection.events.map(item => [item.organizerName, item.region]), [['서울교당', '서울'], ['부산교당', '부산']])
})

test('allows individual organizers without a shared organizer and rejects invalid per-event overrides', () => {
  const event = { externalId: 'one', title: '모임', startAt: '2026-08-02T10:00:00.000Z', endAt: '2026-08-02T12:00:00.000Z', organizerName: '부산교당', region: '부산' }
  const now = new Date('2026-07-22T00:00:00.000Z')
  assert.equal(selectedGoogleCalendarEvents({ visibility: 'public', events: [event] }, now).events[0]?.organizerName, '부산교당')
  for (const organizerName of ['', ' ', 42, '가'.repeat(81)]) {
    assert.throws(() => selectedGoogleCalendarEvents({ organizerName: '기본 교당', region: '전국', visibility: 'public', events: [{ ...event, organizerName }] }, now), GoogleCalendarSelectionError)
  }
})

test('keeps successful Google imports and returns only failed items for retry', async () => {
  const attempted: string[] = []
  const first = await settleGoogleCalendarImports(
    [{ externalId: 'first' }, { externalId: 'second' }, { externalId: 'third' }],
    async (event) => {
      attempted.push(event.externalId)
      if (event.externalId === 'second') throw new Error('synthetic-write-failure')
      return event.externalId === 'third' ? 'duplicate' : 'published'
    },
  )
  assert.deepEqual(attempted, ['first', 'second', 'third'])
  assert.deepEqual(first, {
    submitted: 1,
    duplicates: 1,
    failed: 1,
    status: 'partial_failure',
    results: [
      { index: 0, status: 'published' },
      { index: 1, status: 'failed' },
      { index: 2, status: 'duplicate' },
    ],
  })

  const retryItems = first.results.flatMap((result) => result.status === 'failed' ? [
    [{ externalId: 'first' }, { externalId: 'second' }, { externalId: 'third' }][result.index],
  ] : [])
  const retry = await settleGoogleCalendarImports(retryItems, async () => 'published')
  assert.deepEqual(retry, {
    submitted: 1,
    duplicates: 0,
    failed: 0,
    status: 'published',
    results: [{ index: 0, status: 'published' }],
  })
})

test('Google item writes use bounded concurrency and retain input result order', async () => {
  let active = 0
  let maximum = 0
  const result = await settleGoogleCalendarImports(Array.from({ length: 9 }, (_, index) => index), async (index) => {
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise((resolve) => setTimeout(resolve, index % 2 === 0 ? 3 : 1))
    active -= 1
    return 'published'
  }, 3)
  assert.equal(maximum, 3)
  assert.deepEqual(result.results.map((item) => item.index), [0, 1, 2, 3, 4, 5, 6, 7, 8])
})

test('isolates malformed Google rows while global request errors still reject the request', () => {
  const prepared = selectedGoogleCalendarImportEntries({
    organizerName: '기본 교당', region: '전국', visibility: 'public',
    events: [
      { externalId: 'valid', title: '정상', startAt: '2026-08-02T10:00:00.000Z', endAt: '2026-08-02T11:00:00.000Z' },
      { externalId: 'broken', title: '', startAt: 'not-a-date', endAt: '2026-08-02T11:00:00.000Z' },
      { externalId: 'valid', title: '중복', startAt: '2026-08-02T10:00:00.000Z', endAt: '2026-08-02T11:00:00.000Z' },
    ],
  }, new Date('2026-07-22T00:00:00.000Z'))
  assert.deepEqual(prepared.entries.map((entry) => [entry.index, entry.status]), [[0, 'ready'], [1, 'failed'], [2, 'duplicate']])
  assert.throws(() => selectedGoogleCalendarImportEntries({ visibility: 'private', events: [] }), GoogleCalendarSelectionError)
})

test('Google instance identity survives a moved time while distinct provider instances stay separate', () => {
  const before = googleSelectionCandidateIds('member-1', { externalId: 'calendar-a:instance-1', startAt: new Date('2026-08-02T10:00:00Z') })
  const moved = googleSelectionCandidateIds('member-1', { externalId: 'calendar-a:instance-1', startAt: new Date('2026-08-02T11:00:00Z') })
  const other = googleSelectionCandidateIds('member-1', { externalId: 'calendar-a:instance-2', startAt: new Date('2026-08-02T10:00:00Z') })
  assert.equal(before.stable, moved.stable)
  assert.notEqual(before.stable, other.stable)
  assert.notEqual(before.legacy, moved.legacy)
})
