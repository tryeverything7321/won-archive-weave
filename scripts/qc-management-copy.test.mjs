import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('entry copy does not promise universal editing or permanent deletion', () => {
  const source=readFileSync(new URL('../src/routes/MemberPages.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/수정하거나 삭제할 수 있어요|언제든 다시 고칠 수 있어요/);
  assert.match(source,/등록 후에는 내 위브에서 게시 상태와 관리 메뉴/);
});
