import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'
import { createCommunityComment, createCommunityPost } from './posts.js'
import {
  communityWriteFingerprint,
  communityWriteRequestKey,
  communityWriteThrottle,
  validateCommunityWriteRequestId,
} from './write-requests.js'

test('community write requests have bounded opaque identifiers and payload fingerprints', () => {
  assert.equal(validateCommunityWriteRequestId('request_12345678'), 'request_12345678')
  assert.throws(() => validateCommunityWriteRequestId('../same'))
  assert.equal(communityWriteRequestKey('member-1', 'post', 'request_12345678').length, 40)
  assert.notEqual(
    communityWriteRequestKey('member-1', 'post', 'request_12345678'),
    communityWriteRequestKey('member-1', 'comment', 'request_12345678'),
  )
  assert.equal(communityWriteFingerprint({ body: '같은 글' }), communityWriteFingerprint({ body: '같은 글' }))
  assert.notEqual(communityWriteFingerprint({ body: '같은 글' }), communityWriteFingerprint({ body: '다른 글' }))
})

test('per-member write throttles preserve normal requests and return a bounded wait', () => {
  assert.deepEqual(communityWriteThrottle({ kind: 'post', previousAtMs: undefined, nowMs: 10_000 }), {
    allowed: true, nextAllowedAtMs: 20_000,
  })
  assert.deepEqual(communityWriteThrottle({ kind: 'post', previousAtMs: 10_000, nowMs: 12_001 }), {
    allowed: false, retryAfterSeconds: 8,
  })
  assert.deepEqual(communityWriteThrottle({ kind: 'comment', previousAtMs: 10_000, nowMs: 13_000 }), {
    allowed: true, nextAllowedAtMs: 16_000,
  })
})

test('Firestore transaction makes post and comment retries idempotent and throttles distinct writes', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  const uid = `write-${randomUUID()}`
  const firestore = getFirestore()
  await firestore.collection('users').doc(uid).set({
    connected: true,
    termsVersion: '2026-07-20',
    communityRulesVersion: '2026-07-20',
    pseudonym: '합성 이용자',
    provider: 'kakao',
  })
  const auth = { uid, token: {} }
  const postData = {
    requestId: `post_${randomUUID()}`,
    body: '동일한 요청은 하나의 글만 만듭니다',
    purpose: '생각 나눔',
  }
  const [first, replay] = await Promise.all([
    createCommunityPost.run({ auth, data: postData } as never),
    createCommunityPost.run({ auth, data: postData } as never),
  ])
  assert.equal(first.postId, replay.postId)
  assert.equal((await firestore.collection('communityPosts').where('body', '==', postData.body).get()).size, 1)
  await assert.rejects(
    createCommunityPost.run({ auth, data: { ...postData, body: '같은 번호의 다른 글' } } as never),
    (error: { code?: string }) => error.code === 'already-exists',
  )
  await assert.rejects(
    createCommunityPost.run({ auth, data: { ...postData, requestId: `post_${randomUUID()}` } } as never),
    (error: { code?: string; details?: { retryAfterSeconds?: number } }) =>
      error.code === 'resource-exhausted' && Number(error.details?.retryAfterSeconds) >= 1,
  )

  const commentData = {
    requestId: `comment_${randomUUID()}`,
    postId: first.postId,
    body: '댓글 재시도도 한 번만 반영됩니다',
  }
  const [comment, commentReplay] = await Promise.all([
    createCommunityComment.run({ auth, data: commentData } as never),
    createCommunityComment.run({ auth, data: commentData } as never),
  ])
  assert.equal(comment.commentId, commentReplay.commentId)
  assert.equal((await firestore.collection('communityPosts').doc(first.postId).get()).get('commentCount'), 1)
})
