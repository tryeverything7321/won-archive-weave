import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareOperationsQueueItems,
  decodeOperationsQueueCursor,
  encodeOperationsQueueCursor,
  operationsQueueFilter,
  operationsQueuePageSize,
  projectReportQueueItem,
  projectSubmissionQueueItem,
  queueSourcesForFilter,
} from './overview-model.js'

test('운영 처리함 필터는 긴급 신고와 서버 페이지 상한을 검증한다', () => {
  assert.deepEqual(operationsQueueFilter({ type: 'report', priority: 'urgent' }), { type: 'report', priority: 'urgent' })
  assert.deepEqual(queueSourcesForFilter({ type: 'all', priority: 'overdue' }), ['report', 'appeal', 'submission'])
  assert.throws(() => operationsQueueFilter({ type: 'submission', priority: 'urgent' }), /긴급 항목/)
  assert.equal(operationsQueuePageSize(undefined), 30)
  assert.throws(() => operationsQueuePageSize(51), /50개/)
})

test('통합 cursor는 출처별 동일 시각 경계를 보존한다', () => {
  const cursor = {
    version: 1 as const,
    sources: {
      report: { seconds: 1_800_000_000, nanoseconds: 12, id: 'report-a' },
      submission: { seconds: 1_800_000_000, nanoseconds: 12, id: 'submission-b' },
    },
  }
  assert.deepEqual(decodeOperationsQueueCursor(encodeOperationsQueueCursor(cursor)), cursor)
  assert.throws(() => decodeOperationsQueueCursor(Buffer.from(JSON.stringify({ version: 1, sources: { report: { seconds: 1, nanoseconds: 0, id: 'bad/id' } } })).toString('base64url')), /위치/)
})

test('처리함 투영은 계정 연결과 신고 원문을 응답에 포함하지 않는다', () => {
  const now = 1_800_000_000_000
  const report = projectReportQueueItem('report-a', {
    status: 'urgent_review',
    category: 'personal_data',
    targetType: 'post',
    uid: 'private-user',
    details: '개인정보 원문',
  }, now - 100, now)
  assert.equal(report.issueLabel, '개인정보 신고')
  assert.equal(report.urgent, true)
  assert.equal(JSON.stringify(report).includes('private-user'), false)
  assert.equal(JSON.stringify(report).includes('개인정보 원문'), false)

  const oldSubmission = projectSubmissionQueueItem('submission-a', { type: 'scan_failed', ownerUid: 'private-owner' }, now - 86_400_001, now)
  assert.equal(oldSubmission.overdue, true)
  assert.equal(JSON.stringify(oldSubmission).includes('private-owner'), false)
})

test('통합 목록은 같은 시각에도 종류와 문서 ID로 안정 정렬한다', () => {
  const now = 1_800_000_000_000
  const items = [
    projectSubmissionQueueItem('b', {}, now, now),
    projectReportQueueItem('a', {}, now, now),
  ].sort(compareOperationsQueueItems)
  assert.deepEqual(items.map((item) => `${item.type}:${item.id}`), ['submission:b', 'report:a'])
})
