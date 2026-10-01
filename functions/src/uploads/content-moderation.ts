import { createHash } from 'node:crypto'
import { HttpsError } from 'firebase-functions/v2/https'

export const reasonedContentModerationActions = ['warn', 'request_correction', 'hold', 'remove', 'restore'] as const
export type ReasonedContentModerationAction = typeof reasonedContentModerationActions[number]
export type OperatorVisibilityAction = 'hold' | 'remove'

export function validateReasonedContentModeration(value: unknown): {
  action: ReasonedContentModerationAction
  reason: string
  requestId: string
} {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const action = data.action
  const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
  const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : ''
  if (!reasonedContentModerationActions.includes(action as ReasonedContentModerationAction)) {
    throw new HttpsError('invalid-argument', '운영 조치를 확인해 주세요')
  }
  if (reason.length < 2 || reason.length > 300) {
    throw new HttpsError('invalid-argument', '처리 사유를 2자 이상 300자 이하로 입력해 주세요')
  }
  if (requestId.length < 8 || requestId.length > 120 || !/^[A-Za-z0-9_-]+$/.test(requestId)) {
    throw new HttpsError('invalid-argument', '요청 식별자를 확인해 주세요')
  }
  return { action: action as ReasonedContentModerationAction, reason, requestId }
}

export function operatorModerationCommandKey(operatorUid: string, requestId: string): string {
  return createHash('sha256').update(`${operatorUid}:${requestId}`).digest('hex').slice(0, 40)
}

export function operatorModerationBlocksPublication(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const action = (value as Record<string, unknown>).action
  return action === 'hold' || action === 'remove'
}

export function preservedPublishedVisibility(
  marker: unknown,
  ...candidates: unknown[]
): 'public' | 'member_only' | null {
  const previous = marker && typeof marker === 'object'
    ? (marker as Record<string, unknown>).previousActivityVisibility
    : undefined
  if (previous === 'public' || previous === 'member_only') return previous
  for (const candidate of candidates) {
    if (candidate === 'public' || candidate === 'member_only') return candidate
  }
  return null
}

export function projectOperatorModerationNotice(value: unknown): {
  action: ReasonedContentModerationAction
  reason: string
  createdAtMs: number
} | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (!reasonedContentModerationActions.includes(record.action as ReasonedContentModerationAction)) return undefined
  const reason = typeof record.reason === 'string' ? record.reason.slice(0, 300) : ''
  const createdAtMs = record.createdAt && typeof record.createdAt === 'object'
    && 'toMillis' in record.createdAt && typeof record.createdAt.toMillis === 'function'
    ? Number(record.createdAt.toMillis())
    : 0
  return { action: record.action as ReasonedContentModerationAction, reason, createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0 }
}
