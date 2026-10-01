import { createHash } from 'node:crypto'
import { HttpsError } from 'firebase-functions/v2/https'

export type CommunityWriteKind = 'post' | 'comment'

export const communityWriteMinimumIntervalMs: Record<CommunityWriteKind, number> = {
  post: 10_000,
  comment: 3_000,
}

export function validateCommunityWriteRequestId(value: unknown): string {
  const requestId = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestId)) {
    throw new HttpsError('invalid-argument', '요청 식별자를 확인해 주세요')
  }
  return requestId
}

export function communityWriteFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function communityWriteRequestKey(uid: string, kind: CommunityWriteKind, requestId: string): string {
  return createHash('sha256').update(`community-write:${uid}:${kind}:${requestId}`).digest('hex').slice(0, 40)
}

export function communityWriteThrottle(input: {
  kind: CommunityWriteKind
  previousAtMs: unknown
  nowMs: number
}): { allowed: true; nextAllowedAtMs: number } | { allowed: false; retryAfterSeconds: number } {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) throw new Error('invalid_community_write_time')
  const minimum = communityWriteMinimumIntervalMs[input.kind]
  const previous = Number.isSafeInteger(input.previousAtMs) ? Number(input.previousAtMs) : 0
  const nextAllowedAtMs = previous + minimum
  if (previous > 0 && nextAllowedAtMs > input.nowMs) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((nextAllowedAtMs - input.nowMs) / 1_000)) }
  }
  return { allowed: true, nextAllowedAtMs: input.nowMs + minimum }
}
