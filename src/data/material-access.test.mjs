import assert from 'node:assert/strict'
import test from 'node:test'
import { isReadablePublication, linkedMaterialIds, attachmentStatusCopy, materialFormat, materialVisibilityLabel } from './material-access.ts'

test('material visibility uses the same wording across cards, detail, and owner management', () => {
  assert.equal(materialVisibilityLabel('회원 전용'), '위브 로그인 이용자에게 공개')
  assert.equal(materialVisibilityLabel('공개'), '누구나 공개')
  assert.equal(materialVisibilityLabel('보류'), '보류')
})

test('readers require a current published status and explicit visibility', () => {
  for (const status of ['hidden', 'unpublished', 'draft', undefined]) {
    assert.equal(isReadablePublication({ status, visibility: 'public' }, 'member'), false)
  }
  assert.equal(isReadablePublication({ status: 'published', visibility: 'member_only' }, 'public'), false)
  assert.equal(isReadablePublication({ status: 'published', visibility: 'member_only' }, 'member'), true)
  assert.equal(isReadablePublication({ status: 'published' }, 'member'), false)
})

test('linked materials preserve legacy source, reject invalid IDs, and bound fanout', () => {
  assert.deepEqual(linkedMaterialIds({ materialId: 'legacy', linkedMaterialIds: ['one', 'one', '../bad', 'legacy', 4] }), ['legacy', 'one'])
  assert.equal(linkedMaterialIds({ linkedMaterialIds: Array.from({ length: 100 }, (_, i) => `m${i}`) }).length, 30)
})

test('attachment failure copy never implies that the published body disappeared', () => {
  assert.match(attachmentStatusCopy('pending'), /첨부.*확인/)
  assert.match(attachmentStatusCopy('blocked'), /첨부 파일/)
  assert.equal(attachmentStatusCopy('clean'), '')
  assert.equal(attachmentStatusCopy(undefined), '')
})

test('file extensions do not turn posters or plain files into web links', () => {
  assert.equal(materialFormat('text', true, ''), 'TEXT')
  for (const extension of ['JPG', 'PNG', 'WEBP', 'JPEG']) assert.equal(materialFormat('upload', false, extension), 'IMAGE')
  assert.equal(materialFormat('upload', true, 'TXT'), 'TXT')
  assert.equal(materialFormat('upload', false, 'CSV'), 'CSV')
  assert.equal(materialFormat('upload', false, ''), 'FILE')
  assert.equal(materialFormat('google_drive_link', false, ''), 'LINK')
  assert.equal(materialFormat('upload', false, 'HWPX'), 'HWPX')
})
