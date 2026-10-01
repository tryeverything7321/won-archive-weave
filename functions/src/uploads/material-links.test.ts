import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activityMaterialLinkCommandKey,
  activityMaterialIds,
  boundedMaterialLinkImpact,
  assertActivityMaterialLinkOwner,
  assertLinkableMaterial,
  assertTotalMaterialLinkLimit,
  validateActivityMaterialLinks,
} from './material-links.js'

test('material link input deduplicates in order and stays bounded', () => {
  assert.deepEqual(validateActivityMaterialLinks({
    activityId: 'activity-123',
    materialIds: [' material-a ', 'material-b', 'material-a'],
    requestId: 'request_12345678',
  }), {
    activityId: 'activity-123',
    materialIds: ['material-a', 'material-b'],
    requestId: 'request_12345678',
  })
  assert.throws(() => validateActivityMaterialLinks({
    activityId: 'activity-123',
    materialIds: Array.from({ length: 31 }, (_, index) => `material-${index}`),
    requestId: 'request_12345678',
  }), { code: 'invalid-argument' })
  assert.throws(() => validateActivityMaterialLinks({
    activityId: 'activity-123', materialIds: ['../private'], requestId: 'request_12345678',
  }), { code: 'invalid-argument' })
})

test('only the activity owner or an administrator can replace links', () => {
  assert.doesNotThrow(() => assertActivityMaterialLinkOwner({ status: 'published' }, { ownerUid: 'owner-1' }, 'owner-1', null))
  assert.doesNotThrow(() => assertActivityMaterialLinkOwner({ status: 'published' }, { ownerUid: 'another' }, 'admin-1', 'administrator'))
  assert.throws(() => assertActivityMaterialLinkOwner({ status: 'published' }, { ownerUid: 'another' }, 'member-1', null), { code: 'permission-denied' })
  assert.throws(() => assertActivityMaterialLinkOwner({ status: 'held' }, { ownerUid: 'owner-1' }, 'owner-1', null), { code: 'failed-precondition' })
  assert.throws(() => assertActivityMaterialLinkOwner({ status: 'published' }, undefined, 'owner-1', null), { code: 'permission-denied' })
})

test('links accept only currently readable published materials', () => {
  assert.doesNotThrow(() => assertLinkableMaterial({ status: 'published', visibility: 'public' }, true))
  assert.doesNotThrow(() => assertLinkableMaterial({ status: 'published', visibility: 'member_only' }, true))
  assert.throws(() => assertLinkableMaterial({ status: 'published', visibility: 'member_only' }, false), { code: 'permission-denied' })
  assert.throws(() => assertLinkableMaterial({ status: 'unpublished', visibility: 'public' }, true), { code: 'failed-precondition' })
  assert.throws(() => assertLinkableMaterial({ status: 'published', visibility: 'hold' }, true), { code: 'failed-precondition' })
})

test('reader IDs combine new links with one legacy material without duplicates', () => {
  assert.deepEqual(activityMaterialIds({
    linkedMaterialIds: ['material-b', 'material-a', 'material-b', '../unsafe'],
    materialId: 'material-a',
  }), ['material-b', 'material-a'])
  assert.deepEqual(activityMaterialIds({ materialId: 'legacy-material' }), ['legacy-material'])
})

test('thirty-reference limit includes the preserved legacy material', () => {
  assert.doesNotThrow(() => assertTotalMaterialLinkLimit(['legacy', ...Array.from({ length: 29 }, (_, index) => `extra-${index}`)], 'legacy'))
  assert.throws(() => assertTotalMaterialLinkLimit(Array.from({ length: 30 }, (_, index) => `extra-${index}`), 'legacy'), { code: 'invalid-argument' })
})

test('material link retry key is deterministic and actor scoped', () => {
  assert.equal(activityMaterialLinkCommandKey('owner-1', 'request_12345678'), activityMaterialLinkCommandKey('owner-1', 'request_12345678'))
  assert.notEqual(activityMaterialLinkCommandKey('owner-1', 'request_12345678'), activityMaterialLinkCommandKey('owner-2', 'request_12345678'))
})

test('material link impact deduplicates both schemas and caps disclosure at 100', () => {
  assert.deepEqual(boundedMaterialLinkImpact(['a', 'b'], ['b', 'c']), { linkedActivityCount: 3, hasMore: false })
  const many = Array.from({ length: 101 }, (_, index) => `activity-${index}`)
  assert.deepEqual(boundedMaterialLinkImpact(many, []), { linkedActivityCount: 100, hasMore: true })
})
