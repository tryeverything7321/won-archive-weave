import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeEventInstagramPosts, readEventInstagramPosts } from './event-instagram.js'

test('normalizes a canonical Instagram post and removes tracking query data', () => {
  assert.deepEqual(normalizeEventInstagramPosts([{
    sourceUrl: 'https://m.instagram.com/p/ABCDE/?igsh=tracking#fragment',
    mediaType: 'post',
    shortcode: 'ABCDE',
    originalAuthor: '@weave.youth',
  }]), [{
    sourceUrl: 'https://www.instagram.com/p/ABCDE/',
    mediaType: 'post',
    shortcode: 'ABCDE',
    originalAuthor: 'weave.youth',
  }])
  assert.deepEqual(normalizeEventInstagramPosts(undefined), [])
})

test('rejects duplicates, a sixth link and malformed new writes', () => {
  const post = { sourceUrl: 'https://www.instagram.com/reel/Abcde_1/', mediaType: 'reel', shortcode: 'Abcde_1' }
  assert.throws(() => normalizeEventInstagramPosts([post, { ...post, sourceUrl: `${post.sourceUrl}?igsh=duplicate` }]))
  assert.throws(() => normalizeEventInstagramPosts(Array.from({ length: 6 }, (_, index) => ({
    sourceUrl: `https://www.instagram.com/p/ABCDE${index}/`, mediaType: 'post', shortcode: `ABCDE${index}`,
  }))))
  for (const sourceUrl of [
    'https://evil.example/p/ABCDE/',
    'https://user:pass@www.instagram.com/p/ABCDE/',
    'https://www.instagram.com/weave.youth/',
  ]) assert.throws(() => normalizeEventInstagramPosts([{ sourceUrl, mediaType: 'post', shortcode: 'ABCDE' }]))
  assert.throws(() => normalizeEventInstagramPosts([{ ...post, mediaType: 'post' }]))
  assert.throws(() => normalizeEventInstagramPosts([{ ...post, originalAuthor: 'bad author!' }]))
})

test('public legacy reader returns only canonical unique safe links', () => {
  assert.deepEqual(readEventInstagramPosts([
    { sourceUrl: 'https://www.instagram.com/p/ABCDE/?utm=x', mediaType: 'post', shortcode: 'ABCDE' },
    { sourceUrl: 'https://evil.example/p/ABCDE/', mediaType: 'post', shortcode: 'ABCDE' },
    { sourceUrl: 'https://www.instagram.com/p/ABCDE/', mediaType: 'post', shortcode: 'ABCDE' },
  ]), [{ sourceUrl: 'https://www.instagram.com/p/ABCDE/', mediaType: 'post', shortcode: 'ABCDE' }])
  assert.deepEqual(readEventInstagramPosts(undefined), [])
})
