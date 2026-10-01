import assert from 'node:assert/strict'
import test from 'node:test'
import { resetArchiveFilters, resourcesReturnPath } from './archive-navigation.ts'

test('전체 기록 보기는 검색어, 주제, 형식 필터를 한 번에 초기화한다', () => {
  const next = resetArchiveFilters(new URLSearchParams('q=없는말&topic=관계와+공동체&type=활동+레시피&examples=1'))
  assert.equal(next.toString(), 'examples=1')
})

test('자료 상세의 목록 복귀 경로는 자료 목록 상태만 허용한다', () => {
  assert.equal(resourcesReturnPath('/resources?type=TEXT&examples=1'), '/resources?type=TEXT&examples=1')
  assert.equal(resourcesReturnPath('/archive?examples=1'), '/resources')
  assert.equal(resourcesReturnPath('https://example.com/resources'), '/resources')
  assert.equal(resourcesReturnPath('/resources#unsafe'), '/resources')
})
