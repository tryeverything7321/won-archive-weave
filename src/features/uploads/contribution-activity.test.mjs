import test from 'node:test';
import assert from 'node:assert/strict';
import { contributionActivity } from './contribution-activity.ts';
test('an activity remains an activity when optional summary is empty', () => {
  assert.deepEqual(contributionActivity('활동 기록', '청년회 여름 모임', {summary:'', story:'함께 공부했어요'}), {summary:'청년회 여름 모임', story:'함께 공부했어요'});
});
test('material contributions do not accidentally create activity records', () => {
  assert.equal(contributionActivity('자료', '안내문 양식', {summary:'양식 공유'}), undefined);
});
test('keeps an explicitly written activity summary', () => {
  assert.deepEqual(contributionActivity('활동 기록', '제목', {summary:'직접 쓴 소개'}), {summary:'직접 쓴 소개'});
});
