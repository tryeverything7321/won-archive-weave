import assert from 'node:assert/strict'
import test from 'node:test'
import {
  communityReportKey,
  communityReportRecord,
  communityQueuePage,
  decodeCommunityQueueCursor,
  encodeCommunityQueueCursor,
  communityCaseResolutionPlan,
  communityAppealKey,
  communityAppealOwnerRecord,
  communityBlockKey,
  communityOwnershipResponse,
  communityModerationCommandKey,
  communityModerationNoticeOwnerRecord,
  canDirectlyDeleteCommunityContent,
  blockedCommunityRecordIds,
  ownedCommunityRecordIds,
  validateCommunityOperatorQueue,
  validateCommunityQueueStatus,
  validateCommunityPostEditInput,
  validateCommunityPurpose,
  validateCommunityTopic,
  validateReportQuota,
  validateReportableCommunityStatus,
  validateCommunityModerationRequest,
  requireCommunityModerator,
} from './posts.js'

test('urgent report categories stay explicit', () => {
  const urgent = new Set(['personal_data', 'crisis'])
  assert.equal(urgent.has('personal_data'), true)
  assert.equal(urgent.has('harassment'), false)
})

test('community topics use the approved subject allowlist', () => {
  assert.equal(validateCommunityTopic('관계와 공동체'), '관계와 공동체')
  assert.equal(validateCommunityTopic(undefined), null)
  assert.equal(validateCommunityTopic(null), null)
  assert.equal(validateCommunityTopic(''), null)
  assert.throws(() => validateCommunityTopic('행사와 기획'), /주제/)
})

test('community purposes use the approved participation allowlist', () => {
  assert.equal(validateCommunityPurpose('생각 나눔'), '생각 나눔')
  assert.equal(validateCommunityPurpose('함께할 사람 찾기'), '함께할 사람 찾기')
  assert.throws(() => validateCommunityPurpose('관계와 공동체'), /글의 성격/)
})

test('post edits validate and preserve both purpose and topic', () => {
  assert.deepEqual(validateCommunityPostEditInput({
    body: ' 고친 경험과 노하우 ',
    topic: '일과 진로',
    purpose: '경험과 노하우',
  }), {
    body: '고친 경험과 노하우',
    topic: '일과 진로',
    purpose: '경험과 노하우',
  })
  assert.throws(() => validateCommunityPostEditInput({
    body: '고친 글', topic: '없는 주제', purpose: '생각 나눔',
  }), /주제/)
  assert.throws(() => validateCommunityPostEditInput({
    body: '고친 글', topic: '나와 마음', purpose: '없는 목적',
  }), /글의 성격/)
})

test('post edits allow the auxiliary topic to be omitted or cleared', () => {
  assert.deepEqual(validateCommunityPostEditInput({
    body: '주제 없이 나누는 이야기',
    purpose: '생각 나눔',
  }), {
    body: '주제 없이 나누는 이야기',
    topic: null,
    purpose: '생각 나눔',
  })
  assert.deepEqual(validateCommunityPostEditInput({
    body: '주제를 지운 이야기',
    topic: null,
    purpose: '질문',
  }), {
    body: '주제를 지운 이야기',
    topic: null,
    purpose: '질문',
  })
})

test('report keys make duplicate reports deterministic per member and parent post', () => {
  const first = communityReportKey('member-1', { targetType: 'comment', postId: 'post-1', targetId: 'comment-1' })
  const repeated = communityReportKey('member-1', { targetType: 'comment', postId: 'post-1', targetId: 'comment-1' })
  const anotherPost = communityReportKey('member-1', { targetType: 'comment', postId: 'post-2', targetId: 'comment-1' })
  assert.equal(first, repeated)
  assert.notEqual(first, anotherPost)
})

test('appeals and block relationships use bounded deterministic identifiers', () => {
  assert.equal(communityAppealKey('member-1', 'post-1'), communityAppealKey('member-1', 'post-1'))
  assert.notEqual(communityAppealKey('member-1', 'post-1'), communityAppealKey('member-1', 'post-2'))
  assert.equal(communityBlockKey('member-1', 'member-2'), communityBlockKey('member-1', 'member-2'))
  assert.notEqual(communityBlockKey('member-1', 'member-2'), communityBlockKey('member-2', 'member-1'))
})

