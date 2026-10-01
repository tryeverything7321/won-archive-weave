import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as contracts from '../functions/lib/uploads/contracts.js'
import * as access from '../functions/lib/uploads/attachment-access.js'
import * as format from '../functions/lib/uploads/preview-format.js'
import * as conversion from '../functions/lib/uploads/document-preview.js'
import * as moderation from '../functions/lib/uploads/content-moderation.js'
import * as attestation from '../functions/lib/uploads/scan-attestation.js'
import * as disposition from '../functions/lib/uploads/download-disposition.js'
const source = ts.transpileModule(readFileSync(new URL('../functions/src/uploads/downloads.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(data, bytes = Buffer.from('이름,내용\n위브,검증'), latest = data) {
  const calls = []
  let reads = 0
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
  const modules = {
    'firebase-admin/app': { getApps: () => [{}] },
    'firebase-admin/firestore': { getFirestore: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => reads++ === 0 ? data : latest }) }) }) }) },
    'firebase-admin/storage': { getStorage: () => ({ bucket: () => ({ file: (path, version) => ({
      getSignedUrl: async options => { calls.push({ path, options, version }); return ['https://storage.googleapis.com/synthetic/doc'] },
      download: async options => { calls.push({ range: options }); return [bytes] },
      getMetadata: async () => [{ size: bytes.length, generation: '123' }],
      exists: async () => [false],
      save: async (_, options) => { calls.push({ saved: path, options }) },
      delete: async () => { calls.push({ deleted: path }) },
    }) }) }) },
    'firebase-functions/v2/https': { HttpsError, onCall: (_, fn) => fn },
    '../community/actor-policy.js': { requireActorPolicy: auth => { if (!auth?.uid) throw new HttpsError('permission-denied', 'member'); return { uid: auth.uid } } },
    './contracts.js': contracts, './attachment-access.js': access, './preview-format.js': format,
    './content-moderation.js': moderation, './scan-attestation.js': attestation,
    './download-disposition.js': disposition,
    './upload-selection.js': { selectedUploadNames: () => { throw Error('Unexpected private selection in public preview') } },
    './submissions.js': { publishCleanUploadSubmission: () => { throw Error('Unexpected private repair in public preview') } },
    './document-preview.js': { ...conversion, convertDocument: async (_, type) => { calls.push({ converted: type }); return Buffer.from('%PDF-synthetic') } },
  }
  const exports = {}
  vm.runInNewContext(source, { exports, Date, require: name => { if (!modules[name]) throw Error(name); return modules[name] } })
  return { run: auth => exports.createApprovedPreview({ data: { materialId: 'synthetic' }, auth }), download: auth => exports.createApprovedDownload({ data: { materialId: 'synthetic' }, auth }), calls }
}
const base = { status: 'published', visibility: 'public', attachmentStatus: 'clean', rights: { redistribution: 'download_allowed' }, approvedStoragePath: 'managed/original.pdf' }
const scanned = data => ({ ...data, approvedStorageObjects: [data.approvedStoragePath, data.previewStoragePath].filter(Boolean).map(path => ({ path, generation: '123' })) })
test('public download uses UTF-8 attachment disposition and exact clean generation', async () => {
  const h = harness(scanned({ ...base, approvedStoragePath: 'managed/id/012345abcdef-회의록.txt' }))
  await h.download()
  assert.equal(h.calls[0].version.generation, '123')
  assert.equal(h.calls[0].options.version, 'v4')
  assert.match(h.calls[0].options.responseDisposition, /^attachment;/)
  assert.ok(h.calls[0].options.responseDisposition.includes(encodeURIComponent('회의록.txt')))
  assert.ok(h.calls[0].options.expires <= Date.now() + 300_000)
})
test('download headers never bypass rights, current publication or member access', async () => {
  for (const data of [{ ...base, rights: { redistribution: 'view_only' } }, { ...base, attachmentStatus: 'pending' }, { ...base, status: 'withdrawn' }, { ...base, visibility: 'member_only' }]) {
    const h = harness(scanned(data))
    await assert.rejects(h.download())
    assert.equal(h.calls.length, 0)
  }
})
test('native PDF and images use existing download permission', async () => {
  for (const [ext, expected] of [['pdf', 'pdf'], ['jpg', 'image'], ['png', 'image'], ['webp', 'image']]) {
    const h = harness(scanned({ ...base, approvedStoragePath: 'managed/source.' + ext }))
    assert.equal((await h.run()).renderFormat, expected)
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0].version.generation, '123')
  }
})
test('native preview does not widen view-only rights and requires clean/current publication', async () => {
  for (const data of [{ ...base, rights: { redistribution: 'view_only' } }, { ...base, attachmentStatus: 'pending' }, { ...base, attachmentStatus: 'blocked' }, { ...base, status: 'withdrawn' }, { ...base, visibility: 'hold' }]) {
    const h = harness(scanned(data))
    await assert.rejects(h.run())
    assert.equal(h.calls.length, 0)
  }
})
test('member-only preview requires eligible authentication and keeps derivative support', async () => {
  const h = harness(scanned({ ...base, visibility: 'member_only', previewStoragePath: 'managed/preview.pdf', rights: { redistribution: 'view_only' } }))
  await assert.rejects(h.run())
  assert.equal((await h.run({ uid: 'synthetic-member' })).renderFormat, 'pdf')
  assert.equal(h.calls[0].path, 'managed/preview.pdf')
})
test('text and CSV reads are bounded and never execute cell content', async () => {
  for (const ext of ['txt', 'md', 'csv']) {
    const h = harness(scanned({ ...base, approvedStoragePath: 'managed/source.' + ext }))
    const result = await h.run()
    assert.equal(result.renderFormat, ext === 'csv' ? 'csv' : 'text')
    assert.match(result.text, /위브/)
    assert.equal(h.calls[1].range.end, 512 * 1024)
  }
})
test('Office and HWP previews use derivatives and preserve view-only source restrictions', async () => {
  for (const ext of ['hwp', 'hwpx', 'docx', 'pptx', 'xlsx']) {
    const h = harness(scanned({ ...base, rights: { redistribution: 'view_only' }, approvedStoragePath: 'managed/source.' + ext }))
    assert.equal((await h.run()).renderFormat, 'pdf')
    assert.ok(h.calls.some(c => c.converted === ext))
    assert.ok(h.calls.some(c => c.path?.startsWith('document-previews-v1/synthetic/')))
    assert.equal(h.calls.filter(c => c.path === 'managed/source.' + ext).length, 0)
  }
  await assert.rejects(harness(scanned({ ...base, rights: { redistribution: 'source_link_only' }, approvedStoragePath: 'managed/source.hwp' })).run())
})
test('publication changes during conversion revoke the pending derivative response', async () => {
  const original = scanned({ ...base, approvedStoragePath: 'managed/source.docx' })
  for (const changed of [{ ...original, status: 'withdrawn' }, { ...original, visibility: 'hold' }, { ...original, attachmentStatus: 'blocked' }, { ...original, approvedStoragePath: 'other.docx' }, { ...original, visibility: 'member_only' }]) {
    const h = harness(original, Buffer.from('synthetic'), changed)
    await assert.rejects(h.run())
    assert.equal(h.calls.filter(c => c.path).length, 0)
  }
})
test('clean label alone cannot authorize an unscanned or ambiguous object generation', async () => {
  for (const approvedStorageObjects of [undefined, [], [{ path: base.approvedStoragePath, generation: '' }], [{ path: 'other.pdf', generation: '123' }], [{ path: base.approvedStoragePath, generation: '123' }, { path: base.approvedStoragePath, generation: '124' }]]) {
    const h = harness({ ...base, approvedStorageObjects })
    await assert.rejects(h.run())
    assert.equal(h.calls.length, 0)
  }
})
test('UTF-8 boundary and invalid encoding are explicit', () => {
  const bytes = Buffer.concat([Buffer.alloc(512 * 1024 - 1, 65), Buffer.from('한')])
  assert.equal(format.decodePreviewText(bytes).truncated, true)
  assert.throws(() => format.decodePreviewText(Buffer.from([255, 255])))
})
