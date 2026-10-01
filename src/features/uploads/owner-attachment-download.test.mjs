import assert from 'node:assert/strict'
import test from 'node:test'
import { runOwnerAttachmentDownload } from './owner-attachment-download.ts'

test('successful attachment download returns working state to idle after navigation dispatch', async () => {
  const states = []
  const navigations = []
  await runOwnerAttachmentDownload(
    async () => ({ url: 'https://storage.googleapis.com/example/file.pdf' }),
    (url) => navigations.push(url),
    (state) => states.push(state),
  )
  assert.deepEqual(states, ['working', 'idle'])
  assert.deepEqual(navigations, ['https://storage.googleapis.com/example/file.pdf'])
})

test('failed or stale-account attachment download ends in error without navigation', async () => {
  const states = []
  const navigations = []
  await runOwnerAttachmentDownload(
    async () => { throw new Error('stale_auth') },
    (url) => navigations.push(url),
    (state) => states.push(state),
  )
  assert.deepEqual(states, ['working', 'error'])
  assert.deepEqual(navigations, [])
})
