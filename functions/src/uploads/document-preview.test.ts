import test from 'node:test'
import assert from 'node:assert/strict'
import { conversionFormat, previewCachePath, readConvertedPdf, MAX_PREVIEW_OUTPUT } from './document-preview.js'
import { nativePreviewFormat } from './preview-format.js'

test('conversion types and generation-bound cache keys are constrained', () => {
  for (const type of ['docx', 'pptx', 'xlsx', 'hwp', 'hwpx']) assert.equal(conversionFormat(`managed/source.${type}`), type)
  for (const type of ['exe', 'pdf', 'doc', 'xls', 'zip']) assert.equal(conversionFormat(`managed/source.${type}`), null)
  assert.notEqual(previewCachePath('item', 'source.hwp', '1'), previewCachePath('item', 'source.hwp', '2'))
  assert.notEqual(previewCachePath('item', 'source.hwp', '1'), previewCachePath('item', 'other.hwp', '1'))
  assert.throws(() => previewCachePath('../item', 'source.hwp', '1'))
  assert.throws(() => previewCachePath('item', 'source.hwp', 'NaN'))
})

test('native Markdown attachments use the bounded UTF-8 text preview', () => {
  assert.equal(nativePreviewFormat('managed/submission/notes.md'), 'text')
})

test('worker responses must be bounded PDF bytes, not an error page or redirect', async () => {
  assert.equal((await readConvertedPdf(new Response('%PDF-test', { headers: { 'content-type': 'application/pdf' } }))).toString(), '%PDF-test')
  await assert.rejects(readConvertedPdf(new Response('blocked', { status: 403 })))
  await assert.rejects(readConvertedPdf(new Response('<html/>', { headers: { 'content-type': 'application/pdf' } })))
  await assert.rejects(readConvertedPdf(new Response('%PDF-test', { headers: { 'content-type': 'text/html' } })))
  await assert.rejects(readConvertedPdf(new Response('%PDF-test', { headers: { 'content-type': 'application/pdf', 'content-length': String(MAX_PREVIEW_OUTPUT + 1) } })))
})
