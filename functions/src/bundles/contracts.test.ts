import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canReadMaterialBundle,
  canReadMaterialBundleFile,
  maximumBundleBytes,
  normalizeBundleFiles,
  projectMaterialBundle,
  stableBundleFileId,
  type MaterialBundleRecord,
} from './contracts.js'

const descriptor = (index: number, size = 1_024) => ({
  clientFileId: `client-file-${index}`,
  name: `발표자료-${index}.pptx`,
  displayName: `${index}부 발표자료`,
  order: index,
  size,
  contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  sha256: String(index).padStart(64, 'a').slice(-64).replace(/[^a-f0-9]/g, 'a'),
})

test('six presentation files remain separate ordered files in one normalized bundle request', () => {
  const files = normalizeBundleFiles(Array.from({ length: 6 }, (_, index) => descriptor(index)))
  assert.equal(files.length, 6)
  assert.deepEqual(files.map((file) => file.order), [0, 1, 2, 3, 4, 5])
  assert.equal(new Set(files.map((file) => file.clientFileId)).size, 6)
})

test('bundle limits reject eleven files, a file over 20MiB and malformed hashes', () => {
  assert.throws(() => normalizeBundleFiles(Array.from({ length: 11 }, (_, index) => descriptor(index))))
  assert.throws(() => normalizeBundleFiles([{ ...descriptor(1), size: 20 * 1024 * 1024 + 1 }]))
  assert.throws(() => normalizeBundleFiles([{ ...descriptor(1), sha256: 'not-a-hash' }]))
  assert.equal(maximumBundleBytes, 100 * 1024 * 1024)
})

test('stable file ids do not change across a failed file retry', () => {
  const before = stableBundleFileId('member-1', 'bundle-1', 'client-file-1')
  const after = stableBundleFileId('member-1', 'bundle-1', 'client-file-1')
  assert.equal(before, after)
})

test('public projection omits pending, blocked and withdrawn file names while owner projection preserves management state', () => {
  const base = {
    clientFileId: 'client-file-1', revision: 1, originalName: 'secret.pptx', displayName: '비공개 파일', order: 0,
    sizeBytes: 100, contentType: descriptor(1).contentType, sha256: 'a'.repeat(64), updatedAtMs: 1,
  }
  const bundle: MaterialBundleRecord = {
    ownerUid: 'owner', title: '묶음', description: '', visibility: 'public', status: 'active', eventId: null,
    rights: {
      source: '청년회', owner: '청년회', attribution: '청년회', redistribution: 'view_only', consentBasis: '제작자 허락',
      sensitiveDataReviewed: true, retention: 'managed', reviewDueAtMs: 10,
    },
    files: {
      ready: { ...base, fileId: 'ready', status: 'ready', scanStatus: 'clean' },
      pending: { ...base, fileId: 'pending', originalName: 'pending-secret.pptx', status: 'scanning', scanStatus: 'pending' },
      withdrawn: { ...base, fileId: 'withdrawn', originalName: 'withdrawn-secret.pptx', status: 'withdrawn', scanStatus: 'clean' },
    },
    createdAtMs: 1, updatedAtMs: 1,
  }
  const publicValue = projectMaterialBundle('bundle-id', bundle)
  assert.deepEqual(publicValue.files.map((file) => file.fileId), ['ready'])
  assert.equal(publicValue.fileCount, 1)
  assert.equal(publicValue.readyFileCount, 1)
  assert.equal(projectMaterialBundle('bundle-id', bundle, true).files.length, 3)
})

test('bundle and file reads require current bundle visibility plus clean ready file state', () => {
  const bundle = { ownerUid: 'owner', visibility: 'member_only' as const, status: 'active' as const }
  assert.equal(canReadMaterialBundle(bundle, {}), false)
  assert.equal(canReadMaterialBundle(bundle, { uid: 'member', activeMember: true }), true)
  assert.equal(canReadMaterialBundle({ ...bundle, status: 'withdrawn' }, { uid: 'member', activeMember: true }), false)
  assert.equal(canReadMaterialBundleFile(bundle, { status: 'scanning', scanStatus: 'pending' }, { uid: 'member', activeMember: true }), false)
  assert.equal(canReadMaterialBundleFile(bundle, { status: 'ready', scanStatus: 'clean' }, { uid: 'member', activeMember: true }), true)
})
