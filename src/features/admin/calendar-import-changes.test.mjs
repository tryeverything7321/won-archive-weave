import assert from 'node:assert/strict';
import test from 'node:test';
import { readCalendarImportComparison } from './calendar-import-changes-model.ts';

function comparison(changes) {
  return {
    candidateId: 'candidate-1',
    sourceStatus: 'active',
    sourceRevision: 'source-1',
    eventRevision: 'event-1',
    changes,
  };
}

test('calendar comparison accepts the server event state change', () => {
  const value = comparison([{
    field: 'eventState',
    label: '일정 상태',
    currentValue: 'confirmed',
    sourceValue: 'cancelled',
  }]);
  assert.deepEqual(readCalendarImportComparison(value), value);
});

test('calendar comparison still rejects unknown and duplicate fields', () => {
  assert.throws(() => readCalendarImportComparison(comparison([{
    field: 'privateToken',
    label: '허용되지 않은 값',
    currentValue: null,
    sourceValue: 'secret',
  }])), /invalid comparison/);
  const state = {
    field: 'eventState',
    label: '일정 상태',
    currentValue: 'confirmed',
    sourceValue: 'cancelled',
  };
  assert.throws(() => readCalendarImportComparison(comparison([state, state])), /invalid comparison/);
});
