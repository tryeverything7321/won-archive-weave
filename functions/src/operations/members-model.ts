export type MemberProvider = 'naver' | 'kakao' | 'google' | 'unknown'
export type MembershipCompletion = 'complete' | 'incomplete' | 'unknown'
export type ActivityKind = 'post' | 'comment' | 'submission' | 'event'
export type TimelineKind = 'account' | ActivityKind

export type MemberReadClaims = Record<string, unknown> | undefined

export type AccountRecord = {
  pseudonym?: unknown
  provider?: unknown
  requiredProfileVersion?: unknown
  connected?: unknown
  termsVersion?: unknown
  communityRulesVersion?: unknown
}

export type MembershipSteps = {
  requiredProfile: boolean | null
  connected: boolean | null
  currentTerms: boolean | null
  currentCommunityRules: boolean | null
  pseudonymSet: boolean | null
}

export type MemberActivityCounts = Record<ActivityKind, number | null>

export type MemberActivityItem = {
  id: string
  kind: TimelineKind
  occurredAtMs: number
  title: string
  status: string
  href: string | null
}

export type ActivitySourcePosition = { occurredAtMs: number; id: string } | null
export type ActivityCursorState = Record<TimelineKind, ActivitySourcePosition>

const timelineKinds: TimelineKind[] = ['account', 'post', 'comment', 'submission', 'event']

export function memberAccessAllowed(claims: MemberReadClaims, privateRead = false): boolean {
  return claims?.role === 'administrator'
    && claims.memberRead === true
    && (!privateRead || claims.memberPrivateRead === true)
}

export function normalizeMemberProvider(value: unknown): MemberProvider {
  return value === 'naver' || value === 'kakao' || value === 'google' ? value : 'unknown'
}

export function membershipProjection(
  account: AccountRecord | undefined,
  currentTermsVersion: string,
  currentCommunityRulesVersion: string,
): { pseudonym: string | null; provider: MemberProvider; completion: MembershipCompletion; steps: MembershipSteps } {
  const exists = account !== undefined
  const pseudonym = typeof account?.pseudonym === 'string' && account.pseudonym.trim()
    ? account.pseudonym.trim().slice(0, 40)
    : null
  const steps: MembershipSteps = {
    requiredProfile: exists ? account?.requiredProfileVersion === "2026-10-01" : null,
    connected: typeof account?.connected === 'boolean' ? account.connected : null,
    currentTerms: typeof account?.termsVersion === 'string'
      ? account.termsVersion === currentTermsVersion
      : null,
    currentCommunityRules: typeof account?.communityRulesVersion === 'string'
      ? account.communityRulesVersion === currentCommunityRulesVersion
      : null,
    pseudonymSet: exists ? pseudonym !== null : null,
  }
  const values = Object.values(steps)
  const completion: MembershipCompletion = values.every((value) => value === true)
    ? 'complete'
    : values.some((value) => value === false)
      ? 'incomplete'
      : 'unknown'
  return {
    pseudonym,
    provider: normalizeMemberProvider(account?.provider),
    completion,
    steps,
  }
}

export function kstDayRange(nowMs: number): { startMs: number; endMs: number } {
  const offsetMs = 9 * 60 * 60 * 1000
  const shifted = new Date(nowMs + offsetMs)
  const startMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ) - offsetMs
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 }
}

export function exactActivityCounts(
  counts: Partial<Record<ActivityKind, number | undefined>>,
): MemberActivityCounts {
  return {
    post: Number.isSafeInteger(counts.post) ? counts.post! : null,
    comment: Number.isSafeInteger(counts.comment) ? counts.comment! : null,
    submission: Number.isSafeInteger(counts.submission) ? counts.submission! : null,
    event: Number.isSafeInteger(counts.event) ? counts.event! : null,
  }
}

export function totalRecordedActivity(counts: MemberActivityCounts): number | null {
  const values = Object.values(counts)
  return values.every((value): value is number => typeof value === 'number')
    ? values.reduce((sum, value) => sum + value, 0)
    : null
}

export function summarizeMemberPopulation(
  members: Array<{
    createdAtMs: number | null
    completion: MembershipCompletion
    counts: MemberActivityCounts
    periodCounts: MemberActivityCounts
    complete: boolean
  }>,
  nowMs: number,
) {
  const complete = members.every((member) => member.complete)
  const today = kstDayRange(nowMs)
  return {
    populationCount: members.length,
    createdToday: members.filter(({ createdAtMs }) => createdAtMs !== null
      && createdAtMs >= today.startMs && createdAtMs < today.endMs).length,
    completed: members.filter(({ completion }) => completion === 'complete').length,
    membersWithRecordedActivity: complete
      ? members.filter(({ counts }) => (totalRecordedActivity(counts) ?? 0) > 0).length
      : null,
    activityCounts: complete
      ? members.reduce((totals, member) => ({
          post: totals.post + (member.periodCounts.post ?? 0),
          comment: totals.comment + (member.periodCounts.comment ?? 0),
          submission: totals.submission + (member.periodCounts.submission ?? 0),
          event: totals.event + (member.periodCounts.event ?? 0),
        }), { post: 0, comment: 0, submission: 0, event: 0 })
      : null,
    complete,
  }
}

export function compareActivity(left: MemberActivityItem, right: MemberActivityItem): number {
  return right.occurredAtMs - left.occurredAtMs
    || left.kind.localeCompare(right.kind)
    || right.id.localeCompare(left.id)
}

export function emptyActivityCursor(): ActivityCursorState {
  return { account: null, post: null, comment: null, submission: null, event: null }
}

export function mergeActivityPage(
  sources: Record<TimelineKind, MemberActivityItem[]>,
  previous: ActivityCursorState,
  limit: number,
): { items: MemberActivityItem[]; positions: ActivityCursorState; hasMore: boolean } {
  const merged = timelineKinds.flatMap((kind) => sources[kind]).sort(compareActivity)
  const items = merged.slice(0, limit)
  const positions: ActivityCursorState = { ...previous }
  for (const item of items) {
    positions[item.kind] = { occurredAtMs: item.occurredAtMs, id: item.id }
  }
  return { items, positions, hasMore: merged.length > limit }
}

export function activityPositionAfter(
  item: Pick<MemberActivityItem, 'occurredAtMs' | 'id'>,
  position: ActivitySourcePosition,
): boolean {
  if (!position) return true
  return item.occurredAtMs < position.occurredAtMs
    || (item.occurredAtMs === position.occurredAtMs && item.id < position.id)
}

export function safeReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const result = value.trim()
  return result.length >= 2 && result.length <= 200 ? result : null
}
