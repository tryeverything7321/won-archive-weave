import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeOperatorAuditCursor,
  encodeOperatorAuditCursor,
  operatorAuditPageSize,
  projectOperatorAuditEvent,
} from './audit-model.js'

test('운영 이력 cursor와 페이지 상한을 검증한다', () => {
  const cursor = { seconds: 1_800_000_000, nanoseconds: 8, id: 'audit-a' }
  assert.deepEqual(decodeOperatorAuditCursor(encodeOperatorAuditCursor(cursor)), cursor)
  assert.equal(operatorAuditPageSize(undefined), 30)
  assert.throws(() => operatorAuditPageSize(0), /50개/)
})

test('운영 이력은 허용된 사건과 필드만 투영한다', () => {
  const projected = projectOperatorAuditEvent('audit-a', {
    type: 'community.report_resolved',
    caseId: 'case-a',
    action: 'hold',
    nextStatus: 'held',
    uid: 'operator-private-id',
    reason: '개인정보가 포함될 수 있는 상세 사유',
    provider: 'kakao',
  }, 1_800_000_000_000)
  assert.deepEqual(projected, {
    id: 'audit-a',
    type: 'community.report_resolved',
    category: 'community',
    label: '신고 처리',
    occurredAtMs: 1_800_000_000_000,
    targetType: 'community',
    targetId: 'case-a',
    action: 'hold',
    result: 'held',
  })
  assert.equal(JSON.stringify(projected).includes('operator-private-id'), false)
  assert.equal(JSON.stringify(projected).includes('상세 사유'), false)
  assert.equal(projectOperatorAuditEvent('unknown', { type: 'community.post_created' }, 1), null)
})

test('허용 목록 밖 action과 결과는 그대로 노출하지 않는다', () => {
  const projected = projectOperatorAuditEvent('audit-b', {
    type: 'submission.operator_exception_action',
    submissionId: 'submission-a',
    action: 'arbitrary_private_action',
    status: 'private_status',
  }, 2)
  assert.equal(projected?.action, null)
  assert.equal(projected?.result, null)
})

test('제한 회원 조회 이력은 운영자와 회원 연결 및 사유를 화면 응답에서 제외한다', () => {
  const projected = projectOperatorAuditEvent('audit-member', {
    type: 'members.private_viewed',
    operatorUid: 'operator-private-id',
    memberId: 'opaque-member-id',
    reason: '지원 요청 확인',
  }, 3)
  assert.equal(projected?.label, '제한 회원 정보 조회')
  assert.equal(projected?.targetId, null)
  assert.equal(JSON.stringify(projected).includes('operator-private-id'), false)
  assert.equal(JSON.stringify(projected).includes('opaque-member-id'), false)
  assert.equal(JSON.stringify(projected).includes('지원 요청'), false)
})
