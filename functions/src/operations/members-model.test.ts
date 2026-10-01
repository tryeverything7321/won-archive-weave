import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activityPositionAfter,
  emptyActivityCursor,
  exactActivityCounts,
  kstDayRange,
  memberAccessAllowed,
  membershipProjection,
  mergeActivityPage,
  safeReason,
  summarizeMemberPopulation,
  totalRecordedActivity,
  type MemberActivityItem,
} from './members-model.js'

test('member reads require the administrator role and the dedicated claim', () => {
  assert.equal(memberAccessAllowed({ role: 'administrator', memberRead: true }), true)
  assert.equal(memberAccessAllowed({ role: 'moderator', memberRead: true }), false)
  assert.equal(memberAccessAllowed({ role: 'administrator' }), false)
  assert.equal(memberAccessAllowed({ role: 'administrator', memberRead: true }, true), false)
  assert.equal(memberAccessAllowed({ role: 'administrator', memberRead: true, memberPrivateRead: true }, true), true)
})

test('membership projection preserves missing values instead of turning them into completed or zero', () => {
  assert.deepEqual(membershipProjection(undefined, '2026-09', '2026-09'), {
    pseudonym: null,
    provider: 'unknown',
    completion: 'unknown',
    steps: { requiredProfile: null, connected: null, currentTerms: null, currentCommunityRules: null, pseudonymSet: null },
  })
  assert.equal(membershipProjection({ connected: false }, '2026-09', '2026-09').completion, 'incomplete')
  assert.equal(membershipProjection({
    pseudonym: ' 물결 ', provider: 'kakao', connected: true,
    termsVersion: '2026-09', communityRulesVersion: '2026-09', requiredProfileVersion: '2026-10-01',
  }, '2026-09', '2026-09').completion, 'complete')
})

test('KST day range starts at midnight in Korea', () => {
  const now = Date.parse('2026-10-01T12:30:00+09:00')
  const range = kstDayRange(now)
  assert.equal(new Date(range.startMs).toISOString(), '2026-09-30T15:00:00.000Z')
  assert.equal(new Date(range.endMs).toISOString(), '2026-10-01T15:00:00.000Z')
})

test('unknown counts stay unknown while exact zero remains zero', () => {
  const partial = exactActivityCounts({ post: 0, comment: 2 })
  assert.deepEqual(partial, { post: 0, comment: 2, submission: null, event: null })
  assert.equal(totalRecordedActivity(partial), null)
  assert.equal(totalRecordedActivity(exactActivityCounts({ post: 0, comment: 0, submission: 0, event: 0 })), 0)
})

test('summary uses the full filtered population and period counts, not the visible page length', () => {
  const zero = exactActivityCounts({ post: 0, comment: 0, submission: 0, event: 0 })
  const onePost = exactActivityCounts({ post: 1, comment: 0, submission: 0, event: 0 })
  const summary = summarizeMemberPopulation([
    { createdAtMs: Date.parse('2026-10-01T01:00:00+09:00'), completion: 'complete', counts: onePost, periodCounts: onePost, complete: true },
    { createdAtMs: Date.parse('2026-09-01T01:00:00+09:00'), completion: 'incomplete', counts: zero, periodCounts: zero, complete: true },
    { createdAtMs: null, completion: 'unknown', counts: zero, periodCounts: zero, complete: true },
  ], Date.parse('2026-10-01T12:00:00+09:00'))
  assert.deepEqual(summary, {
    populationCount: 3,
    createdToday: 1,
    completed: 1,
    membersWithRecordedActivity: 1,
    activityCounts: { post: 1, comment: 0, submission: 0, event: 0 },
    complete: true,
  })
})

test('summary does not publish partial activity totals as exact', () => {
  const unknown = exactActivityCounts({ post: 1 })
  const summary = summarizeMemberPopulation([
    { createdAtMs: null, completion: 'unknown', counts: unknown, periodCounts: unknown, complete: false },
  ], Date.parse('2026-10-01T12:00:00+09:00'))
  assert.equal(summary.populationCount, 1)
  assert.equal(summary.membersWithRecordedActivity, null)
  assert.equal(summary.activityCounts, null)
  assert.equal(summary.complete, false)
})

test('activity paging is deterministic at identical timestamps and advances each source independently', () => {
  const item = (id: string, kind: MemberActivityItem['kind'], occurredAtMs: number): MemberActivityItem => ({
    id, kind, occurredAtMs, title: id, status: 'active', href: null,
  })
  const previous = emptyActivityCursor()
  const page = mergeActivityPage({
    account: [],
    post: [item('p2', 'post', 10), item('p1', 'post', 10)],
    comment: [item('c1', 'comment', 10)],
    submission: [item('s1', 'submission', 9)],
    event: [],
  }, previous, 3)
  assert.deepEqual(page.items.map(({ kind, id }) => `${kind}:${id}`), ['comment:c1', 'post:p2', 'post:p1'])
  assert.equal(page.hasMore, true)
  assert.deepEqual(page.positions.comment, { occurredAtMs: 10, id: 'c1' })
  assert.deepEqual(page.positions.post, { occurredAtMs: 10, id: 'p1' })
  assert.equal(activityPositionAfter(item('p2', 'post', 10), page.positions.post), false)
  assert.equal(activityPositionAfter(item('p0', 'post', 10), page.positions.post), true)
})

test('audit reasons are required and bounded', () => {
  assert.equal(safeReason(' 회원 문의 확인 '), '회원 문의 확인')
  assert.equal(safeReason(' '), null)
  assert.equal(safeReason('x'.repeat(201)), null)
})
