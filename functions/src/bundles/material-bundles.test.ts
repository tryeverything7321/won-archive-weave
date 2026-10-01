import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { getFirestore } from 'firebase-admin/firestore'
import {
  createMaterialBundle,
  createMaterialBundleFileAccess,
  finalizeMaterialBundle,
  getMaterialBundle,
  prepareMaterialBundleFiles,
  recordMaterialBundleScanFailure,
  recordMaterialBundleScanResult,
  recordUploadedMaterialBundleObject,
} from './material-bundles.js'

const contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const rights = {
  source: '전국 청년회', owner: '전국 청년회', attribution: '전국 청년회', redistribution: 'view_only' as const,
  consentBasis: '제작자에게 게시 허락을 받음', sensitiveDataReviewed: true, retention: 'managed' as const,
  reviewDueAtMs: Date.now() + 86_400_000,
}

test('six-file bundle keeps five clean files when only the failed file is retried', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  const firestore = getFirestore()
  const uid = `bundle-${randomUUID()}`
  const auth = { uid, token: {} }
  await firestore.collection('users').doc(uid).set({ connected: true, termsVersion: '2026-07-20', communityRulesVersion: '2026-07-20' })
  const created = await createMaterialBundle.run({ auth, data: {
    requestId: `create_${randomUUID()}`, title: '2026 청년 포럼 발표자료', description: '', visibility: 'public', rights,
  } } as never)
  const files = Array.from({ length: 6 }, (_, index) => ({
    clientFileId: `pptx-file-${index}`, name: `발표-${index + 1}.pptx`, displayName: `발표 ${index + 1}`, order: index,
    size: 1_024 + index, contentType, sha256: String(index + 1).repeat(64).slice(0, 64),
  }))
  const requestId = `prepare_${randomUUID()}`
  const prepared = await prepareMaterialBundleFiles.run({ auth, data: { bundleId: created.bundleId, requestId, files } } as never)
  assert.equal(prepared.files.length, 6)
  const replay = await prepareMaterialBundleFiles.run({ auth, data: { bundleId: created.bundleId, requestId, files } } as never)
  assert.equal(replay.reservationId, prepared.reservationId)
  await finalizeMaterialBundle.run({ auth, data: { bundleId: created.bundleId, requestId: `finalize_${randomUUID()}` } } as never)

  await assert.rejects(
    createMaterialBundleFileAccess.run({ auth: undefined, data: { bundleId: created.bundleId, fileId: prepared.files[0]?.fileId, action: 'preview' } } as never),
    (error: { code?: string }) => error.code === 'permission-denied',
  )

  for (const [index, file] of prepared.files.entries()) {
    const generation = String(1_000 + index)
    const accepted = await recordUploadedMaterialBundleObject({
      ownerUid: uid, bundleId: created.bundleId, fileId: file.fileId, revision: file.revision,
      targetName: file.targetName, storagePath: file.storagePath, generation, size: files[index]!.size,
      contentType, reservationId: prepared.reservationId, requestId, sha256: files[index]!.sha256,
    })
    assert.equal(accepted, true)
    if (index < 5) {
      await recordMaterialBundleScanResult({ ownerUid: uid, bundleId: created.bundleId, fileId: file.fileId, path: file.storagePath, generation, scanId: `scan-${index}`, verdict: 'clean' })
    } else {
      await recordMaterialBundleScanFailure({ ownerUid: uid, bundleId: created.bundleId, fileId: file.fileId, path: file.storagePath, generation, code: 'synthetic_scanner_failure' })
    }
  }
  const beforeRetry = await getMaterialBundle.run({ auth, data: { bundleId: created.bundleId } } as never)
  assert.equal(beforeRetry.readyFileCount, 5)
  assert.equal(beforeRetry.files.filter((file) => file.status === 'ready').length, 5)
  const failed = beforeRetry.files.find((file) => file.status === 'error')!
  const retryRequestId = `retry_${randomUUID()}`
  const retried = await prepareMaterialBundleFiles.run({ auth, data: {
    bundleId: created.bundleId, requestId: retryRequestId,
    files: [{ ...files[5], replaceFileId: failed.fileId, sha256: 'a'.repeat(64) }],
  } } as never)
  assert.equal(retried.files[0]?.fileId, failed.fileId)
  assert.equal(retried.files[0]?.revision, failed.revision + 1)
  const afterRetry = await getMaterialBundle.run({ auth, data: { bundleId: created.bundleId } } as never)
  assert.equal(afterRetry.files.filter((file) => file.status === 'ready').length, 5)
  assert.equal(afterRetry.files.find((file) => file.fileId === failed.fileId)?.status, 'upload_pending')
})
