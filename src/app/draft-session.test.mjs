import assert from 'node:assert/strict'
import test from 'node:test'
import { createDraftStore } from '../features/drafts/draft-store.ts'

const { bindDraftAuthSession } = await import('./draft-session.ts').catch(() => ({}))

test('draft boundary waits for settled auth and fences callbacks after unmount', () => {
  assert.equal(typeof bindDraftAuthSession, 'function')
  const reconciled = []
  let authCallback
  let unsubscribed = false
  const stop = bindDraftAuthSession((callback) => {
    authCallback = callback
    return () => { unsubscribed = true }
  }, { reconcileOwner: (ownerId) => reconciled.push(ownerId), sweepExpired: () => {} })
  assert.deepEqual(reconciled, [])
  authCallback({ uid: 'owner-a' })
  authCallback(null)
  authCallback({ uid: 'owner-b' })
  assert.deepEqual(reconciled, ['owner-a', null, 'owner-b'])
  stop()
  authCallback({ uid: 'stale-owner' })
  assert.equal(unsubscribed, true)
  assert.deepEqual(reconciled, ['owner-a', null, 'owner-b'])
})

test('first confirmed signed-out session clears drafts even without a mounted form', () => {
  assert.equal(typeof bindDraftAuthSession, 'function')
  let callback
  const calls = []
  bindDraftAuthSession((next) => { callback = next; return () => {} }, {
    reconcileOwner: (owner) => calls.push(['owner', owner]),
    sweepExpired: () => calls.push(['expiry']),
  })
  assert.deepEqual(calls, [])
  callback(null)
  assert.deepEqual(calls, [['owner', null], ['expiry']])
})

test('global auth transition removes real stored drafts and rejects stale writers', () => {
  const values = new Map()
  const storage = { get length() { return values.size }, key: i => [...values.keys()][i] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const store = createDraftStore(storage, () => 1000)
  const a = { ownerId: 'a', kind: 'contribution', documentId: 'new' }
  store.save(a, 'r1', { body: 'private draft' })
  let callback
  bindDraftAuthSession(next => { callback = next; return () => {} }, store)
  assert.equal(store.load(a).status, 'ready')
  callback({ uid: 'b' })
  assert.equal(values.size, 0)
  assert.equal(store.save(a, 'r2', { body: 'late previous account' }).reason, 'owner_mismatch')
  const b = { ...a, ownerId: 'b' }
  assert.equal(store.save(b, 'r3', { body: 'current account' }).status, 'saved')
  callback(null)
  assert.equal(values.size, 0)
  assert.equal(store.save(b, 'r4', { body: 'late logout' }).reason, 'owner_mismatch')
})
