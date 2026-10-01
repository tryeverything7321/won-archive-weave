export type CommunityStatus = 'active' | 'held' | 'removed' | 'deleted'
export type ModeratedStatus = Exclude<CommunityStatus, 'deleted'>
export type ReportCategory = 'personal_data' | 'harassment' | 'crisis' | 'rights' | 'spam' | 'other'
export type ModerationAction = 'hold' | 'remove' | 'restore'
export type CommunityModerationAction = ModerationAction | 'warn' | 'request_correction'

export class CommunityPolicyError extends Error {
  constructor(public readonly code: 'not_author' | 'not_editable' | 'invalid_transition' | 'self_moderation' | 'appeal_not_allowed' | 'notice_required') {
    super(code)
  }
}

export function isUrgentReport(category: ReportCategory): boolean {
  return category === 'personal_data' || category === 'crisis'
}

export function editContent(input: { authorUid: string; actorUid: string; status: CommunityStatus; administrator?: boolean }, body: string): { body: string; status: CommunityStatus } {
  if (input.authorUid !== input.actorUid && !input.administrator) throw new CommunityPolicyError('not_author')
  if (input.status === 'deleted' || (!input.administrator && input.status !== 'active')) throw new CommunityPolicyError('not_editable')
  const normalized = body.trim()
  if (normalized.length < 2) throw new CommunityPolicyError('not_editable')
  return { body: normalized, status: input.status }
}

export function deleteContent(input: { authorUid: string; actorUid: string; status: CommunityStatus; administrator?: boolean }): CommunityStatus {
  if (input.authorUid !== input.actorUid && !input.administrator) throw new CommunityPolicyError('not_author')
  if (input.status === 'deleted' || (!input.administrator && input.status === 'removed')) throw new CommunityPolicyError('not_editable')
  return 'deleted'
}

export function moderateContent(input: {
  status: CommunityStatus
  action: ModerationAction
  authorUid: string
  moderatorUid: string
  administrator?: boolean
}): ModeratedStatus {
  if (input.authorUid === input.moderatorUid && !input.administrator) throw new CommunityPolicyError('self_moderation')
  const transitions: Record<ModerationAction, ModeratedStatus> = { hold: 'held', remove: 'removed', restore: 'active' }
  const next = transitions[input.action]
  const allowed = (
    (input.action === 'hold' && input.status === 'active')
    || (input.action === 'remove' && (input.status === 'active' || input.status === 'held'))
    || (input.action === 'restore' && (input.status === 'held' || input.status === 'removed'))
  )
  if (!allowed) throw new CommunityPolicyError('invalid_transition')
  return next
}

export function planCommunityModeration(input: {
  status: CommunityStatus
  action: CommunityModerationAction
  authorUid: string
  moderatorUid: string
  administrator?: boolean
  hasPriorGuidance: boolean
}): {
  status: ModeratedStatus
  changesVisibility: boolean
  consumesGuidance: boolean
} {
  if (input.authorUid === input.moderatorUid && !input.administrator) {
    throw new CommunityPolicyError('self_moderation')
  }
  if (input.action === 'warn' || input.action === 'request_correction') {
    if (input.status !== 'active' && input.status !== 'held') throw new CommunityPolicyError('invalid_transition')
    return { status: input.status, changesVisibility: false, consumesGuidance: false }
  }
  if (input.action === 'remove' && !input.hasPriorGuidance) {
    throw new CommunityPolicyError('notice_required')
  }
  const status = moderateContent({
    status: input.status,
    action: input.action as ModerationAction,
    authorUid: input.authorUid,
    moderatorUid: input.moderatorUid,
    administrator: input.administrator,
  })
  return {
    status,
    changesVisibility: true,
    consumesGuidance: input.action === 'remove' || input.action === 'restore',
  }
}

export function createAppeal(input: { authorUid: string; actorUid: string; status: CommunityStatus; reason: string }) {
  if (input.authorUid !== input.actorUid) throw new CommunityPolicyError('not_author')
  if (input.status !== 'held' && input.status !== 'removed') throw new CommunityPolicyError('appeal_not_allowed')
  const reason = input.reason.trim()
  if (reason.length < 10 || reason.length > 1000) throw new CommunityPolicyError('appeal_not_allowed')
  return { status: 'received' as const, reason }
}

export function publicCommunityRecord<T extends { authorUid?: string; moderatorUid?: string; reporterUid?: string }>(record: T): Omit<T, 'authorUid' | 'moderatorUid' | 'reporterUid'> {
  const safe = { ...record } as T & Record<string, unknown>
  delete safe.authorUid
  delete safe.moderatorUid
  delete safe.reporterUid
  return safe
}
