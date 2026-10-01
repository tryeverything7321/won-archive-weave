import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMediaDisplayMode } from './calendar-media-presentation.ts';
test('poster-safe display defaults to contain and accepts only explicit cover', () => {
  assert.equal(resolveMediaDisplayMode(undefined), 'contain');
  assert.equal(resolveMediaDisplayMode('cover'), 'cover');
  assert.equal(resolveMediaDisplayMode('unexpected'), 'contain');
});
