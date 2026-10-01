import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const contract = readJson('../docs/superpowers/plans/2026-09-10-qc-completion-draft.json');
const ledger = readJson('../docs/reviews/2026-09-11-qc-execution-ledger.json');

test('execution ledger retains every source requirement exactly once', () => {
  const ids = ledger.requirements.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.toSorted(), contract.requirements.map(item => item.id).toSorted());
});

test('each execution entry separates implementation verification and deployment', () => {
  for (const item of ledger.requirements) {
    for (const stage of ['implementation', 'verification', 'deployment']) assert.equal(typeof item[stage], 'string', `${item.id}.${stage}`);
    assert.equal(typeof item.blocked, 'boolean', item.id);
    assert.ok(item.reason && item.next_action, item.id);
    if (item.verification === 'PASS' || item.deployment === 'PASS') assert.ok(item.evidence.length, `${item.id} requires current evidence`);
  }
});

test('approved draft and first-audience decisions are not stale approval blockers', () => {
  for (const item of ledger.requirements) {
    assert.ok(!item.reason.includes('D05 초안 위치·기간 또는 D04 최초 공개 선택 정책의 사용자 결정 대기'), item.id);
  }
  const policy = readFileSync(new URL('../docs/reviews/2026-09-11-approved-draft-policy.md', import.meta.url), 'utf8');
  assert.match(policy, /24/);
  assert.match(policy, /철회/);
});
