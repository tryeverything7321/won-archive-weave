import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

async function load(relative) {
  const code = ts.transpile(readFileSync(new URL(relative, import.meta.url), 'utf8'), { module: ts.ModuleKind.ESNext })
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const client = await load('../src/features/uploads/file-policy.ts')
const server = await load('../functions/src/uploads/contracts.ts')
const formats = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', hwp: 'application/x-hwp', hwpx: 'application/hwp+zip',
}
test('all supported extensions with missing or generic browser MIME reach canonical server acceptance', () => {
  for (const [extension, canonical] of Object.entries(formats)) {
    for (const type of ['', 'application/octet-stream', canonical]) {
      const file = { name: '위브 자료.' + extension.toUpperCase(), size: 1024, type }
      assert.equal(client.uploadFileError(file), null, file.name + ':' + type)
      const contentType = client.uploadContentType(file)
      assert.equal(contentType, canonical)
      assert.equal(server.validateUploadDescriptor({ ...file, contentType }).contentType, canonical)
    }
  }
})
test('ZIP fallback is restricted to known ZIP document containers', () => {
  for (const extension of ['docx', 'pptx', 'xlsx', 'hwpx']) {
    const file = { name: '자료.' + extension, type: 'application/zip', size: 10 }
    assert.equal(client.uploadFileError(file), null)
    assert.doesNotThrow(() => server.validateUploadDescriptor({ ...file, contentType: client.uploadContentType(file) }))
  }
  for (const extension of ['pdf', 'png', 'txt', 'csv', 'hwp']) {
    assert.ok(client.uploadFileError({ name: '자료.' + extension, type: 'application/zip', size: 10 }))
  }
})
test('explicit mismatches, unsupported and prototype-like extensions fail without crashing', () => {
  for (const [name, type] of [['자료.pdf', 'image/png'], ['자료.docx', 'application/pdf'],
    ['파일.exe', 'application/pdf'], ['파일.constructor', 'application/pdf'],
    ['파일.__proto__', 'text/plain'], ['파일.toString', 'text/plain'], ['원본.md', 'application/pdf']]) {
    assert.ok(client.uploadFileError({ name, type, size: 100 }), name)
    assert.throws(() => server.validateUploadDescriptor({ name, contentType: type, size: 100 }), name)
  }
})
test('Markdown reported as plain text reaches the canonical Markdown MIME', () => {
  const file = { name: '회의록.md', type: 'text/plain', size: 100 }
  assert.equal(client.uploadFileError(file), null)
  assert.equal(client.uploadContentType(file), 'text/markdown')
  assert.equal(server.validateUploadDescriptor({ ...file, contentType: client.uploadContentType(file) }).contentType, 'text/markdown')
})
test('Storage Markdown exception is extension constrained and keeps quarantine owner gates', () => {
  const rules = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8')
  assert.ok(rules.includes("fileName.matches('.*\\\\.[mM][dD]')"))
  assert.ok(rules.includes("request.resource.contentType == 'text/markdown'"))
  assert.ok(rules.includes('allow create: if isActiveMember() && request.auth.uid == uid && validUpload(fileName)'))
  assert.ok(rules.includes('allow update, delete: if false'))
})
test('bounds remain 20MB, nonempty, finite integer and bounded filename', () => {
  for (const size of [0, -1, NaN, Infinity, 0.5, 20 * 1024 * 1024 + 1]) {
    const file = { name: '자료.pdf', type: '', size }
    assert.ok(client.uploadFileError(file))
    assert.throws(() => server.validateUploadDescriptor({ ...file, contentType: 'application/pdf' }))
  }
  assert.ok(client.uploadFileError({ name: 'a'.repeat(161) + '.pdf', type: '', size: 1 }))
})