test('moderation commands require a bounded action, reason and idempotency key', () => {
  assert.deepEqual(validateCommunityModerationRequest({
    action: 'request_correction',
    reason: ' 개인정보가 포함된 문장을 고쳐 주세요. ',
    requestId: 'moderation_12345678',
  }), {
    action: 'request_correction',
    reason: '개인정보가 포함된 문장을 고쳐 주세요.',
    requestId: 'moderation_12345678',
  })
  assert.throws(() => validateCommunityModerationRequest({ action: 'warn', reason: ' ', requestId: 'moderation_12345678' }), /처리 사유/)
  assert.throws(() => validateCommunityModerationRequest({ action: 'remove', reason: '삭제 사유', requestId: '../unsafe' }), /요청 식별자/)
  assert.throws(() => validateCommunityModerationRequest({ action: 'delete', reason: '삭제 사유', requestId: 'moderation_12345678' }), /처리 상태/)
})

test('moderation request replays use the same private command and notice identifiers', () => {
  const first = communityModerationCommandKey('moderator-1', 'request_12345678')
  assert.equal(first, communityModerationCommandKey('moderator-1', 'request_12345678'))
  assert.notEqual(first, communityModerationCommandKey('moderator-1', 'request_87654321'))
  assert.equal(first.length, 40)
})

test('author moderation notice projection omits private owner and operator identifiers', () => {
  const record = communityModerationNoticeOwnerRecord('notice-1', {
    ownerUid: 'private-author',
    moderatorUid: 'private-operator',
    targetType: 'comment',
    postId: 'post-1',
    commentId: 'comment-1',
    action: 'hold',
    reason: '개인정보 보호를 위해 즉시 숨겼어요.',
    contentStatus: 'held',
    body: '작성한 댓글 일부',
    createdAt: { toMillis: () => 1_234 },
  })
  assert.deepEqual(record, {
    noticeId: 'notice-1',
    targetType: 'comment',
    postId: 'post-1',
    commentId: 'comment-1',
    action: 'hold',
    reason: '개인정보 보호를 위해 즉시 숨겼어요.',
    contentStatus: 'held',
    body: '작성한 댓글 일부',
    createdAtMs: 1_234,
  })
  assert.equal('ownerUid' in record, false)
  assert.equal('moderatorUid' in record, false)
})

test('direct deletion stays an author action and cannot bypass reasoned admin moderation', () => {
  assert.equal(canDirectlyDeleteCommunityContent('author-1', 'author-1'), true)
  assert.equal(canDirectlyDeleteCommunityContent('author-1', 'administrator-1'), false)
})

test('ordinary members cannot issue moderation commands', () => {
  assert.throws(() => requireCommunityModerator({ role: 'member' }), { code: 'permission-denied' })
  assert.doesNotThrow(() => requireCommunityModerator({ role: 'moderator' }))
  assert.doesNotThrow(() => requireCommunityModerator({ role: 'administrator' }))
})

test('comment reports preserve the parent post and urgent reports wait for review instead of auto-hiding content', () => {
  const record = communityReportRecord(
    { targetType: 'comment', postId: 'post-1', targetId: 'comment-1' },
    'personal_data',
    '개인정보가 보여요',
    'server-time',
  )
  assert.equal(record.postId, 'post-1')
  assert.equal(record.status, 'urgent_review')
  assert.equal('heldAt' in record, false)
})

test('only active content is reportable', () => {
  assert.doesNotThrow(() => validateReportableCommunityStatus('active'))
  assert.throws(() => validateReportableCommunityStatus('held'), /공개 중인 내용/)
  assert.throws(() => validateReportableCommunityStatus('removed'), /공개 중인 내용/)
  assert.throws(() => validateReportableCommunityStatus('deleted'), /공개 중인 내용/)
})

test('daily total and urgent report quotas are explicitly bounded', () => {
  assert.deepEqual(validateReportQuota({ total: 2, urgent: 1 }, true), { total: 3, urgent: 2 })
  assert.throws(() => validateReportQuota({ total: 20, urgent: 0 }, false), /신고 수/)
  assert.throws(() => validateReportQuota({ total: 3, urgent: 3 }, true), /신고 수/)
})

test('ownership flags expose only record identifiers owned by the requesting member', () => {
  assert.deepEqual(ownedCommunityRecordIds('member-1', [
    { id: 'post-1', ownerUid: 'member-1' },
    { id: 'post-2', ownerUid: 'member-2' },
  ]), ['post-1'])
})

