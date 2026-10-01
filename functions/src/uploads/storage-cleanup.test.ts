import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanupPlanHash,
  cleanupRetryDecision,
  deleteStorageCleanupObjects,
  selectImmutableCleanupPlan,
  storageCleanupObjects,
} from './storage-cleanup.js'

test('cleanup plan includes original, preview, all approved paths and stale managed paths', () => {
  assert.deepEqual(storageCleanupObjects({
    approvedStoragePath: 'managed/submission/source.hwp',
    approvedStoragePaths: [
      'managed/submission/source.hwp',
      'managed/submission/__preview__-source.pdf',
    ],
    previewStoragePath: 'managed/submission/__preview__-source.pdf',
    staleManagedPaths: ['managed/submission/old.pdf'],
    approvedStorageObjects: [
      { path: 'managed/submission/source.hwp', generation: '17' },
      { path: 'approved/public/derived.png', generation: '3' },
    ],
  }), [
    { path: 'approved/public/derived.png', generation: '3' },
    { path: 'managed/submission/__preview__-source.pdf' },
    { path: 'managed/submission/old.pdf' },
    { path: 'managed/submission/source.hwp', generation: '17' },
  ])
})

test('stale managed cleanup keeps the publication manifest generation without resolving the live path', () => {
  assert.deepEqual(storageCleanupObjects({
    staleManagedPaths: [
      { path: 'managed/submission/old.pdf', generation: '17' },
    ],
  }), [
    { path: 'managed/submission/old.pdf', generation: '17' },
  ])
})

test('cleanup plan rejects quarantine, traversal, URL and unrelated object paths', () => {
  assert.deepEqual(storageCleanupObjects({
    approvedStoragePaths: [
      'quarantined/member/submission/file.pdf',
      '../managed/submission/file.pdf',
      'https://bucket.example/file.pdf',
      'profile-photos/member/avatar',
    ],
  }), [])
})

test('cleanup plan hash is deterministic and changes with generation', () => {
  const objects = [{ path: 'managed/submission/file.pdf', generation: '1' }]
  assert.equal(cleanupPlanHash(objects), cleanupPlanHash([...objects]))
  assert.notEqual(cleanupPlanHash(objects), cleanupPlanHash([{ ...objects[0], generation: '2' }]))
})

test('cleanup retry reuses the persisted exact generation when the path has been replaced', () => {
  const firstGeneration = [{ path: 'managed/submission/file.pdf', generation: '17' }]
  const persisted = {
    planVersion: 1,
    objects: firstGeneration,
    planHash: cleanupPlanHash(firstGeneration),
  }
  const replacementGeneration = [{ path: 'managed/submission/file.pdf', generation: '18' }]

  assert.deepEqual(selectImmutableCleanupPlan(persisted, replacementGeneration), {
    objects: firstGeneration,
    planHash: cleanupPlanHash(firstGeneration),
  })
})

test('deletion requires exact generations, is idempotent for missing objects, and reports precondition failures', async () => {
  const calls: string[] = []
  const result = await deleteStorageCleanupObjects([
    { path: 'managed/submission/a.pdf', generation: '1' },
    { path: 'managed/submission/b.pdf', generation: '2' },
    { path: 'managed/submission/no-generation.pdf' },
  ], async (object) => {
    calls.push(`${object.path}@${object.generation}`)
    if (object.path.endsWith('/b.pdf')) throw new Error('generation changed')
  })
  assert.deepEqual(calls, [
    'managed/submission/a.pdf@1',
    'managed/submission/b.pdf@2',
  ])
  assert.deepEqual(result.deleted, [{ path: 'managed/submission/a.pdf', generation: '1' }])
  assert.deepEqual(result.failed, [
    { path: 'managed/submission/b.pdf', generation: '2' },
    { path: 'managed/submission/no-generation.pdf', generation: '' },
  ])
})

test('cleanup retries are bounded and the fifth failure becomes terminal', () => {
  assert.deepEqual(cleanupRetryDecision(0, 1_000), {
    attemptCount: 1,
    terminal: false,
    nextAttemptAtMs: 301_000,
  })
  assert.deepEqual(cleanupRetryDecision(4, 1_000), {
    attemptCount: 5,
    terminal: true,
    nextAttemptAtMs: null,
  })
})
