import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

export const oauthStartTicketTtlMs = 2 * 60 * 1_000
export const oauthStartQuotaWindowMs = 10 * 60 * 1_000
export const oauthStartQuotaPolicies = {
  installation: 8,
  network: 500,
  unknownNetwork: 100,
} as const

export type OAuthStartQuotaRecord = {
  windowStartedAtMs: number
  count: number
}

export function normalizeOAuthOrigin(value: string): string {
  const url = new URL(value)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid_origin')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) {
    throw new Error('invalid_origin')
  }
  return url.origin
}

export function parseAllowedOAuthOrigins(value: string): Set<string> {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOAuthOrigin)
  if (!origins.length) throw new Error('OAuth origin allowlist is empty')
  return new Set(origins)
}

export function requireAllowedOAuthOrigin(origin: string, configuredOrigins: string): string {
  const normalized = normalizeOAuthOrigin(origin)
  if (!parseAllowedOAuthOrigins(configuredOrigins).has(normalized)) throw new Error('origin_not_allowed')
  return normalized
}

export function oauthStartTicketMatches(
  ticket: { provider?: unknown; redirectOrigin?: unknown; expiresAtMs?: unknown } | undefined,
  expected: { provider: string; redirectOrigin: string; nowMs: number },
): boolean {
  return Boolean(
    ticket
    && (ticket.provider === 'naver' || ticket.provider === 'kakao')
    && ticket.provider === expected.provider
    && ticket.redirectOrigin === expected.redirectOrigin
    && Number.isSafeInteger(ticket.expiresAtMs)
    && Number(ticket.expiresAtMs) > expected.nowMs,
  )
}

export function requireOAuthInstallationId(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 32
    || value.length > 64
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) throw new Error('invalid_installation_id')
  return value
}

function quotaHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function oauthInstallationQuotaKey(installationId: string): string {
  return `installation_${quotaHash(requireOAuthInstallationId(installationId))}`
}

export function oauthNetworkQuotaKey(xForwardedFor: unknown): {
  key: string
  policy: 'network' | 'unknownNetwork'
} {
  if (typeof xForwardedFor !== 'string') return { key: 'network_unknown', policy: 'unknownNetwork' }
  const addresses = xForwardedFor
    .split(',')
    .map((address) => address.trim().toLowerCase())

  // Google External Application Load Balancers preserve any caller-supplied
  // prefix and append "<client-ip>,<load-balancer-ip>" to the right. Only that
  // final pair is trusted here; the first value is attacker-controlled.
  if (addresses.length < 2) return { key: 'network_unknown', policy: 'unknownNetwork' }
  const clientAddress = addresses.at(-2) ?? ''
  const loadBalancerAddress = addresses.at(-1) ?? ''
  if (!isIP(clientAddress) || !isIP(loadBalancerAddress)) {
    return { key: 'network_unknown', policy: 'unknownNetwork' }
  }
  return { key: `network_${quotaHash(clientAddress)}`, policy: 'network' }
}

export function nextOAuthStartQuota(
  current: OAuthStartQuotaRecord | undefined,
  maximum: number,
  nowMs: number,
): { allowed: boolean; record: OAuthStartQuotaRecord; retryAfterMs: number } {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error('invalid_quota_input')
  }
  if (!current || current.windowStartedAtMs + oauthStartQuotaWindowMs <= nowMs) {
    return {
      allowed: true,
      record: { windowStartedAtMs: nowMs, count: 1 },
      retryAfterMs: 0,
    }
  }
  if (
    !Number.isSafeInteger(current.windowStartedAtMs)
    || !Number.isSafeInteger(current.count)
    || current.windowStartedAtMs <= 0
    || current.count < 0
  ) throw new Error('invalid_quota_record')
  if (current.count >= maximum) {
    return {
      allowed: false,
      record: current,
      retryAfterMs: Math.max(1, current.windowStartedAtMs + oauthStartQuotaWindowMs - nowMs),
    }
  }
  return {
    allowed: true,
    record: { windowStartedAtMs: current.windowStartedAtMs, count: current.count + 1 },
    retryAfterMs: 0,
  }
}
