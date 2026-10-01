import assert from 'node:assert/strict'
import test from 'node:test'
import { downloadContentDisposition, downloadFileName } from './download-disposition.js'

test('download filename restores the UTF-8 original from managed and quarantine paths', () => {
  assert.equal(
    downloadFileName('managed/submission/approval/012345abcdef-청년 활동 기록.md'),
    '청년 활동 기록.md',
  )
  assert.equal(
    downloadFileName('quarantined/owner/submission/u0123456789abcdef01234567--법회 자료.txt'),
    '법회 자료.txt',
  )
})

test('download disposition includes a safe ASCII fallback and RFC 5987 UTF-8 name', () => {
  assert.equal(
    downloadContentDisposition('managed/id/key/012345abcdef-법회 자료 (최종).txt'),
    "attachment; filename=\"_ _ (_).txt\"; filename*=UTF-8''%EB%B2%95%ED%9A%8C%20%EC%9E%90%EB%A3%8C%20%28%EC%B5%9C%EC%A2%85%29.txt",
  )
})

test('download disposition removes path, CRLF, quotes and backslashes from header values', () => {
  const disposition = downloadContentDisposition('../../folder\\evil\r\n"name.txt')
  assert.equal(downloadFileName('../../folder\\evil\r\n"name.txt'), 'evil___name.txt')
  assert.equal(disposition, "attachment; filename=\"evil_name.txt\"; filename*=UTF-8''evil___name.txt")
  assert.doesNotMatch(disposition, /[\r\n]/)
})

test('empty and dot-only names fail closed to a bounded fallback', () => {
  assert.equal(downloadFileName('../..'), 'attachment')
  assert.equal(downloadContentDisposition('\r\n'), "attachment; filename=\"_\"; filename*=UTF-8''__")
})
