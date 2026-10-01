import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'
import { memberProfileResponse } from './member-profile.js'

test('profile producer omits legitimately absent legacy fields without coupling the response to photo storage', () => {
  assert.deepEqual(memberProfileResponse({ region: ' 서울 ', email: null }), {
    profile: { region: '서울' },
  })
  assert.deepEqual(memberProfileResponse(undefined), { profile: {} })
  assert.equal('hasProfilePhoto' in memberProfileResponse(undefined).profile, false)
})

test('profile producer rejects malformed present legacy data instead of returning an empty overwrite candidate', () => {
  for (const document of [
    { region: 37 },
    { email: 'not-an-email' },
    { phone: '123' },
    { bio: '가'.repeat(301) },
  ]) {
    assert.throws(
      () => memberProfileResponse(document),
      (error: unknown) => error instanceof HttpsError && error.code === 'data-loss',
    )
  }
})
