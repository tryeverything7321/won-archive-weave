import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeUploadSelection, selectedUploadNames, uploadSelectionFingerprint } from './upload-selection.js'

const file = { name: '회의록.txt', size: 24, contentType: 'text/plain', sha256: 'a'.repeat(64) }
test('upload selection uses bounded flat unique paths and stable descriptor fingerprints', () => {
  const value = normalizeUploadSelection({ requestId: 'upload-request-001', files: [file] })
  assert.match(value.files[0].targetName, /^u[a-f0-9]{24}--회의록\.txt$/)
  assert.deepEqual(selectedUploadNames(value), [value.files[0].targetName])
  assert.equal(uploadSelectionFingerprint(value), uploadSelectionFingerprint(normalizeUploadSelection({ requestId: value.requestId, files: [file] })))
  assert.notEqual(uploadSelectionFingerprint(value), uploadSelectionFingerprint(normalizeUploadSelection({ requestId: value.requestId, files: [{ ...file, sha256: 'b'.repeat(64) }] })))
})

test('upload selection rejects traversal, unknown descriptors, oversized files and malformed stored state', () => {
  for (const patch of [{ name: '../x.txt' }, { size: 0 }, { size: '24' }, { size: 21 * 1024 * 1024 }, { sha256: 'fake' }]) {
    assert.throws(() => normalizeUploadSelection({ requestId: 'upload-request-001', files: [{ ...file, ...patch }] }))
  }
  assert.throws(() => normalizeUploadSelection({ requestId: 'upload-request-001', files: [] }))
  assert.throws(() => normalizeUploadSelection({ requestId: 'upload-request-001', files: [file, file, file] }))
  assert.equal(selectedUploadNames(undefined), undefined)
  assert.throws(() => selectedUploadNames({ requestId: 'invalid', files: [] }))
})
