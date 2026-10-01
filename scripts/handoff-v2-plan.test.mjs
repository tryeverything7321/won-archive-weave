import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const map = JSON.parse(read('docs/superpowers/plans/2026-09-10-handoff-v2-source-map.json'));
const source = read(map.source);
const lines = source.trimEnd().split('\n');
const plan = read('docs/superpowers/plans/2026-09-10-handoff-v2-chunk-dag.md');

test('canonical user handoff retains the original SHA256', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), map.sourceSha256);
});

test('all 55 source sections and the preamble have contiguous coverage', () => {
  assert.deepEqual(map.sections.map((item) => item.section), Array.from({ length: 56 }, (_, i) => i));
  let next = 1;
  for (const item of map.sections) {
    assert.equal(item.startLine, next);
    assert.ok(item.endLine >= item.startLine);
    if (item.section) assert.ok(lines[item.startLine - 1].startsWith(`## ${item.section}. `));
    next = item.endLine + 1;
  }
  assert.equal(next, lines.length + 1);
});

test('all mapped chunks exist once and every source subheading is retained', () => {
  assert.equal(new Set(map.chunks).size, 33);
  for (const id of map.chunks) assert.equal(plan.split(`### ${id} ·`).length - 1, 1);
  for (const item of map.sections) {
    assert.ok(item.chunks.length > 0);
    for (const id of item.chunks) assert.ok(map.chunks.includes(id), id);
    const expected = lines.slice(item.startLine - 1, item.endLine)
      .map((line, index) => ({ line: line, number: index + item.startLine }))
      .filter((row) => /^#{2,3} /.test(row.line) && !/^## \d+\. /.test(row.line));
    assert.deepEqual(item.subheadings.map((row) => row.line), expected.map((row) => row.number));
  }
});

test('all 30 acceptance IDs are mapped without claiming they were executed', () => {
  assert.deepEqual(map.acceptance.map((row) => row.id), Array.from({ length: 30 }, (_, i) => `T-${String(i + 1).padStart(2, '0')}`));
  assert.ok(map.acceptance.every((row) => row.status === 'NOT_RUN'));
  for (const row of map.acceptance) assert.ok(plan.includes(`| ${row.id} |`));
});

test('planned DAG has valid references, no cycles and all 33 chunks', () => {
  const dag = JSON.parse(read('docs/superpowers/plans/2026-09-10-handoff-v2-dag.json'));
  assert.equal(dag.status, 'PLANNED_NOT_ACTIVE');
  const nodes = new Map(dag.nodes.map((node) => [node.id, node]));
  assert.equal(nodes.size, dag.nodes.length);
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    assert.ok(nodes.has(id), `Unknown dependency ${id}`);
    assert.ok(!visiting.has(id), `Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of nodes.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodes.keys()) visit(id);
  for (const id of map.chunks) assert.ok(nodes.has(id));
});

test('all 23 work items retain original priority and valid chunk mapping', () => {
  const dag = JSON.parse(read('docs/superpowers/plans/2026-09-10-handoff-v2-dag.json'));
  assert.deepEqual(dag.backlog.map((row) => row.id), Array.from({ length: 23 }, (_, i) => `W-${String(i + 1).padStart(2, '0')}`));
  dag.backlog.forEach((row, index) => {
    assert.equal(row.priority, index < 5 ? 'P0' : index < 17 ? 'P1' : 'P2');
    assert.ok(row.chunks.length);
    for (const id of row.chunks) assert.ok(map.chunks.includes(id));
  });
});