test('ownership producer emits complete comment policy and rejects missing owner records', () => {
  assert.deepEqual(communityOwnershipResponse({
    uid: 'member-1',
    administrator: false,
    postIds: [],
    comments: [
      { postId: 'post-1', commentId: 'comment-owned' },
      { postId: 'post-1', commentId: 'comment-hidden' },
    ],
    ownerUids: ['member-1', 'member-2'],
    hiddenOwnerUids: new Set(['member-2']),
  }), {
    postIds: [],
    comments: [{ postId: 'post-1', commentId: 'comment-owned' }],
    hiddenPostIds: [],
    hiddenComments: [{ postId: 'post-1', commentId: 'comment-hidden' }],
    canManageAll: false,
  })

  assert.throws(() => communityOwnershipResponse({
    uid: 'member-1',
    administrator: false,
    postIds: [],
    comments: [{ postId: 'post-1', commentId: 'comment-without-owner' }],
    ownerUids: [undefined],
    hiddenOwnerUids: new Set(),
  }), /소유자 정책/)
})

test('blocked relationships hide only records owned by either side of the relationship', () => {
  assert.deepEqual(blockedCommunityRecordIds(new Set(['member-2', 'member-3']), [
    { id: 'post-1', ownerUid: 'member-1' },
    { id: 'post-2', ownerUid: 'member-2' },
    { id: 'comment-1', ownerUid: 'member-3' },
  ]), ['post-2', 'comment-1'])
})

test('operator queues and their server-side statuses are allowlisted', () => {
  assert.equal(validateCommunityOperatorQueue(undefined), 'content')
  assert.equal(validateCommunityOperatorQueue('reports'), 'reports')
  assert.equal(validateCommunityQueueStatus('reports', 'urgent_review'), 'urgent_review')
  assert.equal(validateCommunityQueueStatus('appeals', 'received'), 'received')
  assert.throws(() => validateCommunityOperatorQueue('files'), /대기함/)
  assert.throws(() => validateCommunityQueueStatus('appeals', 'urgent_review'), /상태/)
})

test('operator queue cursor pages keep the 101st item reachable', () => {
  const records = Array.from({ length: 121 }, (_, index) => ({
    id: `case-${String(121 - index).padStart(3, '0')}`,
    seconds: 1_721_800_000 - index,
    nanoseconds: index,
  }))
  const cursor = (record: typeof records[number]) => encodeCommunityQueueCursor(record)
  const first = communityQueuePage(records, cursor)
  const second = communityQueuePage(records.slice(50), cursor)
  const third = communityQueuePage(records.slice(100), cursor)
  assert.equal(first.items.length, 50)
  assert.equal(first.hasMore, true)
  assert.deepEqual(decodeCommunityQueueCursor(first.nextCursorId), records[49])
  assert.deepEqual(decodeCommunityQueueCursor(second.nextCursorId), records[99])
  assert.equal(third.items[0]?.id, records[100]?.id)
  assert.equal(third.hasMore, false)
})

test('value cursors page 100, 1000 and 10000 records without gaps and survive cursor deletion', () => {
  type Fixture = { id: string; seconds: number; nanoseconds: number }
  const cursorFor = (record: Fixture) => encodeCommunityQueueCursor(record)
  const afterCursor = (record: Fixture, cursor: ReturnType<typeof decodeCommunityQueueCursor>) => {
    if (!cursor) return true
    if (record.seconds !== cursor.seconds) return record.seconds < cursor.seconds
    if (record.nanoseconds !== cursor.nanoseconds) return record.nanoseconds < cursor.nanoseconds
    return record.id < cursor.id
  }
  const pageAfter = (records: Fixture[], encodedCursor: string | null) => {
    const cursor = decodeCommunityQueueCursor(encodedCursor)
    return communityQueuePage(records.filter((record) => afterCursor(record, cursor)).slice(0, 51), cursorFor)
  }

  for (const total of [100, 1_000, 10_000]) {
    const records = Array.from({ length: total }, (_, index) => ({
      id: `case-${String(total - index).padStart(5, '0')}`,
      seconds: 1_800_000_000 - Math.floor(index / 7),
      nanoseconds: 900_000_000 - (index % 7),
    }))
    const collected: string[] = []
    let cursor: string | null = null
    do {
      const page = pageAfter(records, cursor)
      assert.ok(page.items.length <= 50)
      collected.push(...page.items.map((record) => record.id))
      cursor = page.hasMore ? page.nextCursorId : null
    } while (cursor)
    assert.equal(collected.length, total)
    assert.equal(new Set(collected).size, total)
    assert.deepEqual(collected, records.map((record) => record.id))
    if (total === 100) assert.equal(collected[100], undefined)
    if (total >= 1_000) assert.equal(collected[100], records[100]?.id)

    const first = pageAfter(records, null)
    assert.ok(first.nextCursorId)
    const replay = pageAfter(records, first.nextCursorId)
    assert.deepEqual(replay, pageAfter(records, first.nextCursorId))
    const removedCursorRecord = records.filter((record) => record.id !== first.items.at(-1)?.id)
    assert.deepEqual(
      pageAfter(removedCursorRecord, first.nextCursorId).items,
      replay.items,
    )
  }
})

