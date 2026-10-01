import test from 'node:test'
import assert from 'node:assert/strict'
import { googleAccountPatch } from './google-login.js'
const auth = { uid: 'synthetic-google', token: { firebase: { sign_in_provider: 'google.com' } } }

test('only verified Firebase Google sign-ins may provision a Google member', () => {
  assert.throws(() => googleAccountPatch(undefined))
  assert.throws(() => googleAccountPatch({ uid: 'synthetic', token: { firebase: { sign_in_provider: 'custom' } } }))
  assert.deepEqual(googleAccountPatch(auth), { provider: 'google', connected: true })
})
test('Google does not merge another provider or overwrite profile, consent, or role fields', () => {
  assert.throws(() => googleAccountPatch(auth, { provider: 'kakao' }))
  const patch = googleAccountPatch(auth, { provider: 'google', pseudonym: '기존 이름', termsVersion: 'old' })
  assert.equal('pseudonym' in patch, false)
  assert.equal('termsVersion' in patch, false)
  assert.equal('role' in patch, false)
  assert.equal('email' in patch, false)
})
