import test from 'node:test';
import assert from 'node:assert/strict';
import { createModerationRequestTracker } from './moderation-request.ts';
test('lost-response retry preserves the moderation request id', () => {
  let count = 0;
  const tracker = createModerationRequestTracker(() => `request-${++count}`);
  assert.equal(tracker.idFor('post:warn:reason'), tracker.idFor('post:warn:reason'));
  assert.equal(count, 1);
});
test('success or changed action creates a new request', () => {
  let count = 0;
  const tracker = createModerationRequestTracker(() => `request-${++count}`);
  const first = tracker.idFor('warn');
  assert.notEqual(tracker.idFor('remove'), first);
  tracker.clear();
  assert.equal(tracker.idFor('remove'), 'request-3');
});
