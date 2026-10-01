import assert from 'node:assert/strict'
import test from 'node:test'
import { publicCommentRecord, publicModerationPatch, publicPostRecord } from './public-records.js'

function assertNoIdentity(record: Record<string, unknown>) {
  assert.equal('authorUid' in record, false)
  assert.equal('moderatorUid' in record, false)
  assert.equal('reporterUid' in record, false)
  assert.equal('providerSubject' in record, false)
}

test('new readable post and comment records contain a safe login provider but no account identifier', () => {
  const post = publicPostRecord({
    body: '함께 나누는 생각',
    topic: '관계와 공동체',
    purpose: '생각 나눔',
    pseudonym: '푸른 물결',
    provider: 'kakao',
    timestamp: 'server-time',
  })
  const comment = publicCommentRecord({ body: '저도 응원할게요', pseudonym: '다음 걸음', provider: 'naver', timestamp: 'server-time' })
  assert.equal(post.pseudonym, '푸른 물결')
  assert.equal(post.provider, 'kakao')
  assert.equal(post.purpose, '생각 나눔')
  assert.equal(comment.pseudonym, '다음 걸음')
  assert.equal(comment.provider, 'naver')
  assertNoIdentity(post)
  assertNoIdentity(comment)
})

test('a readable post can omit optional topic metadata', () => {
  const post = publicPostRecord({
    body: '분류하지 않고 먼저 나누는 생각',
    purpose: '생각 나눔',
    pseudonym: '푸른 물결',
    provider: 'kakao',
    timestamp: 'server-time',
  })
  assert.equal('topic' in post, false)
  assertNoIdentity(post)
})

test('readable moderation patch does not expose operator identity', () => {
  const patch = publicModerationPatch({ status: 'held', reason: '검토 중', timestamp: 'server-time' })
  assertNoIdentity(patch)
})
