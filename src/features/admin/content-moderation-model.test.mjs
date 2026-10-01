import test from 'node:test';
import assert from 'node:assert/strict';
import { moderationCommand } from './content-moderation-model.ts';

test('routes each content kind to its own identifier and trims operator reason', () => {
  assert.deepEqual(moderationCommand('submission', 's1', 'warn', '  출처 확인 부탁드립니다  ', 'request-123'), {
    callable: 'moderateSubmissionContent', data: { submissionId: 's1', action: 'warn', reason: '출처 확인 부탁드립니다', requestId: 'request-123' },
  });
  assert.equal(moderationCommand('event', 'e1', 'hold', '개인정보 노출', 'request-456').data.eventId, 'e1');
});
test('rejects blank or oversized explanations before dispatch', () => {
  assert.throws(() => moderationCommand('event', 'e1', 'hold', ' ', 'request-123'));
  assert.throws(() => moderationCommand('event', 'e1', 'hold', '가'.repeat(301), 'request-123'));
});
