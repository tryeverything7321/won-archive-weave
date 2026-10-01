import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'
import { currentCommunityRulesVersion, currentTermsVersion } from '../auth/terms.js'
import { evaluateActorPolicy } from './actor-policy.js'

const currentMember = {
  connected: true,
  termsVersion: currentTermsVersion,
  communityRulesVersion: currentCommunityRulesVersion,
}

async function errorCode(run: () => Promise<unknown>) {
  try {
    await run()
    assert.fail('expected actor policy rejection')
  } catch (error) {
    assert.ok(error instanceof HttpsError)
    return error.code
  }
}

test('actor policy rejects missing authentication and missing user records', async () => {
  assert.equal(await errorCode(() => evaluateActorPolicy(undefined, async () => currentMember)), 'unauthenticated')
  assert.equal(await errorCode(() => evaluateActorPolicy({ uid: 'member-1' }, async () => undefined)), 'failed-precondition')
})

test('actor policy rejects disconnected and stale-consent members', async () => {
  assert.equal(await errorCode(() => evaluateActorPolicy(
    { uid: 'member-1' },
    async () => ({ ...currentMember, connected: false }),
  )), 'failed-precondition')
  assert.equal(await errorCode(() => evaluateActorPolicy(
    { uid: 'member-1' },
    async () => ({ ...currentMember, termsVersion: '2026-01' }),
  )), 'failed-precondition')
  assert.equal(await errorCode(() => evaluateActorPolicy(
    { uid: 'member-1' },
    async () => ({ ...currentMember, communityRulesVersion: '2026-01' }),
  )), 'failed-precondition')
})

test('actor policy accepts a connected member with current consent', async () => {
  const result = await evaluateActorPolicy({ uid: 'member-1' }, async () => currentMember)
  assert.deepEqual(result, { uid: 'member-1', roleException: null })
})

test('actor policy permits only explicitly allowed role exceptions', async () => {
  let loads = 0
  const loader = async () => {
    loads += 1
    return undefined
  }
  assert.deepEqual(
    await evaluateActorPolicy(
      { uid: 'admin-1', token: { role: 'administrator' } },
      loader,
      { allowRoles: ['administrator'] },
    ),
    { uid: 'admin-1', roleException: 'administrator' },
  )
  assert.equal(loads, 0)
  assert.equal(await errorCode(() => evaluateActorPolicy(
    { uid: 'moderator-1', token: { role: 'moderator' } },
    loader,
    { allowRoles: ['administrator'] },
  )), 'failed-precondition')
})
