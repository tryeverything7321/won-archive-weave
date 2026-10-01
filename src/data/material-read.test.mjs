import assert from 'node:assert/strict';
import test from 'node:test';
import { readAccessibleMaterial } from './material-access.ts';

test('linked reader omits only inaccessible or missing records', async () => {
  assert.equal(await readAccessibleMaterial(async () => 'readable'), 'readable');
  for (const code of ['permission-denied', 'not-found']) {
    assert.equal(await readAccessibleMaterial(async () => { throw { code }; }), undefined);
  }
});

test('linked reader preserves transport and unexpected failures for retry', async () => {
  for (const code of ['unavailable', 'unauthenticated', 'internal']) {
    const failure = Object.assign(new Error('retry'), { code });
    await assert.rejects(readAccessibleMaterial(async () => { throw failure; }), error => error === failure);
  }
});
