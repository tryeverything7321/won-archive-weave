import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const prefix = 'docs/superpowers/plans/2026-09-10-';
const contract = JSON.parse(read(`${prefix}qc-completion-draft.json`));
const ledger = JSON.parse(read(`${prefix}qc-status-ledger.json`));
const originalMap = JSON.parse(read(`${prefix}handoff-v2-source-map.json`));
const originalDag = JSON.parse(read(`${prefix}handoff-v2-dag.json`));
const ids = new Set(contract.requirements.map(item => item.id));
const range = (prefix, count, start = 1) => Array.from({ length: count }, (_, i) => `${prefix}${String(i + start).padStart(2, '0')}`);

test('every pinned source hash matches the actual workspace source', () => {
  for (const source of contract.sources) {
    assert.equal(createHash('sha256').update(read(source.path)).digest('hex'), source.sha256, source.id);
  }
  assert.equal(contract.sources.find(s => s.id === 'original').sha256, originalMap.sourceSha256);
});

test('all original chunks, QC entries, acceptance scenarios and calendar samples remain', () => {
  const expected = [...range('C', 33, 0), ...range('QC-', 4), ...range('U-', 6), ...range('F-', 6), ...range('R-', 11), ...range('D-', 4), ...range('V-', 7), ...range('T-', 30), ...range('CAL-', 12), 'RELEASE'];
  assert.equal(contract.requirements.length, 114);
  assert.equal(ids.size, contract.requirements.length);
  assert.deepEqual([...ids].sort(), expected.sort());
});

test('requirements have explicit source, acceptance and valid required stages', () => {
  const sourceIds = new Set(contract.sources.map(s => s.id));
  for (const item of contract.requirements) {
    assert.ok(item.description.trim());
    assert.ok(item.acceptance.trim());
    assert.ok(item.source_ids.length);
    for (const id of item.source_ids) assert.ok(sourceIds.has(id), id);
    assert.ok(item.stages.length);
    assert.equal(new Set(item.stages).size, item.stages.length);
    for (const stage of item.stages) assert.ok(['implementation', 'verification', 'deployment'].includes(stage));
  }
});

test('all 38 QC entries map to retained chunks', () => {
  assert.equal(Object.keys(ledger.qc_to_chunks).length, 38);
  for (const [id, chunks] of Object.entries(ledger.qc_to_chunks)) {
    assert.ok(ids.has(id));
    assert.ok(chunks.length);
    chunks.forEach(chunk => assert.ok(ids.has(chunk), chunk));
  }
});

test('source section and original priority coverage is retained, not rewritten', () => {
  assert.equal(originalMap.sections.length, 56);
  originalMap.sections.forEach(section => section.chunks.forEach(id => assert.ok(ids.has(id))));
  assert.equal(originalDag.backlog.length, 23);
  originalDag.backlog.forEach(item => item.chunks.forEach(id => assert.ok(ids.has(id))));
  for (const id of ['W-01', 'W-02', 'W-03', 'W-04', 'W-05']) assert.equal(originalDag.backlog.find(item => item.id === id).priority, 'P0');
  for (const id of ['W-15', 'W-16', 'W-17']) assert.equal(originalDag.backlog.find(item => item.id === id).priority, 'P1');
});

test('new execution has no borrowed PASS or omitted required stages', () => {
  assert.equal(ledger.status, 'PLANNED_NOT_ACTIVE');
  assert.equal(ledger.independent_source_review, 'NOT_RUN');
  assert.deepEqual(ledger.requirements.map(r => r.id).sort(), [...ids].sort());
  for (const item of contract.requirements) {
    const state = ledger.requirements.find(s => s.id === item.id);
    for (const stage of ['implementation', 'verification', 'deployment']) {
      assert.equal(state[stage], item.stages.includes(stage) ? 'NOT_RUN' : 'NOT_APPLICABLE');
    }
    assert.equal(state.evidence.length, 0);
  }
});

test('conditional scope and release are not falsely claimed as automatic implementation', () => {
  assert.deepEqual(contract.requirements.find(r => r.id === 'C32').stages, ['verification']);
  assert.ok(contract.requirements.find(r => r.id === 'RELEASE').stages.includes('deployment'));
  const plan = read(`${prefix}qc-integrated-execution.md`);
  assert.match(plan, /최대 재시도2회/);
  assert.match(plan, /배포 승인 후에는 해당 diff/);
  assert.match(plan, /기존 DONE run은 역사 기록/);
});
