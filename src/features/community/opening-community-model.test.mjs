import test from 'node:test';
import assert from 'node:assert/strict';
import { openingPostBody, isOpeningPost, OPENING_PREFIX } from './opening-community-model.ts';
test('opening board identifies only its own prefix and never duplicates it on submit', () => {
 const body=openingPostBody('첫걸음을 응원해요');
 assert.equal(isOpeningPost(body),true);
 assert.equal(openingPostBody(body),body);
 assert.equal(isOpeningPost('일반 글의 중간 [오픈 응원]'),false);
 assert.equal(openingPostBody('가'.repeat(2000-OPENING_PREFIX.length)).length,2000);
});
