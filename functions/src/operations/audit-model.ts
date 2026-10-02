import { HttpsError } from 'firebase-functions/v2/https'

export const OPERATOR_AUDIT_PAGE_SIZE = 30
export const OPERATOR_AUDIT_PAGE_SIZE_MAX = 50

export type OperatorAuditCursor = {
  seconds: number
  nanoseconds: number
  id: string
}

export type OperatorAuditEvent = {
  id: string
  type: string
  category: 'community' | 'submission' | 'calendar' | 'account' | 'members'
  label: string
  occurredAtMs: number
  targetType: 'community' | 'submission' | 'calendar_event' | 'member' | null
  targetId: string | null
  action: string | null
  result: string | null
}

const minimumFirestoreTimestampSeconds = -62_135_596_800
const maximumFirestoreTimestampSeconds = 253_402_300_799

const allowedAuditTypes = new Map<string, { category: OperatorAuditEvent['category']; label: string }>([
  ['archive_resource.edited', { category: 'submission', label: '자료 수정' }],
  ['archive_resource.withdrawn', { category: 'submission', label: '자료 삭제' }],
  ['qc_resource.withdrawn', { category: 'submission', label: 'QC 테스트 자료 정리' }],
  ['community.report_resolved', { category: 'community', label: '신고 처리' }],
  ['community.appeal_resolved', { category: 'community', label: '이의 제기 처리' }],
  ['community.post_moderated', { category: 'community', label: '커뮤니티 글 운영 조치' }],
  ['community.warn', { category: 'community', label: '커뮤니티 글 안내' }],
  ['community.request_correction', { category: 'community', label: '커뮤니티 글 수정 요청' }],
  ['community.hold', { category: 'community', label: '커뮤니티 글 숨김' }],
  ['community.remove', { category: 'community', label: '커뮤니티 글 공개 중단' }],
  ['community.restore', { category: 'community', label: '커뮤니티 글 공개 복구' }],
  ['community.comment_warn', { category: 'community', label: '댓글 안내' }],
  ['community.comment_request_correction', { category: 'community', label: '댓글 수정 요청' }],
  ['community.comment_hold', { category: 'community', label: '댓글 숨김' }],
  ['community.comment_remove', { category: 'community', label: '댓글 공개 중단' }],
  ['community.comment_restore', { category: 'community', label: '댓글 공개 복구' }],
  ['submission.operator_exception_action', { category: 'submission', label: '자료 예외 처리' }],
  ['submission.publish_failed', { category: 'submission', label: '자료 공개 실패' }],
  ['submission.attachment_publish_failed', { category: 'submission', label: '첨부 파일 공개 실패' }],
  ['submission.automated_scan_failed', { category: 'submission', label: '파일 자동 검사 실패' }],
  ['submission.pre_submit_scan_failed', { category: 'submission', label: '제출 전 파일 검사 실패' }],
  ['submission.automated_scan_recorded', { category: 'submission', label: '파일 자동 검사 완료' }],
  ['calendar_event.approved', { category: 'calendar', label: '행사 승인' }],
  ['calendar_event.rejected', { category: 'calendar', label: '행사 반려' }],
  ['calendar_event.publish_failed', { category: 'calendar', label: '행사 공개 실패' }],
  ['calendar_event.media_scan_recorded', { category: 'calendar', label: '행사 이미지 검사 완료' }],
  ['calendar_import.source_changes_applied', { category: 'calendar', label: '외부 일정 변경 반영' }],
  ['calendar_import.source_disposition_applied', { category: 'calendar', label: '외부 일정 처리' }],
  ['calendar_source.disconnected', { category: 'calendar', label: '외부 일정 연결 해제' }],
  ['members.list_viewed', { category: 'members', label: '회원 현황 조회' }],
  ['members.overview_viewed', { category: 'members', label: '회원 상세 조회' }],
  ['members.activity_viewed', { category: 'members', label: '회원 활동 조회' }],
  ['members.private_viewed', { category: 'members', label: '제한 회원 정보 조회' }],
])

const allowedActions = new Set([
  'warn', 'request_correction', 'hold', 'remove', 'restore',
  'dismiss', 'accept', 'reject', 'retry_cleanup', 'retry_publication',
])

const allowedResults = new Set([
  'active', 'held', 'removed', 'resolved', 'dismissed', 'accepted', 'rejected',
  'published', 'publishing_failed', 'clean', 'blocked', 'error',
])

export function operatorAuditPageSize(value: unknown): number {
  if (value === undefined || value === null || value === '') return OPERATOR_AUDIT_PAGE_SIZE
  const pageSize = Number(value)
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > OPERATOR_AUDIT_PAGE_SIZE_MAX) {
    throw new HttpsError('invalid-argument', `운영 이력은 한 번에 ${OPERATOR_AUDIT_PAGE_SIZE_MAX}개까지 확인할 수 있어요`)
  }
  return pageSize
}

export function encodeOperatorAuditCursor(cursor: OperatorAuditCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeOperatorAuditCursor(value: unknown): OperatorAuditCursor | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 500) throw new HttpsError('invalid-argument', '다음 운영 이력 위치를 확인하지 못했어요')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (
      !Number.isSafeInteger(parsed.seconds)
      || Number(parsed.seconds) < minimumFirestoreTimestampSeconds
      || Number(parsed.seconds) > maximumFirestoreTimestampSeconds
      || !Number.isSafeInteger(parsed.nanoseconds)
      || Number(parsed.nanoseconds) < 0
      || Number(parsed.nanoseconds) > 999_999_999
      || typeof parsed.id !== 'string'
      || !parsed.id
      || parsed.id.length > 180
      || parsed.id.includes('/')
    ) throw new Error('invalid')
    return { seconds: Number(parsed.seconds), nanoseconds: Number(parsed.nanoseconds), id: parsed.id }
  } catch {
    throw new HttpsError('invalid-argument', '다음 운영 이력 위치를 확인하지 못했어요')
  }
}

function boundedId(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 180 || value.includes('/')) return null
  return value
}

export function projectOperatorAuditEvent(
  id: string,
  data: Record<string, unknown>,
  occurredAtMs: number,
): OperatorAuditEvent | null {
  const type = typeof data.type === 'string' ? data.type : ''
  const allowed = allowedAuditTypes.get(type)
  if (!allowed) return null

  let targetType: OperatorAuditEvent['targetType'] = null
  let targetId: string | null = null
  if (allowed.category === 'community') {
    targetType = 'community'
    targetId = boundedId(data.caseId) ?? boundedId(data.postId) ?? boundedId(data.commentId)
  } else if (allowed.category === 'submission') {
    targetType = 'submission'
    targetId = boundedId(data.submissionId) ?? boundedId(data.exceptionId) ?? boundedId(data.targetId)
  } else if (allowed.category === 'calendar') {
    targetType = 'calendar_event'
    targetId = boundedId(data.eventId) ?? boundedId(data.sourceId)
  } else if (allowed.category === 'members') {
    targetType = 'member'
  }

  const action = typeof data.action === 'string' && allowedActions.has(data.action) ? data.action : null
  const resultValue = data.nextStatus ?? data.status ?? data.verdict
  const result = typeof resultValue === 'string' && allowedResults.has(resultValue) ? resultValue : null
  return {
    id,
    type,
    category: allowed.category,
    label: allowed.label,
    occurredAtMs,
    targetType,
    targetId,
    action,
    result,
  }
}
