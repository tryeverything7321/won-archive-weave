import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OAuthFlowError,
  completeOAuthCallback,
  consumeOAuthCompletion,
  firebaseUid,
  hashOAuthSecret,
  oauthAccountRecord,
  type OAuthProvider,
  type OAuthSession,
} from './oauth-service.js'

function harness(session: OAuthSession | null, providerFailure = false) {
  let consumed = false
  const exchangeCalls: Array<{ code: string; state: string; redirectUri: string }> = []
  const adapter = {
    async exchangeCode(input: { code: string; state: string; redirectUri: string }) {
      exchangeCalls.push(input)
      if (providerFailure) throw new Error('provider down')
      return { subject: 'stable-provider-subject' }
    },
  }
  return {
    exchangeCalls,
    dependencies: {
      now: () => 1_000,
      sessions: {
        async consume(stateHash: string, consumedAtMs: number) {
          assert.equal(stateHash, hashOAuthSecret('state-value'))
          assert.equal(consumedAtMs, 1_000)
          if (consumed) return null
          consumed = true
          return session ? { ...session, consumedAtMs: session.consumedAtMs ?? undefined } : null
        },
      },
      adapters: { naver: adapter, kakao: adapter },
      tokens: {
        async issue(uid: string, claims: { provider: OAuthProvider }) {
          return `custom:${claims.provider}:${uid}`
        },
      },
    },
  }
}

const validSession: OAuthSession = {
  provider: 'kakao',
  stateHash: hashOAuthSecret('state-value'),
  redirectOrigin: 'https://weave.example',
  expiresAtMs: 2_000,
}

test('completes a callback with an injectable provider and custom-token issuer', async () => {
  const { dependencies, exchangeCalls } = harness(validSession)
  const result = await completeOAuthCallback({
    provider: 'kakao',
    state: 'state-value',
    code: 'code-value',
    redirectOrigin: 'https://weave.example',
    redirectUri: 'https://weave.example/oauth/kakao/callback',
  }, dependencies)
  assert.equal(result.uid, 'kakao:stable-provider-subject')
  assert.equal(result.uid, firebaseUid('kakao', 'stable-provider-subject'))
  assert.match(result.customToken, /^custom:kakao:/)
  assert.deepEqual(exchangeCalls, [{
    code: 'code-value',
    state: 'state-value',
    redirectUri: 'https://weave.example/oauth/kakao/callback',
  }])
})

test('consumes state before classifying a provider cancellation', async () => {
  const { dependencies, exchangeCalls } = harness(validSession)
  const callback = {
    provider: 'kakao' as const,
    state: 'state-value',
    error: 'access_denied',
    redirectOrigin: 'https://weave.example',
    redirectUri: 'https://weave.example/oauth/kakao/callback',
  }
  await assert.rejects(
    completeOAuthCallback(callback, dependencies),
    (error: OAuthFlowError) => error.code === 'cancelled',
  )
  await assert.rejects(
    completeOAuthCallback({ ...callback, error: undefined, code: 'replay-code' }, dependencies),
    (error: OAuthFlowError) => error.code === 'invalid_state',
  )
  assert.equal(exchangeCalls.length, 0)
})

test('rejects replay, expiry, provider mismatch and origin mismatch', async () => {
  const callback = {
    provider: 'kakao' as const,
    state: 'state-value',
    code: 'code-value',
    redirectOrigin: 'https://weave.example',
    redirectUri: 'https://weave.example/oauth/kakao/callback',
  }
  const replay = harness(null)
  await assert.rejects(completeOAuthCallback(callback, replay.dependencies), (error: OAuthFlowError) => error.code === 'invalid_state')

  const expired = harness({ ...validSession, expiresAtMs: 999 })
  await assert.rejects(completeOAuthCallback(callback, expired.dependencies), (error: OAuthFlowError) => error.code === 'expired_state')

  const mismatch = harness({ ...validSession, provider: 'naver' })
  await assert.rejects(completeOAuthCallback(callback, mismatch.dependencies), (error: OAuthFlowError) => error.code === 'provider_mismatch')

  const origin = harness({ ...validSession, redirectOrigin: 'https://attacker.example' })
  await assert.rejects(completeOAuthCallback(callback, origin.dependencies), (error: OAuthFlowError) => error.code === 'origin_mismatch')
})

test('wraps provider failure without exposing provider response details', async () => {
  const { dependencies } = harness(validSession, true)
  await assert.rejects(
    completeOAuthCallback({
      provider: 'kakao',
      state: 'state-value',
      code: 'secret-code',
      redirectOrigin: 'https://weave.example',
      redirectUri: 'https://weave.example/oauth/kakao/callback',
    }, dependencies),
    (error: OAuthFlowError) => error.code === 'provider_unavailable' && !error.message.includes('secret-code'),
  )
})

test('allows only one concurrent callback to consume a state', async () => {
  const { dependencies } = harness(validSession)
  const callback = {
    provider: 'kakao' as const,
    state: 'state-value',
    code: 'code-value',
    redirectOrigin: 'https://weave.example',
    redirectUri: 'https://weave.example/oauth/kakao/callback',
  }
  const results = await Promise.allSettled([
    completeOAuthCallback(callback, dependencies),
    completeOAuthCallback(callback, dependencies),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof OAuthFlowError)
  assert.equal(rejected.reason.code, 'invalid_state')
})

test('allows only one concurrent completion-code exchange', async () => {
  let available = true
  const store = {
    async consume(completionHash: string) {
      assert.equal(completionHash, hashOAuthSecret('completion-code'))
      if (!available) return null
      available = false
      return { customToken: 'custom-token', expiresAtMs: 2_000 }
    },
  }
  const results = await Promise.allSettled([
    consumeOAuthCompletion('completion-code', store, 1_000),
    consumeOAuthCompletion('completion-code', store, 1_000),
  ])
  assert.deepEqual(results.filter((result) => result.status === 'fulfilled').map((result) => result.value), ['custom-token'])
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
})

test('preserves the legacy UID and writes only minimal account fields', () => {
  assert.equal(firebaseUid('naver', 'legacy-subject'), 'naver:legacy-subject')
  assert.deepEqual(oauthAccountRecord('naver'), { provider: 'naver', connected: true })
  assert.equal('providerSubject' in oauthAccountRecord('naver'), false)
  assert.equal('displayName' in oauthAccountRecord('naver'), false)
})
