import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CommunityPolicyError,
  createAppeal,
  deleteContent,
  editContent,
  isUrgentReport,
  moderateContent,
  planCommunityModeration,
  publicCommunityRecord,
} from './policy.js'

test('only an author can edit or delete active content', () => {
  assert.deepEqual(editContent({ authorUid: 'a', actorUid: 'a', status: 'active' }, '  고친 생각  '), { body: '고친 생각', status: 'active' })
  assert.equal(deleteContent({ authorUid: 'a', actorUid: 'a', status: 'held' }), 'deleted')
  assert.throws(() => editContent({ authorUid: 'a', actorUid: 'b', status: 'active' }, '고친 생각'), (error: CommunityPolicyError) => error.code === 'not_author')
})

test('an administrator can edit, hide, restore, and delete any non-deleted content', () => {
  assert.deepEqual(
    editContent({ authorUid: 'author', actorUid: 'admin', status: 'held', administrator: true }, '  운영자가 고친 글  '),
    { body: '운영자가 고친 글', status: 'held' },
  )
  assert.equal(
    moderateContent({ status: 'active', action: 'hold', authorUid: 'admin', moderatorUid: 'admin', administrator: true }),
    'held',
  )
  assert.equal(
    moderateContent({ status: 'held', action: 'restore', authorUid: 'admin', moderatorUid: 'admin', administrator: true }),
    'active',
  )
  assert.equal(
    deleteContent({ authorUid: 'author', actorUid: 'admin', status: 'removed', administrator: true }),
    'deleted',
  )
})

test('personal data and crisis reports trigger immediate hold policy', () => {
  assert.equal(isUrgentReport('personal_data'), true)
  assert.equal(isUrgentReport('crisis'), true)
  assert.equal(isUrgentReport('harassment'), false)
})

test('moderation transitions reject moderator self-action and impossible restores', () => {
  assert.equal(moderateContent({ status: 'active', action: 'hold', authorUid: 'a', moderatorUid: 'm' }), 'held')
  assert.equal(moderateContent({ status: 'held', action: 'remove', authorUid: 'a', moderatorUid: 'm' }), 'removed')
  assert.equal(moderateContent({ status: 'removed', action: 'restore', authorUid: 'a', moderatorUid: 'm' }), 'active')
  assert.throws(() => moderateContent({ status: 'active', action: 'hold', authorUid: 'a', moderatorUid: 'a' }), (error: CommunityPolicyError) => error.code === 'self_moderation')
  assert.throws(() => moderateContent({ status: 'active', action: 'restore', authorUid: 'a', moderatorUid: 'm' }), (error: CommunityPolicyError) => error.code === 'invalid_transition')
})

test('warning and correction requests keep active content visible', () => {
  assert.deepEqual(planCommunityModeration({
    status: 'active',
    action: 'warn',
    authorUid: 'author',
    moderatorUid: 'moderator',
    hasPriorGuidance: false,
  }), { status: 'active', changesVisibility: false, consumesGuidance: false })
  assert.deepEqual(planCommunityModeration({
    status: 'active',
    action: 'request_correction',
    authorUid: 'author',
    moderatorUid: 'moderator',
    hasPriorGuidance: false,
  }), { status: 'active', changesVisibility: false, consumesGuidance: false })
})

test('removal requires a prior successful warning or correction request', () => {
  assert.throws(() => planCommunityModeration({
    status: 'active',
    action: 'remove',
    authorUid: 'author',
    moderatorUid: 'moderator',
    hasPriorGuidance: false,
  }), (error: CommunityPolicyError) => error.code === 'notice_required')
  assert.deepEqual(planCommunityModeration({
    status: 'active',
    action: 'remove',
    authorUid: 'author',
    moderatorUid: 'moderator',
    hasPriorGuidance: true,
  }), { status: 'removed', changesVisibility: true, consumesGuidance: true })
})

test('emergency hold remains immediate and restore consumes stale guidance', () => {
  assert.deepEqual(planCommunityModeration({
    status: 'active',
    action: 'hold',
    authorUid: 'author',
    moderatorUid: 'moderator',
    hasPriorGuidance: false,
  }), { status: 'held', changesVisibility: true, consumesGuidance: false })
  assert.deepEqual(planCommunityModeration({
    status: 'held',
    action: 'restore',
    authorUid: 'author',
    moderatorUid: 'moderator',
    hasPriorGuidance: true,
  }), { status: 'active', changesVisibility: true, consumesGuidance: true })
})

test('hidden emergency content can receive a correction request before removal', () => {
  assert.deepEqual(planCommunityModeration({
    status: 'held',
    action: 'request_correction',
    authorUid: 'author',
    moderatorUid: 'moderator',
    hasPriorGuidance: false,
  }), { status: 'held', changesVisibility: false, consumesGuidance: false })
})

test('appeals belong to the author and only follow a hold or removal', () => {
  assert.deepEqual(createAppeal({ authorUid: 'a', actorUid: 'a', status: 'removed', reason: '맥락을 다시 확인해 주세요' }), { status: 'received', reason: '맥락을 다시 확인해 주세요' })
  assert.throws(() => createAppeal({ authorUid: 'a', actorUid: 'a', status: 'active', reason: '맥락을 다시 확인해 주세요' }), (error: CommunityPolicyError) => error.code === 'appeal_not_allowed')
})

test('ordinary community records omit account and operator identifiers', () => {
  assert.deepEqual(publicCommunityRecord({ id: 'p1', pseudonym: '물결', authorUid: 'secret', moderatorUid: 'operator' }), { id: 'p1', pseudonym: '물결' })
})
