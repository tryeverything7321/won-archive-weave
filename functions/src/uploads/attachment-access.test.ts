import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approvedAttachmentGeneration,
  attachmentAllowsRead,
  ownerAttachmentPathsMatch,
  ownerPrivateAttachmentAllowsRead,
} from './attachment-access.js'

test('new attachment states fail closed even if a stale approved path exists', () => {
  for (const state of ['pending', 'blocked', 'error', 'unknown', null]) assert.equal(attachmentAllowsRead(state), false)
  assert.equal(attachmentAllowsRead('clean'), true)
  assert.equal(attachmentAllowsRead(undefined), true, 'legacy projections still use existing path and status checks')
})

test('private attachment selection must match every attested quarantine path exactly', () => {
  const prefix = 'quarantined/owner/submission/'
  const selected = ['u1--source.txt', 'u2--__preview__-source.pdf']
  assert.equal(ownerAttachmentPathsMatch(prefix, selected, [
    `${prefix}${selected[1]}`, `${prefix}${selected[0]}`,
  ]), true)
  assert.equal(ownerAttachmentPathsMatch(prefix, selected, [`${prefix}${selected[0]}`]), false)
  assert.equal(ownerAttachmentPathsMatch(prefix, selected, [
    `${prefix}${selected[0]}`, 'quarantined/other/submission/u2--__preview__-source.pdf',
  ]), false)
})

test('private clean attachments are readable only by the current owner in the live hold state', () => {
  const ready = {
    actorUid: 'owner', ownerUid: 'owner', status: 'review_queued', visibility: '보류', sourceMode: 'upload',
    scanStatus: 'clean', verdict: 'clean', scanRecordedBy: 'event-driven-file-scanner', moderated: false,
  }
  assert.equal(ownerPrivateAttachmentAllowsRead(ready), true)
  assert.equal(ownerPrivateAttachmentAllowsRead({ ...ready, actorUid: 'other' }), false)
  assert.equal(ownerPrivateAttachmentAllowsRead({ ...ready, status: 'withdrawn' }), false)
  assert.equal(ownerPrivateAttachmentAllowsRead({ ...ready, scanStatus: 'error' }), false)
  assert.equal(ownerPrivateAttachmentAllowsRead({ ...ready, verdict: 'blocked' }), false)
  assert.equal(ownerPrivateAttachmentAllowsRead({ ...ready, moderated: true }), false)
})

test('new attachment reads bind to one exact approved generation', () => {
  const objects = [{ path: 'managed/item/source.txt', generation: '123' }]
  assert.equal(approvedAttachmentGeneration('clean', 'managed/item/source.txt', objects), '123')
  assert.equal(approvedAttachmentGeneration('clean', 'managed/item/other.txt', objects), null)
  assert.equal(approvedAttachmentGeneration('clean', 'managed/item/source.txt', [
    ...objects, ...objects,
  ]), null)
  assert.equal(approvedAttachmentGeneration('clean', 'managed/item/source.txt', [
    { path: 'managed/item/source.txt', generation: 'latest' },
  ]), null)
  assert.equal(approvedAttachmentGeneration('pending', 'managed/item/source.txt', objects), null)
  assert.equal(approvedAttachmentGeneration(undefined, 'legacy/source.txt', undefined), undefined)
})
