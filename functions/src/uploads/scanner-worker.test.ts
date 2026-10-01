import assert from 'node:assert/strict'
import test from 'node:test'
import {
  localFilePolicy,
  parseExternalScannerVerdict,
  quarantinedSubmissionPath,
  scannerRequestHeaders,
  scanResultId,
  scannerSelectionAllowsObject,
  sameSelectedUploadNames,
  shouldResumeCleanScanPublication,
  submissionScanApplicationDecision,
} from './scanner-worker.js'

test('scanner recognizes document, bundle-file and event-image quarantine paths', () => {
  assert.deepEqual(quarantinedSubmissionPath('quarantined/member-1/submission-1/file.pdf'), {
    kind: 'submission',
    ownerUid: 'member-1',
    submissionId: 'submission-1',
  })
  assert.deepEqual(quarantinedSubmissionPath('quarantined/member-1/calendar-events/event-1/cover.jpg'), {
    kind: 'calendar_event',
    ownerUid: 'member-1',
    eventId: 'event-1',
  })
  assert.deepEqual(quarantinedSubmissionPath('quarantined/member-1/material-bundles/bundle-1/file-1/upload.pptx'), {
    kind: 'material_bundle',
    ownerUid: 'member-1',
    bundleId: 'bundle-1',
    fileId: 'file-1',
  })
  assert.equal(quarantinedSubmissionPath('approved/public/file.pdf'), null)
  assert.equal(quarantinedSubmissionPath('quarantined/member-1/missing-file'), null)
})

test('an already recorded clean scan resumes publication instead of becoming a permanent no-op', () => {
  assert.equal(shouldResumeCleanScanPublication('apply_attachment', true, 'clean'), true)
  assert.equal(shouldResumeCleanScanPublication('apply_legacy', true, 'clean'), true)
  assert.equal(shouldResumeCleanScanPublication('ignore', true, 'clean'), false)
  assert.equal(shouldResumeCleanScanPublication('apply_attachment', true, 'blocked'), false)
})

test('scan result identity binds bucket, path, and exact generation', () => {
  const current = scanResultId('bucket', 'quarantined/u/s/a.pdf', '7')
  assert.match(current, /^[a-f0-9]{64}$/)
  assert.notEqual(current, scanResultId('bucket', 'quarantined/u/s/a.pdf', '8'))
  assert.notEqual(current, scanResultId('other', 'quarantined/u/s/a.pdf', '7'))
})

test('selected upload scans ignore old paths and fence selection changes', () => {
  const prefix = 'quarantined/u/s/'
  const selected = ['unew--source.pdf', 'upreview--preview.pdf']
  assert.equal(scannerSelectionAllowsObject(`${prefix}${selected[0]}`, prefix, selected), true)
  assert.equal(scannerSelectionAllowsObject(`${prefix}old-source.pdf`, prefix, selected), false)
  assert.equal(scannerSelectionAllowsObject(`${prefix}nested/${selected[0]}`, prefix, selected), false)
  assert.equal(scannerSelectionAllowsObject(`${prefix}old-source.pdf`, prefix, undefined), true)
  assert.equal(sameSelectedUploadNames(selected, [...selected]), true)
  assert.equal(sameSelectedUploadNames(selected, [selected[1], selected[0]]), false)
  assert.equal(sameSelectedUploadNames(undefined, undefined), true)
  assert.equal(sameSelectedUploadNames(undefined, selected), false)
})

test('local policy catches EICAR and MIME disguises before external scanning', () => {
  const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'ascii')
  assert.deepEqual(localFilePolicy(eicar, 'text/plain'), { allowed: false, reason: 'eicar_test_signature' })
  assert.deepEqual(localFilePolicy(Buffer.from('not really a pdf'), 'application/pdf'), {
    allowed: false,
    reason: 'mime_signature_mismatch',
  })
  assert.deepEqual(localFilePolicy(Buffer.from('%PDF-1.7\n'), 'application/pdf'), { allowed: true })
  assert.deepEqual(localFilePolicy(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), { allowed: true })
  assert.deepEqual(localFilePolicy(Buffer.from('\uFEFF정상 TXT', 'utf8'), 'Text/Plain; charset=utf-8'), { allowed: true })
  assert.deepEqual(localFilePolicy(Buffer.from('# 정상 Markdown\n', 'utf8'), 'text/markdown; charset=utf-8'), { allowed: true })
  assert.deepEqual(localFilePolicy(Buffer.from([0x41, 0x00, 0x42]), 'text/plain; charset=utf-8'), {
    allowed: false,
    reason: 'mime_signature_mismatch',
  })
})

test('only explicit trusted scanner verdict shapes are accepted', () => {
  assert.deepEqual(parseExternalScannerVerdict({
    verdict: 'clean',
    provider: 'clamav-service',
    engineVersion: '1.4.3',
  }), {
    verdict: 'clean',
    provider: 'clamav-service',
    engineVersion: '1.4.3',
  })
  assert.equal(parseExternalScannerVerdict({
    verdict: 'infected',
    provider: 'clamav-service',
    engineVersion: '1.4.3',
    signature: 'Test.Signature',
  }).verdict, 'blocked')
  assert.throws(() => parseExternalScannerVerdict({ verdict: 'clean' }), /invalid_scanner_response/)
  assert.throws(() => parseExternalScannerVerdict({ verdict: 'unknown', provider: 'x', engineVersion: '1' }))
})

test('scanner request leaves Authorization to the OIDC client and sends the shared token separately', () => {
  assert.deepEqual(scannerRequestHeaders('application/pdf', 'quarantined/u/s/file.pdf', 'shared-token'), {
    'content-type': 'application/pdf',
    'x-weave-object-name': 'quarantined%2Fu%2Fs%2Ffile.pdf',
    'x-weave-scanner-token': 'shared-token',
  })
  assert.equal('authorization' in scannerRequestHeaders('application/pdf', 'file.pdf', 'shared-token'), false)
})

test('late attachment scans require the exact active revision and an unmoderated published body', () => {
  const ready = {
    lifecycleVersion: 1,
    status: 'published',
    attachmentStatus: 'pending',
    capturedRevision: 'revision-1',
    currentRevision: 'revision-1',
    moderated: false,
  }
  assert.equal(submissionScanApplicationDecision(ready), 'apply_attachment')
  assert.equal(submissionScanApplicationDecision({ ...ready, attachmentStatus: 'error' }), 'apply_attachment')
  assert.equal(submissionScanApplicationDecision({ ...ready, currentRevision: 'revision-2' }), 'ignore')
  assert.equal(submissionScanApplicationDecision({ ...ready, moderated: true }), 'ignore')
  assert.equal(submissionScanApplicationDecision({ ...ready, status: 'held' }), 'ignore')
  assert.equal(submissionScanApplicationDecision({ ...ready, status: 'unpublished' }), 'ignore')
  assert.equal(submissionScanApplicationDecision({ ...ready, status: 'withdrawn' }), 'ignore')
  assert.equal(submissionScanApplicationDecision({ ...ready, lifecycleVersion: undefined, status: 'review_queued' }), 'apply_legacy')
})
