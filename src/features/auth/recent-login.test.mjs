import test from 'node:test'
import assert from 'node:assert/strict'
import { readRecentLogin, rememberSuccessfulLogin } from './recent-login.ts'

test('new browsers have no badge and only supported provider values are used', () => {
  assert.equal(readRecentLogin({ getItem: () => null }), null)
  assert.equal(readRecentLogin({ getItem: () => 'unknown' }), null)
  assert.equal(readRecentLogin({ getItem: () => 'naver' }), 'naver')
})
test('stores only provider name and tolerates unavailable browser storage', () => {
  let saved
  rememberSuccessfulLogin('kakao', { setItem: (key, value) => { saved = { key, value } } })
  assert.deepEqual(saved, { key: 'weave.lastSuccessfulLoginProvider', value: 'kakao' })
  assert.doesNotThrow(() => rememberSuccessfulLogin('naver', { setItem() { throw Error('denied') } }))
  assert.equal(readRecentLogin({ getItem() { throw Error('denied') } }), null)
})
