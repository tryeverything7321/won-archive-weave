import assert from 'node:assert/strict';
import test from 'node:test';
import { importText, readTextContent, safeContentUrl } from './text-content.ts';
const bytes = value => new TextEncoder().encode(value).buffer;
test('text import preserves Markdown, normalizes line endings and enforces encoding and size', () => {
  assert.equal(importText('회의록.md', bytes('  내용\r\n\r\n- 준비')), '  내용\n\n- 준비');
  assert.throws(() => importText('회의록.hwp', bytes('본문')));
  assert.throws(() => importText('empty.txt', bytes('  ')));
  assert.throws(() => importText('large.txt', new ArrayBuffer(1024 * 1024 + 1)));
  assert.throws(() => importText('long.txt', bytes('가'.repeat(50_001))));
  assert.throws(() => importText('invalid.txt', new Uint8Array([0xff, 0xff]).buffer));
});
test('reader refuses unknown body formats and unsafe or credential-bearing links', () => {
  assert.equal(readTextContent({ schemaVersion: 1, format: 'html', body: '본문' }), undefined);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'https://user:pass@example.com', '/admin']) assert.equal(safeContentUrl(url), '');
  assert.equal(safeContentUrl('https://example.com/post'), 'https://example.com/post');
});

test('plain reader preserves spaces, tabs and blank lines without interpreting markup', () => {
  const body = '\n  이름      역할\n  민규\t진행\n# 그대로 표시\n';
  assert.deepEqual(readTextContent({ schemaVersion: 1, format: 'plain', body }), { schemaVersion: 1, format: 'plain', body });
});
