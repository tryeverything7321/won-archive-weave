import assert from 'node:assert/strict'
import test from 'node:test'
import {
  InstagramUrlPolicyError,
  normalizeInstagramPostUrl,
  validateInstagramAttachments,
} from './instagram-url.js'

test('normalizes supported public Instagram post and reel URLs without tracking parameters', () => {
  assert.deepEqual(normalizeInstagramPostUrl(' https://instagram.com/p/AbC_123/?igsh=tracking#fragment '), {
    sourceUrl: 'https://www.instagram.com/p/AbC_123/',
    mediaType: 'post',
    shortcode: 'AbC_123',
  })
  assert.equal(normalizeInstagramPostUrl('https://m.instagram.com/reel/ZXy-987/').sourceUrl, 'https://www.instagram.com/reel/ZXy-987/')
})

test('rejects non-Instagram, insecure, profile, story and unsupported subdomain URLs', () => {
  for (const url of [
    'http://www.instagram.com/p/AbC_123/',
    'https://evil.example/p/AbC_123/',
    'https://cdn.instagram.com/p/AbC_123/',
    'https://www.instagram.com/won_buddhism_youth/',
    'https://www.instagram.com/stories/name/123/',
  ]) {
    assert.throws(() => normalizeInstagramPostUrl(url), (error: InstagramUrlPolicyError) => error.code === 'unsupported_url')
  }
})

test('rejects duplicate links after normalization and preserves an optional original author', () => {
  assert.throws(() => validateInstagramAttachments([
    { sourceUrl: 'https://instagram.com/p/AbC_123/?igsh=one' },
    { sourceUrl: 'https://www.instagram.com/p/AbC_123/?utm_source=two' },
  ]), (error: InstagramUrlPolicyError) => error.code === 'duplicate')

  assert.deepEqual(validateInstagramAttachments([
    { sourceUrl: 'https://instagram.com/reel/ZXy-987/', originalAuthor: '@won_buddhism_youth' },
  ])[0], {
    sourceUrl: 'https://www.instagram.com/reel/ZXy-987/',
    mediaType: 'reel',
    shortcode: 'ZXy-987',
    originalAuthor: 'won_buddhism_youth',
  })
})

test('bounds attachment count and rejects malformed author handles', () => {
  assert.throws(() => validateInstagramAttachments(Array.from({ length: 6 }, (_, index) => ({
    sourceUrl: `https://www.instagram.com/p/Short${index}/`,
  }))), (error: InstagramUrlPolicyError) => error.code === 'too_many')
  assert.throws(() => validateInstagramAttachments([{ sourceUrl: 'https://www.instagram.com/p/AbC_123/', originalAuthor: '한글계정' }]), (error: InstagramUrlPolicyError) => error.code === 'invalid_author')
})
