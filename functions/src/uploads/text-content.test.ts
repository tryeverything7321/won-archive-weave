import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTextContent } from './text-content.js'

test('legacy absent text and whitespace-only bodies remain absent', () => {
  assert.equal(normalizeTextContent(undefined), undefined)
  assert.equal(normalizeTextContent(null), undefined)
  assert.equal(normalizeTextContent({ format: 'markdown', body: ' \r\n\t ' }), undefined)
})

test('normalizes pasted line endings without destroying Markdown indentation', () => {
  assert.deepEqual(normalizeTextContent({ format: 'markdown', body: '\n# 회의록\r\n\r\n- 안건\r\n  - 준비\r결정 사항\n' }), {
    schemaVersion: 1, format: 'markdown', body: '# 회의록\n\n- 안건\n  - 준비\n결정 사항',
  })
})

test('preserves plain text and strips untrusted metadata from the saved contract', () => {
  assert.deepEqual(normalizeTextContent({ format: 'markdown', body: '회의를 마쳤습니다.', ownerUid: 'not-accepted', published: true }), {
    schemaVersion: 1, format: 'markdown', body: '회의를 마쳤습니다.',
  })
})

test('preserves meaningful first-line indentation and Markdown hard-break spaces', () => {
  assert.equal(normalizeTextContent({ format: 'markdown', body: '\n    code\n다음 줄  \n' })?.body, '    code\n다음 줄  ')
})

test('rejects malformed versions, formats and non-string bodies', () => {
  for (const value of [[], 1, 'body', {}, { format: 'html', body: 'a' }, { format: 'markdown', body: 1 }, { schemaVersion: 2, format: 'markdown', body: 'a' }]) {
    assert.throws(() => normalizeTextContent(value), { code: 'invalid-argument' })
  }
})

test('bounds text before trimming so oversized blank input cannot evade the limit', () => {
  assert.equal(normalizeTextContent({ format: 'markdown', body: '가'.repeat(50_000) })?.body.length, 50_000)
  assert.throws(() => normalizeTextContent({ format: 'markdown', body: '가'.repeat(50_001) }), { code: 'invalid-argument' })
  assert.throws(() => normalizeTextContent({ format: 'markdown', body: ' '.repeat(50_001) }), { code: 'invalid-argument' })
})
