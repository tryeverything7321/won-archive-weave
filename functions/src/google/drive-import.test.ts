import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GOOGLE_IMPORT_MAX_BYTES,
  GoogleDriveContractError,
  buildGoogleDriveSourceLink,
  googleDriveSourceFingerprint,
  googleDriveRevisionKey,
  parseGoogleDriveSourceLink,
  validateGoogleImportSize,
  validateGooglePickerMetadata,
  type GooglePickerMetadata,
} from './drive-import.js'

const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
const modifiedTime = '2026-07-22T01:02:03.000Z'

test('normalizes approved Drive and Docs source links', () => {
  assert.deepEqual(parseGoogleDriveSourceLink(`https://drive.google.com/file/d/${fileId}/view?usp=sharing`), {
    fileId,
    sourceKind: 'file',
    sourceUrl: `https://drive.google.com/file/d/${fileId}/view`,
  })
  assert.equal(parseGoogleDriveSourceLink(`https://drive.google.com/open?id=${fileId}`).fileId, fileId)
  assert.deepEqual(parseGoogleDriveSourceLink(`https://docs.google.com/spreadsheets/d/${fileId}/edit#gid=0`), {
    fileId,
    sourceKind: 'spreadsheet',
    sourceUrl: `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
  })
})

test('rejects protocol, host, userinfo, port, shape and identifier bypasses', () => {
  const rejected = [
    `http://drive.google.com/file/d/${fileId}/view`,
    `https://drive.google.com.evil.example/file/d/${fileId}/view`,
    `https://drive.google.com@evil.example/file/d/${fileId}/view`,
    `https://user@drive.google.com/file/d/${fileId}/view`,
    `https://drive.google.com:8443/file/d/${fileId}/view`,
    `https://drive.google.com/drive/folders/${fileId}`,
    `https://docs.google.com/forms/d/${fileId}/edit`,
    `https://drive.google.com/open?id=${fileId}&id=${fileId}`,
    'https://drive.google.com/file/d/too-short/view',
    `https://drive.google.com/file/d/${fileId}%2Fescape/view`,
  ]
  for (const value of rejected) {
    assert.throws(() => parseGoogleDriveSourceLink(value), (error: GoogleDriveContractError) => error.code === 'invalid_url' || error.code === 'invalid_file_id')
  }
})

test('source descriptor never assumes public access and remains source-link only', () => {
  const source = buildGoogleDriveSourceLink(`https://docs.google.com/document/d/${fileId}/edit`)
  assert.equal(source.redistribution, 'source_link_only')
  assert.equal(source.retention, 'source_link')
  assert.equal(source.publicAccessVerified, false)
})

test('source fingerprints require the exact canonical descriptor', () => {
  const source = buildGoogleDriveSourceLink(`https://docs.google.com/document/d/${fileId}/edit`)
  assert.equal(googleDriveSourceFingerprint(source), googleDriveSourceFingerprint({ ...source }))
  assert.throws(
    () => googleDriveSourceFingerprint({ ...source, sourceUrl: `${source.sourceUrl}?usp=sharing` }),
    (error: GoogleDriveContractError) => error.code === 'invalid_metadata',
  )
})

function blob(overrides: Partial<GooglePickerMetadata> = {}): GooglePickerMetadata {
  return {
    fileId,
    name: '청년 정기훈련 자료.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1_024,
    modifiedTime,
    webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
    thumbnailUrl: 'https://lh3.googleusercontent.com/drive-thumb',
    ...overrides,
  }
}

test('validates blob metadata and enforces MIME and maximum size', () => {
  const validated = validateGooglePickerMetadata(blob())
  assert.equal(validated.isNativeGoogleFile, false)
  assert.equal(validated.requiresExportSizeCheck, false)
  assert.equal(validated.sourceKind, 'file')
  assert.throws(() => validateGooglePickerMetadata(blob({ sizeBytes: GOOGLE_IMPORT_MAX_BYTES + 1 })), (error: GoogleDriveContractError) => error.code === 'invalid_size')
  assert.throws(() => validateGooglePickerMetadata(blob({ mimeType: 'application/zip' })), (error: GoogleDriveContractError) => error.code === 'unsupported_mime')
  assert.throws(() => validateGooglePickerMetadata(blob({ exportFormat: 'application/pdf' })), (error: GoogleDriveContractError) => error.code === 'invalid_export')
})

test('validates native Google exports and requires a post-export size check', () => {
  const document = validateGooglePickerMetadata(blob({
    mimeType: 'application/vnd.google-apps.document',
    sizeBytes: undefined,
    exportFormat: 'application/pdf',
    webViewLink: `https://docs.google.com/document/d/${fileId}/edit`,
  }))
  assert.equal(document.sourceKind, 'document')
  assert.equal(document.isNativeGoogleFile, true)
  assert.equal(document.requiresExportSizeCheck, true)
  assert.equal(validateGoogleImportSize(GOOGLE_IMPORT_MAX_BYTES), GOOGLE_IMPORT_MAX_BYTES)
  assert.throws(() => validateGoogleImportSize(GOOGLE_IMPORT_MAX_BYTES + 1), (error: GoogleDriveContractError) => error.code === 'invalid_size')
  assert.throws(() => validateGooglePickerMetadata(blob({
    mimeType: 'application/vnd.google-apps.document',
    sizeBytes: undefined,
    exportFormat: 'text/csv',
    webViewLink: `https://docs.google.com/document/d/${fileId}/edit`,
  })), (error: GoogleDriveContractError) => error.code === 'invalid_export')
})

test('rejects mismatched file links and untrusted thumbnail hosts', () => {
  assert.throws(() => validateGooglePickerMetadata(blob({
    webViewLink: 'https://drive.google.com/file/d/2ZyXwVuTsRqPoNmLkJiHgFeDcBa/view',
  })), (error: GoogleDriveContractError) => error.code === 'invalid_metadata')
  assert.throws(() => validateGooglePickerMetadata(blob({
    thumbnailUrl: 'https://example.com/thumbnail.jpg',
  })), (error: GoogleDriveContractError) => error.code === 'invalid_metadata')
})

test('revision keys deduplicate the same revision and change with time or export format', () => {
  const first = googleDriveRevisionKey({ fileId, modifiedTime, exportFormat: 'application/pdf' })
  const duplicate = googleDriveRevisionKey({ fileId, modifiedTime, exportFormat: 'application/pdf' })
  const newer = googleDriveRevisionKey({ fileId, modifiedTime: '2026-07-22T02:02:03.000Z', exportFormat: 'application/pdf' })
  const docx = googleDriveRevisionKey({ fileId, modifiedTime, exportFormat: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  assert.equal(first, duplicate)
  assert.notEqual(first, newer)
  assert.notEqual(first, docx)
})
