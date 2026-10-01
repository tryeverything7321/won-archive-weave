import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import * as contracts from '../functions/lib/uploads/contracts.js'
import * as access from '../functions/lib/uploads/attachment-access.js'
import * as format from '../functions/lib/uploads/preview-format.js'
import * as conversion from '../functions/lib/uploads/document-preview.js'
import * as moderation from '../functions/lib/uploads/content-moderation.js'
import * as attestation from '../functions/lib/uploads/scan-attestation.js'
import * as disposition from '../functions/lib/uploads/download-disposition.js'

const source = ts.transpileModule(readFileSync(new URL('../functions/src/uploads/downloads.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const selectionCode = ts.transpileModule(readFileSync(new URL('../functions/src/uploads/upload-selection.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function harness(extension = 'txt', options = {}) {
  const bytes = Buffer.from('위브 자체 테스트 자료')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const calls = []
  let actorChecks = 0
  let record
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
  const modules = {
    'node:crypto': { createHash },
    'firebase-admin/app': { getApps: () => [{}] },
    'firebase-functions/v2/https': { HttpsError, onCall: (_, handler) => handler },
    'firebase-admin/firestore': { getFirestore: () => { calls.push({ database: true }); return ({ collection: () => ({ doc: () => ({ get: async () => ({
      exists: true, data: () => record, get: key => record[key],
    }) }) }) }) } },
    'firebase-admin/storage': { getStorage: () => ({ bucket: () => ({ file: (path, version) => ({
      getMetadata: async () => [{ size: bytes.length, generation: options.wrongGeneration ? '999' : '123', metadata: { weaveSha256: hash } }],
      getSignedUrl: async signedOptions => { calls.push({ signed: path, version, signedOptions }); return ['https://storage.googleapis.com/synthetic/private'] },
      download: async () => { if (options.changeOnRead) record = { ...record, ...options.changeOnRead }; return [bytes] },
      save: async () => { calls.push({ saved: path }) },
      delete: async () => { calls.push({ deleted: path }) },
    }) }) }) },
    '../community/actor-policy.js': { requireActorPolicy: auth => {
      actorChecks++
      if (!auth?.uid || (options.revokeActor && actorChecks > 1)) throw new HttpsError('permission-denied', 'actor')
      return { uid: auth.uid }
    } },
    './contracts.js': contracts, './attachment-access.js': access, './preview-format.js': format,
    './content-moderation.js': moderation, './scan-attestation.js': attestation,
    './download-disposition.js': disposition,
    './document-preview.js': { ...conversion, convertDocument: async () => {
      if (options.changeOnConversion) record = { ...record, ...options.changeOnConversion }
      return Buffer.from('%PDF-synthetic')
    } },
    './submissions.js': { publishCleanUploadSubmission: async () => { calls.push({ repair: true }) } },
  }
  const load = code => {
    const exports = {}
    vm.runInNewContext(code, { exports, Date, require: name => {
      if (!modules[name]) throw Error(name)
      return modules[name]
    } })
    return exports
  }
  const selectionModule = load(selectionCode)
  modules['./upload-selection.js'] = selectionModule
  const mime = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', pdf: 'application/pdf', png: 'image/png',
    hwp: 'application/x-hwp', hwpx: 'application/hwp+zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[extension]
  const selection = selectionModule.normalizeUploadSelection({ requestId: 'synthetic-request', files: [{ name: `sample.${extension}`, contentType: mime, size: bytes.length, sha256: hash }] })
  const path = `quarantined/synthetic-owner/synthetic-submission/${selection.files[0].targetName}`
  record = { ownerUid: 'synthetic-owner', status: 'review_queued', visibility: '보류', sourceMode: 'upload',
    scanStatus: 'clean', scanRecordedBy: 'event-driven-file-scanner', uploadSelection: selection,
    scanAttestation: { schemaVersion: 1, verdict: 'clean', provider: 'synthetic', scanId: 'synthetic-scan', engineVersion: '1',
      scannedAtMs: Date.now(), objects: [{ path, generation: '123', size: bytes.length, contentHash: `sha256:${hash}` }] },
    ...options.record,
  }
  const api = load(source)
  return { calls, run: (action = 'preview', uid = 'synthetic-owner') => api.createOwnerSubmissionAttachmentAccess({ auth: uid === null ? undefined : { uid }, data: { submissionId: 'synthetic-submission', action } }) }
}

test('missing authentication is rejected before database or storage access', async () => {
  for (const uid of [null, '']) {
    const h = harness()
    await assert.rejects(h.run('preview', uid), error => error.code === 'permission-denied')
    assert.deepEqual(h.calls, [])
  }
})

test('clean private native files open only from the attested generation', async () => {
  for (const [extension, render] of [['txt', 'text'], ['md', 'text'], ['csv', 'csv'], ['pdf', 'pdf'], ['png', 'image']]) {
    const h = harness(extension)
    const result = await h.run()
    assert.equal(result.renderFormat, render)
    assert.ok(h.calls.filter(call => call.signed).every(call => call.version.generation === '123'))
    if (render === 'text' || render === 'csv') assert.match(result.text, /자체 테스트/)
  }
})
test('Office and Korean files return private PDF derivatives', async () => {
  for (const extension of ['docx', 'pptx', 'xlsx', 'hwp', 'hwpx']) {
    const h = harness(extension)
    assert.equal((await h.run()).renderFormat, 'pdf')
    assert.ok(h.calls.some(call => call.saved?.startsWith('document-previews-v1/')))
    assert.ok(h.calls.every(call => !call.signed?.startsWith('quarantined/')))
  }
})
test('download returns a short-lived owner source URL', async () => {
  const h = harness()
  const result = await h.run('download')
  assert.equal(result.renderFormat, 'download')
  assert.equal(result.fileName, 'sample.txt')
  assert.ok(result.expiresAtMs > Date.now() && result.expiresAtMs <= Date.now() + 300_000)
  const signed = h.calls.find(call => call.signed)
  assert.equal(signed.version.generation, '123')
  assert.equal(signed.signedOptions.version, 'v4')
  assert.equal(signed.signedOptions.responseDisposition, "attachment; filename=\"sample.txt\"; filename*=UTF-8''sample.txt")
})
test('other users and public records cannot access the owner endpoint', async () => {
  for (const h of [harness('txt', { record: { ownerUid: 'another-owner' } }), harness('txt', { record: { visibility: '공개' } })]) {
    await assert.rejects(h.run())
    assert.ok(h.calls.every(call => call.database === true))
  }
})
test('withdrawn, unsafe, untrusted, moderated and mismatched objects never return a URL', async () => {
  for (const options of [{ record: { status: 'withdrawn' } }, { record: { scanStatus: 'blocked' } },
    { record: { scanStatus: 'error' } }, { record: { scanRecordedBy: 'untrusted' } },
    { record: { operatorModeration: { action: 'hold' } } }, { record: { uploadSelection: undefined } }, { wrongGeneration: true }]) {
    const h = harness('txt', options)
    await assert.rejects(h.run())
    assert.equal(h.calls.filter(call => call.signed).length, 0)
  }
})
test('withdrawal or actor revocation during conversion rejects and cleans the derivative', async () => {
  for (const options of [{ changeOnConversion: { status: 'withdrawn' } }, { revokeActor: true }, { changeOnConversion: { operatorModeration: { action: 'remove' } } }]) {
    const h = harness('docx', options)
    await assert.rejects(h.run())
    assert.ok(h.calls.some(call => call.deleted))
    assert.equal(h.calls.filter(call => call.signed).length, 0)
  }
})
test('text read rechecks current state and actor before returning content', async () => {
  for (const options of [{ changeOnRead: { status: 'withdrawn' } }, { revokeActor: true }]) {
    await assert.rejects(harness('txt', options).run())
  }
})
