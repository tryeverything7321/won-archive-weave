import assert from 'node:assert/strict';
import test from 'node:test';
import { eventMediaItemNotice, eventMediaNotice } from './event-media-notice.ts';

test('blocked photos do not instruct re-uploading the same file', () => {
  const text = eventMediaNotice({ status: 'publishing_failed', contentPublished: true, reviewReason: 'media_scan_blocked' });
  assert.match(text, /보안 검사를 통과하지 못/);
  assert.match(text, /다른 사진/);
});
test('scanner outage is not presented as a defective user file', () => {
  const text = eventMediaNotice({ status: 'publishing_failed', contentPublished: true, reviewReason: 'automatic_media_scan_failed' });
  assert.match(text, /검사를 완료하지 못/);
  assert.doesNotMatch(text, /다시 올려|통과하지 못/);
});

test('saved photo cards distinguish pending, blocked and scanner outage states', () => {
  assert.equal(eventMediaItemNotice({ status: 'review_queued', reviewReason: 'media_scan_pending' }), '검사 중');
  assert.equal(eventMediaItemNotice({ status: 'publishing_failed', reviewReason: 'media_scan_blocked' }), '안전 검사 차단');
  assert.equal(eventMediaItemNotice({ status: 'publishing_failed', reviewReason: 'automatic_media_scan_failed' }), '검사 일시 실패');
  assert.equal(eventMediaItemNotice({ status: 'published' }), '공개됨');
});
test('unpublished events never claim public status or pending media publication', () => {
  assert.equal(eventMediaNotice({ status: 'unpublished', contentPublished: true, reviewReason: 'media_scan_pending' }), null);
  assert.equal(eventMediaNotice({ status: 'canceled', contentPublished: true, reviewReason: 'media_scan_pending' }), null);
  assert.equal(eventMediaNotice({ status: 'published', contentPublished: true }), null);
});
