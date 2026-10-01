import assert from 'node:assert/strict'
import test from 'node:test'
import { webcrypto } from 'node:crypto'
import {
  communityWriteRequest,
  completeCommunityWriteRequest,
} from './community-write-request.ts'

globalThis.crypto ??= webcrypto

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('the same pending community payload keeps its request id until success', () => {
  const storage = memoryStorage()
  const first = communityWriteRequest('post', { purpose: '질문', body: '도와주세요' }, storage)
  const retry = communityWriteRequest('post', { body: '도와주세요', purpose: '질문' }, storage)
  assert.equal(retry.requestId, first.requestId)
  completeCommunityWriteRequest(first.storageKey, storage)
  assert.notEqual(communityWriteRequest('post', { purpose: '질문', body: '도와주세요' }, storage).requestId, first.requestId)
})

test('different payloads and write kinds never share a retry identifier', () => {
  const storage = memoryStorage()
  const post = communityWriteRequest('post', { body: '첫 글' }, storage)
  const another = communityWriteRequest('post', { body: '다른 글' }, storage)
  const comment = communityWriteRequest('comment', { body: '첫 글' }, storage)
  assert.notEqual(post.requestId, another.requestId)
  assert.notEqual(post.requestId, comment.requestId)
})

test('retry identity remains stable when browser storage is unavailable', () => {
  const payload = { postId: 'post-storage-failure', body: '저장소가 없어도 같은 댓글' }
  const first = communityWriteRequest('comment', payload, null)
  assert.equal(communityWriteRequest('comment', payload, null).requestId, first.requestId)
  completeCommunityWriteRequest(first.storageKey, null)
  assert.notEqual(communityWriteRequest('comment', payload, null).requestId, first.requestId)
})
