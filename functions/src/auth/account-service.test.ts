import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AccountPolicyError,
  acceptMemberTerms,
  canUseCommunity,
  claimPseudonym,
  disconnectAccountSession,
  disconnectProvider,
  revokePseudonym,
  termsAcceptancePatch,
  type MemberAccount,
} from './account-service.js'

const account: MemberAccount = { uid: 'member-1', provider: 'naver', connected: true }
const accepted = acceptMemberTerms(account, { termsVersion: '2026-07', communityRulesVersion: '2026-07' })

test('community eligibility requires connection, both acceptances and pseudonym', () => {
  assert.equal(canUseCommunity(account), false)
  const claimed = claimPseudonym(accepted, '함께 걷기', null, 1_000).account
  assert.equal(canUseCommunity(claimed), true)
  assert.equal(canUseCommunity(disconnectProvider(claimed)), false)
})

test('normalizes a claim and releases the previous handle after the 90-day window', () => {
  const first = claimPseudonym(accepted, '함께 걷기', null, 1_000)
  const afterWindow = 1_000 + 90 * 24 * 60 * 60 * 1_000
  const rotated = claimPseudonym(first.account, '  다음  물결 ', null, afterWindow)
  assert.equal(rotated.claim.normalized, '다음 물결')
  assert.equal(rotated.releaseNormalized, '함께 걷기')
})

test('rejects duplicate handles and rotation inside the lock window', () => {
  assert.throws(
    () => claimPseudonym(accepted, '이미 있음', { normalized: '이미 있음', ownerUid: 'member-2' }, 1_000),
    (error: AccountPolicyError) => error.code === 'duplicate_pseudonym',
  )
  const first = claimPseudonym(accepted, '첫 이름', null, 1_000)
  assert.throws(
    () => claimPseudonym(first.account, '새 이름', null, 2_000),
    (error: AccountPolicyError) => error.code === 'change_locked',
  )
})

test('operator revocation removes community eligibility without deleting account linkage', () => {
  const claimed = claimPseudonym(accepted, '푸른 연결', null, 1_000).account
  const revoked = revokePseudonym(claimed, 2_000)
  assert.equal(revoked.uid, account.uid)
  assert.equal(revoked.pseudonym, undefined)
  assert.equal(revoked.pseudonymRevokedAtMs, 2_000)
  assert.equal(canUseCommunity(revoked), false)
})

test('terms acceptance never reconnects a disconnected account', () => {
  const disconnected = disconnectProvider(accepted)
  const patch = termsAcceptancePatch({ termsVersion: '2026-07', communityRulesVersion: '2026-07' })
  assert.equal('connected' in patch, false)
  assert.equal({ ...disconnected, ...patch }.connected, false)
})

test('disconnect persists the account state before revoking refresh tokens', async () => {
  const calls: string[] = []
  await disconnectAccountSession('member-1', {
    async markDisconnected(uid) {
      calls.push(`disconnect:${uid}`)
    },
    async revokeRefreshTokens(uid) {
      calls.push(`revoke:${uid}`)
    },
  })
  assert.deepEqual(calls, ['disconnect:member-1', 'revoke:member-1'])
})
