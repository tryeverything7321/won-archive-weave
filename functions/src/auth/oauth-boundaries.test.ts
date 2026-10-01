import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'
import { issueOAuthStartTicket } from './oauth.js'
import {
  normalizeOAuthOrigin,
  nextOAuthStartQuota,
  oauthInstallationQuotaKey,
  oauthNetworkQuotaKey,
  oauthStartQuotaPolicies,
  oauthStartQuotaWindowMs,
  oauthStartTicketMatches,
  oauthStartTicketTtlMs,
  parseAllowedOAuthOrigins,
  requireAllowedOAuthOrigin,
  requireOAuthInstallationId,
} from './oauth-boundaries.js'

test('OAuth origins are exact origins and never accept paths, credentials, or insecure remote hosts', () => {
  assert.equal(normalizeOAuthOrigin('https://won-archive-weave.web.app'), 'https://won-archive-weave.web.app')
  assert.equal(normalizeOAuthOrigin('http://localhost:5173'), 'http://localhost:5173')
  for (const origin of [
    'https://user@example.com',
    'https://example.com/oauth',
    'https://example.com?next=evil',
    'http://example.com',
  ]) {
    assert.throws(() => normalizeOAuthOrigin(origin), /invalid_origin/)
  }
})

test('OAuth installation identifiers are opaque, strict, and stored only through a hash key', () => {
  const installationId = 'abcdefghijklmnopqrstuvwxyzABCDEFG_123456'
  assert.equal(requireOAuthInstallationId(installationId), installationId)
  const key = oauthInstallationQuotaKey(installationId)
  assert.match(key, /^installation_[a-f0-9]{64}$/)
  assert.equal(key.includes(installationId), false)
  for (const invalid of ['', 'short', 'a'.repeat(65), 'a'.repeat(31), 'a'.repeat(31) + '.']) {
    assert.throws(() => requireOAuthInstallationId(invalid), /invalid_installation_id/)
  }
})

test('OAuth network quota trusts only the final platform-appended client and load-balancer pair', () => {
  const ipv4 = oauthNetworkQuotaKey('203.0.113.7, 169.254.1.1')
  assert.match(ipv4.key, /^network_[a-f0-9]{64}$/)
  assert.equal(ipv4.policy, 'network')
  assert.equal(ipv4.key.includes('203.0.113.7'), false)
  assert.equal(oauthNetworkQuotaKey('2001:db8::1, 2001:db8::2').policy, 'network')

  const trustedPair = oauthNetworkQuotaKey('203.0.113.7, 169.254.1.1')
  const validSpoofedPrefix = oauthNetworkQuotaKey('198.51.100.9, 203.0.113.7, 169.254.1.1')
  const anotherSpoofedPrefix = oauthNetworkQuotaKey('192.0.2.4, 203.0.113.7, 169.254.1.1')
  assert.deepEqual(validSpoofedPrefix, trustedPair)
  assert.deepEqual(anotherSpoofedPrefix, trustedPair)

  for (const invalid of [
    '2001:db8::1',
    'spoofed, 203.0.113.7',
    '203.0.113.7, load-balancer',
  ]) assert.deepEqual(oauthNetworkQuotaKey(invalid), {
    key: 'network_unknown',
    policy: 'unknownNetwork',
  })
  assert.deepEqual(oauthNetworkQuotaKey(undefined), {
    key: 'network_unknown',
    policy: 'unknownNetwork',
  })
  assert.ok(oauthStartQuotaPolicies.unknownNetwork < oauthStartQuotaPolicies.network)
})

test('OAuth layered quota resets by window and rejects beyond each policy ceiling', () => {
  const first = nextOAuthStartQuota(undefined, oauthStartQuotaPolicies.installation, 1_000)
  assert.deepEqual(first.record, { windowStartedAtMs: 1_000, count: 1 })
  const atLimit = {
    windowStartedAtMs: 1_000,
    count: oauthStartQuotaPolicies.installation,
  }
  assert.deepEqual(nextOAuthStartQuota(atLimit, oauthStartQuotaPolicies.installation, 2_000), {
    allowed: false,
    record: atLimit,
    retryAfterMs: oauthStartQuotaWindowMs - 1_000,
  })
  assert.deepEqual(
    nextOAuthStartQuota(atLimit, oauthStartQuotaPolicies.installation, 1_000 + oauthStartQuotaWindowMs),
    {
      allowed: true,
      record: { windowStartedAtMs: 1_000 + oauthStartQuotaWindowMs, count: 1 },
      retryAfterMs: 0,
    },
  )
})

test('OAuth allowlist uses exact normalized matches', () => {
  const configured = 'https://won-archive-weave.web.app, https://won-archive-weave.firebaseapp.com'
  assert.deepEqual([...parseAllowedOAuthOrigins(configured)], [
    'https://won-archive-weave.web.app',
    'https://won-archive-weave.firebaseapp.com',
  ])
  assert.equal(requireAllowedOAuthOrigin('https://won-archive-weave.web.app', configured), 'https://won-archive-weave.web.app')
  assert.throws(() => requireAllowedOAuthOrigin('https://evil.example', configured), /origin_not_allowed/)
  assert.throws(() => parseAllowedOAuthOrigins(' , '), /allowlist is empty/)
})

