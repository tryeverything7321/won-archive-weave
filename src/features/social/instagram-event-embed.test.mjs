import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true } });
const { normalizeInstagramPostUrl, appendInstagramAttachment } = await vite.ssrLoadModule('/src/features/social/instagram-url.ts');
after(() => vite.close());
test('Instagram post links retain post identity and canonical path without tracking', () => {
  assert.deepEqual(normalizeInstagramPostUrl('https://www.instagram.com/p/ABCDE/?igsh=tracking'), {
    sourceUrl: 'https://www.instagram.com/p/ABCDE/', mediaType: 'post', shortcode: 'ABCDE',
  });
});
test('invalid origins, credentials, profiles and duplicate references are rejected', () => {
  for (const url of ['https://evil.example/p/ABCDE/', 'https://x@instagram.com/p/ABCDE/', 'https://instagram.com/someone/']) assert.throws(() => normalizeInstagramPostUrl(url));
  const first = appendInstagramAttachment([], 'https://instagram.com/p/ABCDE/');
  assert.throws(() => appendInstagramAttachment(first, 'https://www.instagram.com/p/ABCDE/?x=1'));
});
test('event attachments stop at five canonical Instagram references', () => {
  let attachments = [];
  for (let index = 0; index < 5; index += 1) {
    attachments = appendInstagramAttachment(attachments, `https://instagram.com/p/ABCDE${index}/`);
  }
  assert.equal(attachments.length, 5);
  assert.throws(() => appendInstagramAttachment(attachments, 'https://instagram.com/reel/ABCDEF/'));
});
