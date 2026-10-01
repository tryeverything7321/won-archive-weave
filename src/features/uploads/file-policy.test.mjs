import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import ts from 'typescript'

const code = ts.transpile(fs.readFileSync(new URL('./file-policy.ts', import.meta.url), 'utf8'), { module: ts.ModuleKind.ESNext })
const { uploadAccept, uploadContentType, uploadFileError } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

test('Markdown selection matches the server text/markdown contract across browser MIME fallbacks', () => {
  assert.match(uploadAccept, /\.md/)
  for (const type of ['text/markdown', 'text/plain', 'application/octet-stream', '']) {
    const file = { name: '청년회-기록.md', size: 128, type }
    assert.equal(uploadFileError(file), null)
    assert.equal(uploadContentType(file), 'text/markdown')
  }
  assert.match(uploadFileError({ name: '청년회-기록.md', size: 128, type: 'text/html' }), /올릴 수 있어요/)
})
