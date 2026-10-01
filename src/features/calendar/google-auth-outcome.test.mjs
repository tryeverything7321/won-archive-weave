import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyGoogleAuthOutcome, reconcileGoogleCalendarSource } from './google-auth-outcome.ts'

const cases = [
  {
    name: 'a closed Google popup is a cancellation and remains retryable',
    input: { source: 'sdk_error_callback', type: 'popup_closed' },
    kind: 'popup_closed',
    state: 'cancelled',
    includes: ['취소', '다시 연결'],
    excludes: ['차단'],
  },
  {
    name: 'a popup that cannot open gives popup unblock recovery',
    input: { source: 'sdk_error_callback', type: 'popup_failed_to_open' },
    kind: 'popup_failed_to_open',
    state: 'error',
    includes: ['팝업 차단', '다시 시도'],
    excludes: ['취소'],
  },
  {
    name: 'an OAuth denial explains the read-only permission and reconnection',
    input: { source: 'oauth_callback', error: 'access_denied' },
    kind: 'access_denied',
    state: 'error',
    includes: ['읽기 권한', '다시 연결'],
    excludes: ['수정 권한'],
  },
  {
    name: 'a Calendar API 401 requires a new authorization',
    input: { source: 'api_response', status: 401 },
    kind: 'authorization_expired',
    state: 'error',
    includes: ['만료', '다시 연결'],
    excludes: ['401'],
  },
  {
    name: 'a failed fetch gives network retry guidance',
    input: { source: 'network' },
    kind: 'network',
    state: 'error',
    includes: ['네트워크', '다시 시도'],
    excludes: [],
  },
  {
    name: 'a missing or invalid client configuration gives a safe support id',
    input: { source: 'configuration' },
    kind: 'configuration',
    state: 'error',
    includes: ['운영자', 'G-CALENDAR-CONFIG'],
    excludes: [],
  },
]

for (const fixture of cases) {
  test(fixture.name, () => {
    const outcome = classifyGoogleAuthOutcome(fixture.input)

    assert.equal(outcome.kind, fixture.kind)
    assert.equal(outcome.state, fixture.state)
    assert.equal(outcome.retryable, true)
    for (const value of fixture.includes) assert.match(outcome.message, new RegExp(value))
    for (const value of fixture.excludes) assert.doesNotMatch(outcome.message, new RegExp(value))
  })
}

test('invalid_grant is treated as expired authorization without exposing provider details', () => {
  const providerDescription = 'token secret-token-value expired for user@example.com'
  const outcome = classifyGoogleAuthOutcome({
    source: 'oauth_callback',
    error: 'invalid_grant',
    error_description: providerDescription,
  })

  assert.equal(outcome.kind, 'authorization_expired')
  assert.doesNotMatch(outcome.message, /secret-token-value|user@example\.com|invalid_grant/)
})

test('unknown SDK error types fail safely without echoing raw values', () => {
  const outcome = classifyGoogleAuthOutcome({
    source: 'sdk_error_callback',
    type: 'future_google_error_secret-token-value',
  })

  assert.deepEqual(outcome, {
    kind: 'unknown',
    state: 'error',
    retryable: true,
    message: 'Google Calendar 연결 중 알 수 없는 문제가 생겼어요. 다시 시도해 주세요. 계속되면 운영자에게 오류 ID G-CALENDAR-UNKNOWN을 알려 주세요.',
  })
})

test('documented OAuth client and origin errors are configuration failures', () => {
  for (const error of ['invalid_client', 'deleted_client', 'origin_mismatch', 'org_internal', 'admin_policy_enforced']) {
    const outcome = classifyGoogleAuthOutcome({ source: 'oauth_callback', error })
    assert.equal(outcome.kind, 'configuration')
    assert.doesNotMatch(outcome.message, new RegExp(error))
  }
})

test('an unsupported API status stays unknown instead of guessing from provider text', () => {
  const outcome = classifyGoogleAuthOutcome({
    source: 'api_response',
    status: 418,
    error_description: 'secret-token-value',
  })

  assert.equal(outcome.kind, 'unknown')
  assert.doesNotMatch(outcome.message, /418|secret-token-value/)
})

test('reauthorization retains a readable non-primary source calendar and its selected events', () => {
  const outcome = reconcileGoogleCalendarSource('team-calendar', [
    { id: 'personal-primary', primary: true },
    { id: 'team-calendar' },
  ])

  assert.deepEqual(outcome, {
    calendarId: 'team-calendar',
    clearDependentSelection: false,
  })
})

test('reauthorization clears dependent events when their source calendar is no longer readable', () => {
  const outcome = reconcileGoogleCalendarSource('removed-team-calendar', [
    { id: 'personal-primary', primary: true },
    { id: 'another-calendar' },
  ])

  assert.deepEqual(outcome, {
    calendarId: 'personal-primary',
    clearDependentSelection: true,
  })
})
