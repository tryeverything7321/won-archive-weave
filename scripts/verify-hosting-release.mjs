import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

// Static deployment verification only: no production database or user session access.
const origin = 'https://won-archive-weave.web.app';
const dist = new URL('../dist/', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const localIndex = await readFile(new URL('index.html', dist));
const assetNames = (await readdir(new URL('assets/', dist))).filter(name => /\.(js|css)$/.test(name));
const routes = ['/', '/updates', '/archive', '/resources', '/contribute', '/profile', '/calendar', '/materials/release-check-unavailable', '/bundles/release-check-unavailable', '/archive-events/new', '/collections', '/collections/new'];

for (const route of routes) {
  const response = await fetch(`${origin}${route}`, { headers: { 'Cache-Control': 'no-cache' } });
  assert.equal(response.status, 200, `${route}: HTTP status`);
  assert.equal(digest(new Uint8Array(await response.arrayBuffer())), digest(localIndex), `${route}: deployed index differs`);
  assert.match(response.headers.get('cache-control') ?? '', /no-cache/, `${route}: stale HTML cache policy`);
}
for (let offset = 0; offset < assetNames.length; offset += 8) {
  await Promise.all(assetNames.slice(offset, offset + 8).map(async name => {
    const response = await fetch(`${origin}/assets/${encodeURIComponent(name)}`);
    assert.equal(response.status, 200, `${name}: HTTP status`);
    const actual = new Uint8Array(await response.arrayBuffer());
    assert.equal(digest(actual), digest(await readFile(new URL(`assets/${name}`, dist))), `${name}: deployed asset differs`);
  }));
}

const guardedFunctions = ['prepareSubmissionUploads', 'reconcileSubmissionUpload', 'setActivityMaterialLinks', 'getActivityMaterialLinks', 'getMaterialLinkImpact', 'listSubmissionOperatorExceptions', 'completeGoogleLogin', 'getMyMemberProfile', 'createMaterialBundle', 'prepareMaterialBundleFiles', 'finalizeMaterialBundle', 'updateMaterialBundle', 'withdrawMaterialBundleFile', 'ensureArchiveEventContext', 'linkArchiveRelation', 'createArchiveCollection', 'classifySubmissionAsMaterial', 'withdrawArchiveResource', 'manageQcResources', 'listManagedArchiveResources', 'getManagedArchiveResource', 'updateManagedArchiveResource'];
for (const name of guardedFunctions) {
  // All handlers require authentication before touching Firestore or Storage.
  const response = await fetch(`https://asia-northeast3-won-archive-weave.cloudfunctions.net/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }),
  });
  assert.equal(response.status, 401, `${name}: unauthenticated guard`);
  assert.equal((await response.json()).error?.status, 'UNAUTHENTICATED', `${name}: callable guard response`);
}
const entry = assetNames.find(name => /^index-.*\.js$/.test(name));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), origin, entry, routes: routes.length, matchingAssets: assetNames.length, unauthenticatedGuards: guardedFunctions.length, status: 'PASS' }, null, 2));
