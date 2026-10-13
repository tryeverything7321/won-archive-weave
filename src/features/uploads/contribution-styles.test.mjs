import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('authoring styles include every CSS module class used by the form', () => {
  const component = readFileSync(new URL('./ContributionForm.tsx', import.meta.url), 'utf8');
  const stylesheet = readFileSync(new URL('./ContributionForm.module.css', import.meta.url), 'utf8');
  const used = [...new Set([...component.matchAll(/styles\.([A-Za-z][A-Za-z0-9_]*)/g)].map(match => match[1]))];
  const missing = used.filter(name => !new RegExp(`\\.${name}(?![\\w-])`).test(stylesheet));
  assert.deepEqual(missing, [], 'Missing classes silently render as unstyled controls');
});
