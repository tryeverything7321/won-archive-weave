import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import ts from 'typescript'
const code = ts.transpile(fs.readFileSync(new URL('./approved-preview.ts', import.meta.url), 'utf8'), { module: ts.ModuleKind.ESNext })
const { readApprovedPreviewLink, readOwnerAttachmentDownload, previewCsv, canPreviewNativeType, previewFailure } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
test('preview accepts only bounded authorized storage links', () => {
  const value = { url: 'https://storage.googleapis.com/example/preview.pdf?signature=synthetic', expiresAtMs: 301000 }
  assert.deepEqual(readApprovedPreviewLink(value, 1000), value)
  for (const url of ['javascript:alert(1)', 'https://evil.example/doc.pdf', 'https://user:password@storage.googleapis.com/doc.pdf', 'http://storage.googleapis.com/doc.pdf']) {
    assert.throws(() => readApprovedPreviewLink({ ...value, url }, 1000))
  }
  for (const expiresAtMs of [999, 1000, NaN, Infinity, 361001]) assert.throws(() => readApprovedPreviewLink({ ...value, expiresAtMs }, 1000))
})
test('bounded CSV reader preserves quoted commas and literal formulas', () => {
  assert.deepEqual(previewCsv('이름,메모\n위브,"쉼표,포함"\n값,=SUM(A1)'), [['이름','메모'],['위브','쉼표,포함'],['값','=SUM(A1)']])
  assert.equal(previewCsv('a,b\n'.repeat(500)).length, 200)
  assert.equal(previewCsv('x,'.repeat(100))[0].length, 50)
  assert.equal(canPreviewNativeType('HWP'), false)
  assert.equal(canPreviewNativeType('PDF'), true)
})
test('preview failures keep conversion retry separate from unsafe attachment access', () => {
  const conversion = previewFailure({ code: 'functions/failed-precondition', message: '문서를 미리보기로 변환하지 못했어요' })
  assert.equal(conversion.title, '미리보기 변환 실패')
  assert.equal(conversion.retry, true)
  assert.match(conversion.message, /원본 다운로드가 허용된 자료라면/)
  const unsafe = previewFailure({ code: 'functions/permission-denied' })
  assert.equal(unsafe.retry, false)
  assert.match(unsafe.message, /안전 확인을 마치지 않은 파일은 열리지 않/)
  const staleOwnerState = previewFailure({ code: 'functions/failed-precondition', message: '현재 상태에서는 열 수 없어요' })
  assert.equal(staleOwnerState.retry, false)
})
test('owner download accepts only a bounded download response', () => {
  const value = { url: 'https://storage.googleapis.com/example/original.md?signature=synthetic', expiresAtMs: 301000, renderFormat: 'download', fileName: '기록.md' }
  assert.deepEqual(readOwnerAttachmentDownload(value, 1000), value)
  assert.throws(() => readOwnerAttachmentDownload({ ...value, renderFormat: 'text' }, 1000))
  assert.throws(() => readOwnerAttachmentDownload({ ...value, fileName: 'bad\nname.md' }, 1000))
  assert.throws(() => readOwnerAttachmentDownload({ ...value, url: 'https://evil.example/original.md' }, 1000))
})
