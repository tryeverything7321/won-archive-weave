import test from 'node:test'
import assert from 'node:assert/strict'
import { finishGoogleLogin } from './google-login.ts'

test('Google login badge is recorded only after server provisioning succeeds', async () => {
  const events = []
  await finishGoogleLogin({ signIn: async () => { events.push('signin') }, provision: async () => { events.push('provision') }, signOut: async () => { events.push('signout') }, remember: () => { events.push('remember') } })
  assert.deepEqual(events, ['signin', 'provision', 'remember'])
})
test('failed provisioning ends the partial session without changing recent login', async () => {
  const events = []
  await assert.rejects(finishGoogleLogin({ signIn: async () => {}, provision: async () => { throw Error('unavailable') }, signOut: async () => { events.push('signout') }, remember: () => { events.push('remember') } }))
  assert.deepEqual(events, ['signout'])
})
test('cancelled popup leaves an existing session and recent login untouched', async () => {
  const events = []
  await assert.rejects(finishGoogleLogin({ signIn: async () => { throw Error('cancelled') }, provision: async () => { events.push('provision') }, signOut: async () => { events.push('signout') }, remember: () => { events.push('remember') } }))
  assert.deepEqual(events, [])
})
