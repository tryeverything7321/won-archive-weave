import assert from 'node:assert/strict'
import test from 'node:test'
import { calendarRequestIsCurrent } from './calendar-request.ts'
test('disconnect and account changes reject late calendar responses', () => {
  assert.equal(calendarRequestIsCurrent(1, 1, 'member-a', 'member-a'), true)
  assert.equal(calendarRequestIsCurrent(1, 2, 'member-a', 'member-a'), false)
  assert.equal(calendarRequestIsCurrent(1, 1, 'member-a', 'member-b'), false)
  assert.equal(calendarRequestIsCurrent(1, 1, 'member-a', undefined), false)
})
