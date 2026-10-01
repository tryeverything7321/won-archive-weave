import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SubmissionPolicyError,
  canDownload,
  canPreview,
  sanitizeUploadName,
  transitionSubmission,
  validateRightsRecord,
  validateUploadDescriptor,
} from './contracts.js'

test('validates complete rights and retention metadata', () => {
  const value = validateRightsRecord({
    source: ' 작성자 제공 ', owner: '서울 청년회', attribution: '서울 청년회 제공', redistribution: 'download_allowed',
    consentBasis: '작성자 직접 동의', sensitiveDataReviewed: true, retention: 'managed', reviewDueAtMs: 10_000,
  }, 1_000)
  assert.equal(value.source, '작성자 제공')
})

test('rejects empty, oversized, disguised and unsupported uploads', () => {
  assert.equal(sanitizeUploadName('../기획 최종.pdf'), '기획_최종.pdf')
  assert.throws(() => validateUploadDescriptor({ name: 'empty.pdf', size: 0, contentType: 'application/pdf' }), (error: SubmissionPolicyError) => error.code === 'invalid_file')
  assert.throws(() => validateUploadDescriptor({ name: 'payload.exe', size: 10, contentType: 'application/octet-stream' }), (error: SubmissionPolicyError) => error.code === 'invalid_file')
  assert.throws(() => validateUploadDescriptor({ name: 'renamed.hwp', size: 10, contentType: 'application/pdf' }), (error: SubmissionPolicyError) => error.code === 'invalid_file')
  assert.throws(() => validateUploadDescriptor({ name: 'renamed.hwpx', size: 10, contentType: 'application/x-hwp' }), (error: SubmissionPolicyError) => error.code === 'invalid_file')
})

test('accepts HWP and HWPX uploads with browser and canonical content types', () => {
  assert.equal(
    validateUploadDescriptor({ name: '청년회 기록.HWP', size: 1024, contentType: 'application/octet-stream' }).safeName,
    '청년회_기록.HWP',
  )
  assert.equal(
    validateUploadDescriptor({ name: '행사 자료.hwpx', size: 2048, contentType: 'application/hwp+zip' }).safeName,
    '행사_자료.hwpx',
  )
})

test('native uploads require matching extension and canonical MIME at the server boundary', () => {
  for (const name of ['renamed.png', 'payload.exe', 'file.constructor', 'file.__proto__', 'without-extension']) {
    assert.throws(() => validateUploadDescriptor({ name, size: 10, contentType: 'application/pdf' }))
  }
  assert.throws(() => validateUploadDescriptor({ name: 'document.pdf', size: 10, contentType: '' }))
  assert.throws(() => validateUploadDescriptor({ name: 'document.docx', size: 10, contentType: 'application/zip' }))
  assert.equal(validateUploadDescriptor({ name: 'document.PDF', size: 10, contentType: 'application/pdf' }).contentType, 'application/pdf')
  assert.equal(validateUploadDescriptor({ name: 'notes.md', size: 10, contentType: 'text/markdown' }).contentType, 'text/markdown')
  assert.throws(() => validateUploadDescriptor({ name: 'notes.md', size: 10, contentType: 'text/plain' }))
})

test('quarantine cannot become approved or published before a clean scan', () => {
  assert.equal(transitionSubmission('draft', 'submit', 'pending'), 'review_queued')
  assert.throws(() => transitionSubmission('review_queued', 'approve', 'pending'), (error: SubmissionPolicyError) => error.code === 'scan_required')
  assert.equal(transitionSubmission('review_queued', 'approve', 'clean'), 'approved')
  assert.equal(transitionSubmission('approved', 'publish', 'clean'), 'published')
})

test('downloads require publication, download rights and visibility eligibility', () => {
  assert.equal(canDownload({ status: 'published', visibility: 'public', signedIn: false, redistribution: 'download_allowed' }), true)
  assert.equal(canDownload({ status: 'published', visibility: 'member_only', signedIn: false, redistribution: 'download_allowed' }), false)
  assert.equal(canDownload({ status: 'published', visibility: 'member_only', signedIn: true, redistribution: 'download_allowed' }), true)
  assert.equal(canDownload({ status: 'published', visibility: 'public', signedIn: true, redistribution: 'view_only' }), false)
  assert.equal(canDownload({ status: 'approved', visibility: 'public', signedIn: true, redistribution: 'download_allowed' }), false)
})

test('previews follow publication and visibility without granting original download rights', () => {
  assert.equal(canPreview({ status: 'published', visibility: 'public', signedIn: false }), true)
  assert.equal(canPreview({ status: 'published', visibility: 'member_only', signedIn: false }), false)
  assert.equal(canPreview({ status: 'published', visibility: 'member_only', signedIn: true }), true)
  assert.equal(canPreview({ status: 'approved', visibility: 'public', signedIn: true }), false)
})