test('community queue cursors reject malformed bounds', () => {
  assert.equal(decodeCommunityQueueCursor(undefined), null)
  assert.throws(() => decodeCommunityQueueCursor('not-a-cursor'), { code: 'invalid-argument' })
  assert.throws(() => decodeCommunityQueueCursor(encodeCommunityQueueCursor({
    seconds: 1,
    nanoseconds: 1_000_000_000,
    id: 'case-1',
  })), { code: 'invalid-argument' })
  assert.throws(() => decodeCommunityQueueCursor(encodeCommunityQueueCursor({
    seconds: 253_402_300_800,
    nanoseconds: 0,
    id: 'case-1',
  })), { code: 'invalid-argument' })
  assert.throws(
    () => communityQueuePage(Array.from({ length: 51 }, (_, index) => ({ id: `case-${index}` }))),
    { code: 'failed-precondition' },
  )
})

test('report resolution actions map to an explicit content transition', () => {
  assert.deepEqual(
    communityCaseResolutionPlan({ caseType: 'report', action: 'dismiss', contentStatus: 'active' }),
    { caseStatus: 'dismissed', moderationAction: null },
  )
  assert.deepEqual(
    communityCaseResolutionPlan({ caseType: 'report', action: 'hold', contentStatus: 'active' }),
    { caseStatus: 'resolved', moderationAction: 'hold' },
  )
  assert.deepEqual(
    communityCaseResolutionPlan({ caseType: 'report', action: 'remove', contentStatus: 'held' }),
    { caseStatus: 'resolved', moderationAction: 'remove' },
  )
  assert.throws(
    () => communityCaseResolutionPlan({ caseType: 'report', action: 'hold', contentStatus: 'removed' }),
    /숨김 처리/,
  )
})

test('appeal acceptance restores eligible content while rejection keeps moderation', () => {
  assert.deepEqual(
    communityCaseResolutionPlan({ caseType: 'appeal', action: 'accept', contentStatus: 'removed' }),
    { caseStatus: 'accepted', moderationAction: 'restore' },
  )
  assert.deepEqual(
    communityCaseResolutionPlan({ caseType: 'appeal', action: 'reject', contentStatus: 'held' }),
    { caseStatus: 'rejected', moderationAction: null },
  )
  assert.throws(
    () => communityCaseResolutionPlan({ caseType: 'appeal', action: 'accept', contentStatus: 'active' }),
    /복원/,
  )
  assert.throws(
    () => communityCaseResolutionPlan({ caseType: 'appeal', action: 'dismiss', contentStatus: 'held' }),
    /이의 제기 처리/,
  )
})

test('member appeal history retains accepted outcomes after the post is restored', () => {
  const record = communityAppealOwnerRecord('appeal-1', {
    postId: 'post-restored',
    status: 'accepted',
    resolution: '운영 조치를 해제하고 글을 다시 공개했어요.',
    createdAt: { toMillis: () => 1_000 },
    resolvedAt: { toMillis: () => 2_000 },
    ownerUid: 'private-member',
    resolvedBy: 'private-administrator',
    reason: 'private-appeal-details',
  })
  assert.deepEqual(record, {
    appealId: 'appeal-1',
    postId: 'post-restored',
    status: 'accepted',
    resolution: '운영 조치를 해제하고 글을 다시 공개했어요.',
    createdAtMs: 1_000,
    resolvedAtMs: 2_000,
  })
  assert.equal('ownerUid' in record, false)
  assert.equal('resolvedBy' in record, false)
  assert.equal('reason' in record, false)
})
