import assert from 'node:assert/strict';
import test from 'node:test';
import { includeCalendarExample, calendarSearchWithExamples } from './calendar-example-policy.ts';

test('examples are opt-in and only the canonical enabled value activates them', () => {
  assert.equal(includeCalendarExample(new URLSearchParams()), false);
  assert.equal(includeCalendarExample(new URLSearchParams('examples=1')), true);
  assert.equal(includeCalendarExample(new URLSearchParams('examples=false')), false);
});

test('example toggle preserves other calendar navigation conditions', () => {
  const enabled = new URLSearchParams(calendarSearchWithExamples('?month=2026-09&view=agenda&q=서울', true));
  assert.equal(enabled.get('examples'), '1');
  assert.equal(enabled.get('q'), '서울');
  const disabled = new URLSearchParams(calendarSearchWithExamples(enabled.toString(), false));
  assert.equal(disabled.has('examples'), false);
  assert.equal(disabled.get('month'), '2026-09');
  assert.equal(disabled.get('view'), 'agenda');
});
