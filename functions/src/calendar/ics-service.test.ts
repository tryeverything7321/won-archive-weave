import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IcsContractError,
  isPrivateAddress,
  parseIcs,
  validatePublicIcsUrl,
} from './ics-service.js'

test('accepts public HTTPS ICS URLs and strips fragments', () => {
  assert.equal(
    validatePublicIcsUrl('https://calendar.google.com/calendar/ical/example/public/basic.ics#now'),
    'https://calendar.google.com/calendar/ical/example/public/basic.ics',
  )
})

test('rejects unsafe ICS targets', () => {
  for (const value of [
    'http://calendar.example.com/basic.ics',
    'https://localhost/basic.ics',
    'https://127.0.0.1/basic.ics',
    'https://10.0.0.1/basic.ics',
    'https://[::1]/basic.ics',
    'https://user:pass@example.com/basic.ics',
    'https://example.com:8443/basic.ics',
  ]) {
    assert.throws(() => validatePublicIcsUrl(value), IcsContractError)
  }
  assert.equal(isPrivateAddress('192.168.0.1'), true)
  assert.equal(isPrivateAddress('8.8.8.8'), false)
})

test('parses all-day and timed events without inventing missing content', () => {
  const events = parseIcs([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:event-1@example.com',
    'DTSTART;VALUE=DATE:20260725',
    'DTEND;VALUE=DATE:20260726',
    'SUMMARY:전국 청년 마음공부',
    'DESCRIPTION:함께 공부하고\\n이야기를 나눠요',
    'LOCATION:서울',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:event-2@example.com',
    'DTSTART:20260726T103000Z',
    'SUMMARY:온라인 준비 모임',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'))

  assert.equal(events.length, 2)
  assert.equal(events[0].allDay, true)
  assert.equal(events[0].description, '함께 공부하고\n이야기를 나눠요')
  assert.equal(events[1].allDay, false)
  assert.equal(events[1].endAt.getTime() - events[1].startAt.getTime(), 3_600_000)
})

test('retains the original recurrence instance identity independently of a moved start', () => {
  const [event] = parseIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:weekly@example.com',
    'RECURRENCE-ID;TZID=Asia/Seoul:20260920T100000',
    'DTSTART;TZID=Asia/Seoul:20260920T110000',
    'DTEND;TZID=Asia/Seoul:20260920T120000',
    'SUMMARY:시간이 바뀐 회차',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'))
  assert.equal(event.recurrenceId, '2026-09-20T01:00:00.000Z')
  assert.equal(event.startAt.toISOString(), '2026-09-20T02:00:00.000Z')
})

test('retains an explicit canceled recurrence exception', () => {
  const [event] = parseIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:weekly@example.com',
    'RECURRENCE-ID;TZID=Asia/Seoul:20260920T100000',
    'DTSTART;TZID=Asia/Seoul:20260920T100000',
    'DTEND;TZID=Asia/Seoul:20260920T110000',
    'SUMMARY:취소된 회차',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'))
  assert.equal(event.status, 'cancelled')
  assert.equal(event.recurrenceId, '2026-09-20T01:00:00.000Z')
})

test('requires an event identity, title and start time', () => {
  assert.throws(() => parseIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:제목만 있는 일정',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n')), (error) => error instanceof IcsContractError && error.code === 'invalid_ics')
})

test('stops parsing when an ICS feed exceeds the configured event ceiling', () => {
  const events = Array.from({ length: 4 }, (_, index) => [
    'BEGIN:VEVENT',
    `UID:event-${index}@example.com`,
    `DTSTART:2026072${index + 1}T103000Z`,
    `SUMMARY:일정 ${index + 1}`,
    'END:VEVENT',
  ].join('\n'))
  assert.throws(
    () => parseIcs(['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\n'), 3),
    (error) => error instanceof IcsContractError && error.code === 'too_many_events',
  )
})
