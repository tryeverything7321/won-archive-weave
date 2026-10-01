// Local-only fixtures. Never imported by the production application.
const now = Date.parse('2026-10-01T10:00:00+09:00');
const members = ['푸른마음', '함께걷기', '고요한숲'].map((pseudonym, i) => ({
  memberId: `wm_demo_${i + 1}`, pseudonym, accountCreatedAt: new Date(now - i * 86400000).toISOString(),
  provider: i === 1 ? 'naver' : 'kakao', completion: i === 2 ? 'incomplete' : 'complete',
  steps: { connected: true, currentTerms: i !== 2, currentCommunityRules: i !== 2, pseudonymSet: true },
  lastRecordedActivityAt: i === 2 ? null : new Date(now).toISOString(),
  activityCounts: { post: i === 2 ? 0 : 1, comment: 0, submission: 0, event: 0 }, activityCountsComplete: true,
}));
const queue = [
  { id: 'demo-report', type: 'report', status: 'open', urgent: true, overdue: true, createdAtMs: now - 90000000, targetLabel: '커뮤니티 글 신고', issueLabel: '내용 확인 필요', href: '/admin/community' },
  { id: 'demo-submission', type: 'submission', status: 'scan_failed', urgent: false, overdue: false, createdAtMs: now, targetLabel: '자료 안전 검사', issueLabel: '검사 재시도 필요', href: '/admin/submissions' },
];
export async function adminFixture(name, input = {}) {
  if (name === 'getOperationsOverview') return {
    asOfMs: now, period: { kind: 'open_queue', timezone: 'Asia/Seoul' }, completeness: 'complete',
    counts: { all: 2, urgent: 1, overdue: 1, report: 1, appeal: 0, submission: 1 },
    cards: [['urgent', '긴급', 1], ['overdue', '기한 초과', 1], ['report', '신고', 1], ['appeal', '이의 제기', 0], ['submission', '자료 예외', 1]].map(([id, label, count]) => ({ id, label, count, filter: { type: ['urgent', 'overdue'].includes(id) ? 'all' : id, priority: ['urgent', 'overdue'].includes(id) ? id : 'all' } })),
    serviceHealth: [{ id: 'cloud', label: 'Cloud 관측', source: 'cloud', status: 'unconnected', observedAtMs: null, destination: 'https://console.cloud.google.com/monitoring?project=won-archive-weave' }],
  };
  if (name === 'listOperationsQueue') return { items: queue.filter(item => (input.type === 'all' || item.type === input.type) && (input.priority === 'all' || item[input.priority])), nextCursor: null, hasMore: false, asOfMs: now, completeness: 'complete', filter: { type: input.type, priority: input.priority } };
  if (name === 'listOperatorAuditEvents') return { items: [{ id: 'demo-audit', type: 'members.list_viewed', category: 'members', label: '회원 현황 조회', occurredAtMs: now, targetType: 'member', targetId: null, action: '조회', result: '완료' }], nextCursor: null, hasMore: false, asOfMs: now, completeness: 'complete' };
  if (name === 'listAdminMembers') {
    const items = members.filter(m => (!input.search || `${m.pseudonym} ${m.memberId}`.includes(input.search)) && (!input.provider || input.provider === 'all' || m.provider === input.provider) && (!input.completion || input.completion === 'all' || m.completion === input.completion) && (!input.createdFrom || m.accountCreatedAt >= input.createdFrom) && (!input.createdTo || m.accountCreatedAt < input.createdTo) && (!input.activity || input.activity === 'any' || (input.activity === 'present' ? m.activityCounts.post > 0 : m.activityCounts.post === 0)));
    return { items, nextCursor: null, summary: { populationCount: items.length, createdToday: items.filter(m => m.accountCreatedAt === members[0].accountCreatedAt).length, completed: items.filter(m => m.completion === 'complete').length, membersWithRecordedActivity: items.filter(m => m.activityCounts.post > 0).length, activityCounts: { post: items.reduce((sum, m) => sum + m.activityCounts.post, 0), comment: 0, submission: 0, event: 0 }, complete: true, timeZone: 'Asia/Seoul', period: { from: input.createdFrom ?? null, to: input.createdTo ?? null }, refreshedAt: new Date(now).toISOString(), basis: '로컬 시험 데이터 · 현재 보존된 기록 기준' } };
  }
  if (name === 'getAdminMemberOverview') return { member: members.find(m => m.memberId === input.memberId) ?? members[0] };
  if (name === 'listAdminMemberActivity') return { items: [{ id: 'demo-account', kind: 'account', occurredAtMs: now, occurredAt: new Date(now).toISOString(), title: '계정 생성', status: '완료', href: null }], nextCursor: null, collectionScope: '시험 기록', notCollected: ['방문', '클릭', '다운로드 완료'] };
  if (name === 'getAdminMemberPrivateDetails') return { details: { realName: null, organization: '시험 모임', email: null, phone: null, verification: 'member_supplied_unverified' } };
  return undefined;
}