test('OAuth start tickets are short-lived and bound to provider and exact origin', () => {
  assert.equal(oauthStartTicketTtlMs, 120_000)
  const ticket = {
    provider: 'naver',
    redirectOrigin: 'https://won-archive-weave.web.app',
    expiresAtMs: 121_000,
  }
  assert.equal(oauthStartTicketMatches(ticket, {
    provider: 'naver',
    redirectOrigin: 'https://won-archive-weave.web.app',
    nowMs: 1_000,
  }), true)
  assert.equal(oauthStartTicketMatches(ticket, {
    provider: 'kakao',
    redirectOrigin: 'https://won-archive-weave.web.app',
    nowMs: 1_000,
  }), false)
  assert.equal(oauthStartTicketMatches(ticket, {
    provider: 'naver',
    redirectOrigin: 'https://won-archive-weave.firebaseapp.com',
    nowMs: 1_000,
  }), false)
  assert.equal(oauthStartTicketMatches(ticket, {
    provider: 'naver',
    redirectOrigin: 'https://won-archive-weave.web.app',
    nowMs: 121_000,
  }), false)
})

test('20 to 50 visitors on one shared network keep distinct installation quotas without loosening abuse limits', () => {
  for (const visitors of [20, 50]) {
    let networkQuota: { windowStartedAtMs: number; count: number } | undefined
    const installationQuotas = new Map<string, { windowStartedAtMs: number; count: number }>()
    for (let index = 0; index < visitors; index += 1) {
      const installation = `visitor_${String(index).padStart(3, '0')}_${'x'.repeat(32)}`
      const installationKey = oauthInstallationQuotaKey(installation)
      const perInstallation = nextOAuthStartQuota(
        installationQuotas.get(installationKey), oauthStartQuotaPolicies.installation, 10_000,
      )
      const sharedNetwork = nextOAuthStartQuota(networkQuota, oauthStartQuotaPolicies.network, 10_000)
      assert.equal(perInstallation.allowed, true)
      assert.equal(sharedNetwork.allowed, true)
      installationQuotas.set(installationKey, perInstallation.record)
      networkQuota = sharedNetwork.record
    }
    assert.equal(networkQuota?.count, visitors)
    assert.equal(installationQuotas.size, visitors)
  }

  let abusiveInstallation: { windowStartedAtMs: number; count: number } | undefined
  for (let attempt = 0; attempt < oauthStartQuotaPolicies.installation; attempt += 1) {
    const decision = nextOAuthStartQuota(abusiveInstallation, oauthStartQuotaPolicies.installation, 20_000)
    assert.equal(decision.allowed, true)
    abusiveInstallation = decision.record
  }
  assert.equal(
    nextOAuthStartQuota(abusiveInstallation, oauthStartQuotaPolicies.installation, 20_001).allowed,
    false,
  )
})

test('50 shared-network OAuth starts in explicit concurrency-5 waves remain atomic in Firestore', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async (context) => {
  const networkAddress = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
  const rawRequest = {
    get(name: string) {
      if (name.toLowerCase() === 'origin') return 'https://won-archive-weave.web.app'
      if (name.toLowerCase() === 'x-forwarded-for') return `${networkAddress}, 169.254.1.1`
      return undefined
    },
  }
  const prefix = randomUUID().replaceAll('-', '').slice(0, 12)
  const installations = Array.from({ length: 50 }, (_, index) =>
    `${prefix}_${String(index).padStart(3, '0')}_${'x'.repeat(32)}`)
  const results = []
  const durations: number[] = []
  for (let offset = 0; offset < installations.length; offset += 5) {
    results.push(...await Promise.all(installations.slice(offset, offset + 5).map((installationId) =>
      (async () => {
        const startedAt = performance.now()
        const result = await issueOAuthStartTicket.run({
          data: { provider: 'kakao', installationId }, rawRequest, app: { token: {} },
        } as never)
        durations.push(performance.now() - startedAt)
        return result
      })())))
  }
  assert.equal(new Set(results.map((result) => result.ticket)).size, 50)
  const networkKey = oauthNetworkQuotaKey(`${networkAddress}, 169.254.1.1`).key
  assert.equal((await getFirestore().collection('oauthStartQuotas').doc(networkKey).get()).get('count'), 50)
  const sorted = [...durations].sort((left, right) => left - right)
  context.diagnostic(JSON.stringify({
    visitors: 50,
    concurrency: 5,
    errors: 0,
    p50Ms: Math.round(sorted[Math.floor(sorted.length * 0.5)] ?? 0),
    p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    maxMs: Math.round(sorted.at(-1) ?? 0),
  }))

  for (let attempt = 1; attempt < oauthStartQuotaPolicies.installation; attempt += 1) {
    await issueOAuthStartTicket.run({
      data: { provider: 'kakao', installationId: installations[0] }, rawRequest, app: { token: {} },
    } as never)
  }
  await assert.rejects(
    issueOAuthStartTicket.run({
      data: { provider: 'kakao', installationId: installations[0] }, rawRequest, app: { token: {} },
    } as never),
    (error: { code?: string }) => error.code === 'resource-exhausted',
  )
})
