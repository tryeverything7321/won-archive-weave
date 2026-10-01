import assert from 'node:assert/strict'
import test from 'node:test'
import { Timestamp } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { buildGoogleDriveSourceLink, googleDriveSourceFingerprint } from '../google/drive-import.js'
import {
  approvalReservationDecision,
  attachmentPublicationMatchesReservation,
  attachmentPublicationReservationDecision,
  attachmentStatusProjection,
  allowedSubmissionExceptionActions,
  automaticUploadPublicationDecision,
  privateCleanUploadDecision,
  assertAutomatedScanPublicationReady,
  assertSubmissionFilePolicy,
  assertRestorableMaterialProjection,
  assertNewSubmissionKind,
  activityPublicationSetOptions,
  buildActivityPublication,
  buildApprovalCopyManifest,
  buildPendingUploadPublication,
  canSubmissionOwnerPublish,
  classifyPublishedDocumentAssets,
  decodeSubmissionExceptionCursor,
  encodeSubmissionExceptionCursor,
  instagramAttachmentsFingerprint,
  markApprovalCopyComplete,
  assertSubmissionSortMigrationClaimable,
  assertSubmissionSortMigrationLease,
  decodeOwnerSubmissionCursor,
  encodeOwnerSubmissionCursor,
  ownerSubmissionPageSize,
  originalUploadFileName,
  requireSameSubmissionSourceMode,
  requireSameSubmissionKind,
  requireSubmissionOperator,
  requireSubmissionOwner,
  staleApprovalManagedPaths,
  sourceLinkApprovalFingerprint,
  submissionExceptionPageSize,
  submissionEditableRecord,
  submissionOperatorExceptionRecord,
  submissionOwnerRecord,
  submissionManagementForOwner,
  submissionOwnerManagementTransition,
  submissionOwnerTransition,
  submissionPrivateDraftRestorePlan,
  submissionModerationPlan,
  submissionSubmitRetryDecision,
  submissionCreateFingerprint,
  submissionCreateId,
  submissionCreateReplayDecision,
  submissionSortCreatedAt,
  submissionSortCreatedAtRepair,
  submissionSortMigrationCursorId,
  submissionSortMigrationNextPhase,
  validateSubmissionInput,
  validateSubmissionSortMigrationCommand,
  validateSourceLinkVerificationAttestation,
} from './submissions.js'
import type { ScanAttestation } from './scan-attestation.js'

const validInput = {
  sourceMode: 'upload',
  title: '청년 정기훈련 회고 자료',
  kind: '자료',
  source: '작성자 제공',
  owner: '서울 청년회',
  visibility: '공개',
  consentConfirmed: true,
  attribution: '서울 청년회 제공',
  redistribution: 'download_allowed',
  consentBasis: '작성자 직접 동의',
  sensitiveDataReviewed: true,
  retention: 'managed',
}

const sourceLinkUrl = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit'

test('management lookup reveals actions only for the record owner', () => {
  const record = { ownerUid: 'member-a', status: 'published', sourceMode: 'text', visibility: '공개', title: '회의록', kind: '자료' }
  assert.equal(submissionManagementForOwner('material-1', record, 'member-b'), null)
  assert.equal(submissionManagementForOwner('material-1', undefined, 'member-a'), null)
  const owned = submissionManagementForOwner('material-1', record, 'member-a')
  assert.equal(owned?.id, 'material-1')
  assert.equal(owned?.status, 'published')
  assert.ok(owned?.availableActions.includes('request_revision'))
  assert.ok(owned?.availableActions.includes('unpublish'))
  assert.equal(submissionManagementForOwner('material-1', { ...record, status: 'revision_requested' }, 'member-a')?.availableActions.includes('edit'), true)
})

test('text publishing requires a body, forbids files and preserves owner visibility checks', () => {
  const textContent = { schemaVersion: 1, format: 'markdown', body: '회의록 내용' }
  assert.deepEqual(validateSubmissionInput({ ...validInput, sourceMode: 'text', textContent }).textContent, textContent)
  assert.throws(() => validateSubmissionInput({ ...validInput, sourceMode: 'text' }), HttpsError)
  assert.throws(() => validateSubmissionInput({ ...validInput, sourceMode: 'text', textContent: { ...textContent, body: ' ' } }), HttpsError)
  assert.doesNotThrow(() => assertSubmissionFilePolicy('text' as never, 0))
  assert.throws(() => assertSubmissionFilePolicy('text' as never, 1), HttpsError)
  assert.equal(canSubmissionOwnerPublish({ actorUid: 'owner', ownerUid: 'owner', sourceMode: 'text' as never, visibility: '회원 전용' }), true)
  assert.equal(canSubmissionOwnerPublish({ actorUid: 'other', ownerUid: 'owner', sourceMode: 'text' as never, visibility: '공개' }), false)
  assert.doesNotThrow(() => assertRestorableMaterialProjection('text', { status: 'held', sourceMode: 'text', textContent }))
  assert.throws(() => assertRestorableMaterialProjection('upload', { status: 'held', sourceMode: 'upload', textContent }), HttpsError)
})

test('new uploads publish body metadata while attachment paths remain absent', () => {
  const input = validateSubmissionInput({
    ...validInput,
    textContent: { schemaVersion: 1, format: 'markdown', body: '회의 기록 본문' },
  })
  const projection = buildPendingUploadPublication('submission-1', input, 'public')
  assert.equal(projection.material.status, 'published')
  assert.equal(projection.material.attachmentStatus, 'pending')
  assert.deepEqual(projection.material.textContent, { schemaVersion: 1, format: 'markdown', body: '회의 기록 본문' })
  assert.equal('approvedStoragePath' in projection.material, false)
  assert.equal('approvedStorageObjects' in projection.material, false)
  assert.equal(buildPendingUploadPublication('submission-1', input, 'public', 'error').material.attachmentStatus, 'error')
})

test('selected upload target prefixes never leak into the published original filename', () => {
  assert.equal(originalUploadFileName('quarantined/u/s/u0123456789abcdef01234567--회의록.pdf'), '회의록.pdf')
  assert.equal(originalUploadFileName('quarantined/u/s/legacy-file.pdf'), 'legacy-file.pdf')
})

test('file-only uploads expose a title and pending attachment without inventing a body', () => {
  const input = validateSubmissionInput(validInput)
  const projection = buildPendingUploadPublication('submission-1', input, 'member_only')
  assert.equal(projection.material.title, validInput.title)
  assert.equal(projection.material.attachmentStatus, 'pending')
  assert.equal('textContent' in projection.material, false)
})

test('attachment state projects explicit values and a safe legacy fallback', () => {
  assert.equal(attachmentStatusProjection({ attachmentStatus: 'blocked' }), 'blocked')
  assert.equal(attachmentStatusProjection({ sourceMode: 'text', scanStatus: 'not_applicable' }), 'not_applicable')
  assert.equal(attachmentStatusProjection({ sourceMode: 'google_drive_link', scanStatus: 'not_applicable' }), 'not_applicable')
  assert.equal(attachmentStatusProjection({ scanStatus: 'clean', approvedStoragePath: 'managed/id/file.pdf' }), 'clean')
  assert.equal(attachmentStatusProjection({ scanStatus: 'error' }), 'error')
  assert.equal(attachmentStatusProjection({}), 'pending')
})

test('attachment publication reserves only the matching live pending generation', () => {
  assert.equal(attachmentPublicationReservationDecision({
    status: 'published', attachmentStatus: 'pending', scanStatus: 'clean', attachmentRevision: 'revision-1', nowMs: 100,
  }), 'reserve')
  assert.equal(attachmentPublicationReservationDecision({
    status: 'published', attachmentStatus: 'clean', scanStatus: 'clean', attachmentRevision: 'revision-1', nowMs: 100,
  }), 'complete')
  assert.equal(attachmentPublicationReservationDecision({
    status: 'published', attachmentStatus: 'pending', scanStatus: 'clean', attachmentRevision: 'revision-1', leaseExpiresAtMs: 200, attemptId: 'attempt-1', nowMs: 100,
  }), 'busy')
  assert.equal(attachmentPublicationReservationDecision({
    status: 'held', attachmentStatus: 'pending', scanStatus: 'clean', attachmentRevision: 'revision-1', nowMs: 100,
  }), 'invalid')
  assert.equal(attachmentPublicationMatchesReservation({
    status: 'published', attachmentRevision: 'revision-1', attemptId: 'attempt-1', expectedRevision: 'revision-1', expectedAttemptId: 'attempt-1',
  }), true)
  assert.equal(attachmentPublicationMatchesReservation({
    status: 'published', attachmentRevision: 'revision-2', attemptId: 'attempt-1', expectedRevision: 'revision-1', expectedAttemptId: 'attempt-1',
  }), false)
})

test('submit retry resumes only safe work and never requires a second draft', () => {
  assert.equal(submissionSubmitRetryDecision({ status: 'published', materialId: 'submission-1', sourceMode: 'upload' }), 'return_published')
  assert.equal(submissionSubmitRetryDecision({ status: 'publishing', sourceMode: 'google_drive_link' }), 'return_in_progress')
  assert.equal(submissionSubmitRetryDecision({ status: 'review_queued', sourceMode: 'google_drive_link', visibility: '공개' }), 'resume_publication')
  assert.equal(submissionSubmitRetryDecision({ status: 'review_queued', sourceMode: 'upload' }), 'return_in_progress')
  assert.equal(submissionSubmitRetryDecision({ status: 'draft', sourceMode: 'upload' }), 'start')
})

test('create request IDs deterministically replay only the same owner and input', () => {
  const fingerprint = submissionCreateFingerprint(validateSubmissionInput(validInput))
  assert.equal(submissionCreateId('owner-1', 'create-request-001'), submissionCreateId('owner-1', 'create-request-001'))
  assert.notEqual(submissionCreateId('owner-1', 'create-request-001'), submissionCreateId('owner-2', 'create-request-001'))
  assert.equal(submissionCreateReplayDecision(undefined, 'owner-1', fingerprint), 'create')
  assert.equal(submissionCreateReplayDecision({ ownerUid: 'owner-1', initialCreateFingerprint: fingerprint }, 'owner-1', fingerprint), 'replay')
  assert.equal(submissionCreateReplayDecision({ ownerUid: 'owner-1', initialCreateFingerprint: 'other' }, 'owner-1', fingerprint), 'conflict')
  assert.equal(submissionCreateReplayDecision({ ownerUid: 'owner-2', initialCreateFingerprint: fingerprint }, 'owner-1', fingerprint), 'conflict')
})

test('optional text survives submission validation and editable draft projection', () => {
  const textContent = { schemaVersion: 1, format: 'markdown', body: '회의록\n\n- 다음 모임 준비' }
  const input = validateSubmissionInput({ ...validInput, textContent })
  assert.deepEqual((input as unknown as Record<string, unknown>).textContent, textContent)
  const draft = submissionEditableRecord('draft-text', { ...input, status: 'draft' }, 1)
  assert.deepEqual(draft.textContent, textContent)
  assert.equal(draft.sourceMode, 'upload')
  assert.equal(draft.existingFileCount, 1)
  assert.equal(submissionEditableRecord('legacy', { ...validInput, status: 'draft' }).textContent, undefined)
})

test('submission rejects unsupported text rather than silently discarding it', () => {
  assert.throws(() => validateSubmissionInput({ ...validInput, textContent: { format: 'html', body: '회의록' } }), HttpsError)
})

test('material moderation keeps correction visible and makes hold authoritative', () => {
  assert.deepEqual(submissionModerationPlan({ status: 'published', action: 'request_correction', hasPublicProjection: true, hasPriorGuidance: false }), {
    nextStatus: 'revision_requested', publicAction: 'unchanged', markerAction: null,
  })
  assert.deepEqual(submissionModerationPlan({ status: 'publishing', action: 'hold', hasPublicProjection: true, hasPriorGuidance: false }), {
    nextStatus: 'held', publicAction: 'hide', markerAction: 'hold',
  })
  assert.throws(() => submissionModerationPlan({ status: 'published', action: 'remove', hasPublicProjection: true, hasPriorGuidance: false }), { code: 'failed-precondition' })
  assert.deepEqual(submissionModerationPlan({ status: 'revision_requested', action: 'remove', hasPublicProjection: true, hasPriorGuidance: true }), {
    nextStatus: 'unpublished', publicAction: 'hide', markerAction: 'remove',
  })
})

test('material restore requires an operator marker and retains pending correction workflow', () => {
  assert.throws(() => submissionModerationPlan({ status: 'unpublished', action: 'restore', hasPublicProjection: true, hasPriorGuidance: true }), { code: 'failed-precondition' })
  assert.deepEqual(submissionModerationPlan({ status: 'review_queued', action: 'restore', hasPublicProjection: true, hasPriorGuidance: true, markerAction: 'hold' }), {
    nextStatus: 'review_queued', publicAction: 'restore', markerAction: null,
  })
})

test('material restore accepts only an existing previously approved projection', () => {
  assert.doesNotThrow(() => assertRestorableMaterialProjection('submission-1', {
    status: 'held',
    approvedStorageObjects: [{ path: 'managed/submission-1/hash-file.pdf', generation: '7' }],
  }))
  assert.doesNotThrow(() => assertRestorableMaterialProjection('submission-1', {
    status: 'unpublished',
    sourceLink: { status: 'verified', verificationId: 'verify-1', sourceFingerprint: 'fingerprint-1' },
  }))
  assert.throws(() => assertRestorableMaterialProjection('submission-1', {
    status: 'unpublished',
    approvedStorageObjects: [{ path: 'quarantined/owner/submission-1/file.pdf', generation: '7' }],
  }), { code: 'failed-precondition' })
  assert.throws(() => assertRestorableMaterialProjection('submission-1', { status: 'unpublished' }), { code: 'failed-precondition' })
  assert.doesNotThrow(() => assertRestorableMaterialProjection('submission-1', {
    status: 'held', sourceMode: 'upload', attachmentLifecycleVersion: 1, attachmentStatus: 'pending', title: '첨부 확인 중 자료',
  }))
})

test('publishes the Hangul original separately from its author-provided PDF preview', () => {
  assert.deepEqual(
    classifyPublishedDocumentAssets([
      'managed/submission/key/hash-__preview__-청년회_기록.pdf',
      'managed/submission/key/hash-청년회_기록.hwpx',
    ]),
    {
      sourcePath: 'managed/submission/key/hash-청년회_기록.hwpx',
      sourceFormat: 'hwpx',
      previewStoragePath: 'managed/submission/key/hash-__preview__-청년회_기록.pdf',
      previewStatus: 'ready',
    },
  )
  assert.deepEqual(
    classifyPublishedDocumentAssets(['managed/submission/key/hash-청년회_기록.hwp']),
    {
      sourcePath: 'managed/submission/key/hash-청년회_기록.hwp',
      sourceFormat: 'hwp',
      previewStatus: 'not_provided',
    },
  )
})

test('rejects malformed or unrelated preview attachments', () => {
  assert.throws(
    () => classifyPublishedDocumentAssets(['managed/submission/key/hash-__preview__-기록.pdf']),
    { code: 'failed-precondition' },
  )
  assert.throws(
    () => classifyPublishedDocumentAssets([
      'managed/submission/key/hash-기록.docx',
      'managed/submission/key/hash-__preview__-기록.pdf',
    ]),
    { code: 'failed-precondition' },
  )
  assert.throws(
    () => classifyPublishedDocumentAssets([
      'managed/submission/key/hash-기록.hwp',
      'managed/submission/key/hash-__preview__-기록.pdf',
      'managed/submission/key/hash-__preview__-기록-2.pdf',
    ]),
    { code: 'failed-precondition' },
  )
})

test('accepts a complete submission draft', () => {
  assert.equal(validateSubmissionInput(validInput).title, validInput.title)
})

test('new submissions use two kinds while legacy recipes remain editable in place', () => {
  assert.doesNotThrow(() => assertNewSubmissionKind('활동 기록'))
  assert.doesNotThrow(() => assertNewSubmissionKind('자료'))
  assert.throws(() => assertNewSubmissionKind('활동 레시피'), { code: 'invalid-argument' })
  assert.doesNotThrow(() => requireSameSubmissionKind('활동 레시피', '활동 레시피'))
  assert.throws(() => requireSameSubmissionKind('활동 레시피', '자료'), { code: 'failed-precondition' })
})

test('exposes only the owner actions allowed by each submission state', () => {
  assert.equal(submissionOwnerTransition('draft', 'edit'), 'draft')
  assert.equal(submissionOwnerTransition('revision_requested', 'edit'), 'revision_requested')
  assert.equal(submissionOwnerTransition('draft', 'withdraw'), 'withdrawn')
  assert.equal(submissionOwnerTransition('revision_requested', 'withdraw'), 'withdrawn')
  assert.equal(submissionOwnerTransition('review_queued', 'withdraw'), 'withdrawn')
  assert.equal(submissionOwnerTransition('published', 'request_revision'), 'revision_requested')
  assert.equal(submissionOwnerTransition('revision_requested', 'edit'), 'revision_requested')
  assert.equal(submissionOwnerTransition('published', 'unpublish'), 'unpublished')
  assert.equal(submissionOwnerTransition('revision_requested', 'unpublish'), 'unpublished')
  assert.deepEqual(submissionOwnerRecord('revision-material', {
    title: '수정 요청 자료', kind: '자료', status: 'revision_requested', visibility: '공개', sourceMode: 'text',
  }).availableActions, ['edit', 'withdraw', 'unpublish'])
  assert.equal(submissionOwnerTransition('withdrawn', 'restore_private'), 'draft')
  assert.equal(submissionOwnerTransition('unpublished', 'restore_private'), 'draft')
  assert.throws(() => submissionOwnerTransition('review_queued', 'edit'), { code: 'failed-precondition' })
  assert.throws(() => submissionOwnerTransition('publishing', 'withdraw'), { code: 'failed-precondition' })
  assert.throws(() => submissionOwnerTransition('withdrawn', 'request_revision'), { code: 'failed-precondition' })
  assert.throws(() => submissionOwnerTransition('unpublished', 'unpublish'), { code: 'failed-precondition' })
})

test('withdrawn content restores only as a private draft and retries idempotently', () => {
  assert.deepEqual(submissionPrivateDraftRestorePlan({
    status: 'withdrawn', visibility: '공개', sourceMode: 'text', scanStatus: 'not_applicable',
  }), {
    nextStatus: 'draft', visibility: '보류', publicAction: 'hide', alreadyApplied: false,
  })
  assert.deepEqual(submissionPrivateDraftRestorePlan({
    status: 'draft', visibility: '보류', sourceMode: 'text', restoredFromWithdrawal: true,
  }), {
    nextStatus: 'draft', visibility: '보류', publicAction: 'hide', alreadyApplied: true,
  })
  assert.equal(
    submissionOwnerManagementTransition({ status: 'draft', visibility: '보류', restoredFromWithdrawal: true }, 'restore_private'),
    'draft',
  )
  assert.deepEqual(submissionOwnerRecord('restored', {
    status: 'draft', visibility: '보류', restoredFromWithdrawal: true, sourceMode: 'text', scanStatus: 'not_applicable',
  }).availableActions, ['edit', 'withdraw'])
  assert.throws(
    () => submissionOwnerManagementTransition({ status: 'draft', visibility: '보류' }, 'restore_private'),
    { code: 'failed-precondition' },
  )
})

test('owner-unpublished content restores to a private draft, but operator removal cannot be bypassed', () => {
  assert.deepEqual(submissionPrivateDraftRestorePlan({ status: 'unpublished', visibility: '공개', sourceMode: 'text' }), {
    nextStatus: 'draft', visibility: '보류', publicAction: 'hide', alreadyApplied: false,
  })
  assert.deepEqual(submissionPrivateDraftRestorePlan({ status: 'draft', visibility: '보류', restoredFromUnpublication: true }), {
    nextStatus: 'draft', visibility: '보류', publicAction: 'hide', alreadyApplied: true,
  })
  assert.deepEqual(submissionOwnerRecord('unpublished-text', {
    title: '숨긴 기록', kind: '자료', status: 'unpublished', visibility: '공개', sourceMode: 'text', scanStatus: 'not_applicable',
  }).availableActions, ['restore_private'])
  assert.throws(() => submissionPrivateDraftRestorePlan({
    status: 'unpublished', operatorModeration: { action: 'remove' },
  }), { code: 'failed-precondition' })
})

test('private restore keeps source attachment policy distinct and never qualifies for auto publication', () => {
  const restoredText = { ...submissionPrivateDraftRestorePlan({ status: 'withdrawn' }), sourceMode: 'text', scanStatus: 'not_applicable' }
  const restoredLink = { ...submissionPrivateDraftRestorePlan({ status: 'withdrawn' }), sourceMode: 'google_drive_link', scanStatus: 'not_applicable' }
  const restoredUpload = { ...submissionPrivateDraftRestorePlan({ status: 'withdrawn' }), sourceMode: 'upload', scanStatus: 'clean', scanRecordedBy: 'event-driven-file-scanner' }
  assert.equal(attachmentStatusProjection(restoredText), 'not_applicable')
  assert.equal(attachmentStatusProjection(restoredLink), 'not_applicable')
  assert.equal(attachmentStatusProjection(restoredUpload), 'pending')
  assert.equal(automaticUploadPublicationDecision({ ...restoredUpload, status: restoredUpload.nextStatus }), 'exception_queue')
})

test('private text records can return to a draft for editing without opening file review states', () => {
  const privateText = { status: 'review_queued', sourceMode: 'text', visibility: '보류' }
  assert.equal(submissionOwnerManagementTransition(privateText, 'edit'), 'draft')
  assert.equal(submissionOwnerManagementTransition(privateText, 'withdraw'), 'withdrawn')
  assert.throws(
    () => submissionOwnerManagementTransition({ ...privateText, sourceMode: 'upload' }, 'edit'),
    { code: 'failed-precondition' },
  )
  assert.throws(
    () => submissionOwnerManagementTransition({ ...privateText, status: 'withdrawn' }, 'edit'),
    { code: 'failed-precondition' },
  )
  assert.equal(submissionEditableRecord('private-text', {
    ...privateText,
    kind: '활동 기록',
    textContent: { schemaVersion: 1, format: 'markdown', body: '수정할 본문' },
  }).status, 'draft')
})

test('owner projection keeps lifecycle, visibility, source and attachment states independent', () => {
  assert.deepEqual(submissionOwnerRecord('private-text', {
    title: '나만 보는 회의 기록',
    kind: '활동 기록',
    status: 'review_queued',
    visibility: '보류',
    sourceMode: 'text',
    scanStatus: 'not_applicable',
  }), {
    id: 'private-text',
    title: '나만 보는 회의 기록',
    kind: '활동 기록',
    status: 'review_queued',
    visibility: '보류',
    sourceMode: 'text',
    scanStatus: 'not_applicable',
    attachmentStatus: 'not_applicable',
    nextActionReason: 'none',
    availableActions: ['edit', 'withdraw'],
  })
  assert.deepEqual(submissionOwnerRecord('withdrawn-text', {
    title: '철회한 회의 기록',
    kind: '활동 기록',
    status: 'withdrawn',
    visibility: '보류',
    sourceMode: 'text',
    scanStatus: 'not_applicable',
  }).availableActions, ['restore_private'])
})

test('rejects another member before any submission mutation', () => {
  assert.doesNotThrow(() => requireSubmissionOwner('member-1', 'member-1'))
  assert.throws(() => requireSubmissionOwner('member-2', 'member-1'), { code: 'permission-denied' })
  assert.throws(() => requireSubmissionOwner(undefined, 'member-1'), { code: 'permission-denied' })
})

test('projects a bounded owner record without private account fields', () => {
  const record = submissionOwnerRecord('submission-1', {
    title: ' 청년 정기훈련 기록 ',
    kind: '활동 기록',
    status: 'published',
    visibility: '공개',
    sourceMode: 'upload',
    scanStatus: 'clean',
    attachmentStatus: 'clean',
    previewStatus: 'ready',
    ownerUid: 'private-member-id',
    reviewerUid: 'private-reviewer-id',
    createdAt: { toMillis: () => 100 },
    updatedAt: { toMillis: () => 200 },
  })
  assert.deepEqual(record, {
    id: 'submission-1',
    title: '청년 정기훈련 기록',
    kind: '활동 기록',
    status: 'published',
    visibility: '공개',
    sourceMode: 'upload',
    createdAtMs: 100,
    updatedAtMs: 200,
    scanStatus: 'clean',
    attachmentStatus: 'clean',
    previewStatus: 'ready',
    nextActionReason: 'none',
    availableActions: ['request_revision', 'unpublish'],
  })
  assert.equal('ownerUid' in record, false)
  assert.equal('reviewerUid' in record, false)
})

test('owner projection exposes bounded scan and cleanup next-action states', () => {
  assert.deepEqual(submissionOwnerRecord('submission-blocked', {
    title: '검사 예외 자료',
    kind: '자료',
    status: 'exception_queued',
    visibility: '보류',
    sourceMode: 'upload',
    scanStatus: 'blocked',
    attachmentStatus: 'blocked',
    cleanupState: 'dead_letter',
    scanAttestation: { private: true },
    scanFailureCode: 'private-engine-detail',
  }), {
    id: 'submission-blocked',
    title: '검사 예외 자료',
    kind: '자료',
    status: 'exception_queued',
    visibility: '보류',
    sourceMode: 'upload',
    scanStatus: 'blocked',
    attachmentStatus: 'blocked',
    cleanupState: 'dead_letter',
    nextActionReason: 'scan_blocked_operator_review',
    availableActions: ['withdraw'],
  })
})

test('only ordinary clean upload submissions qualify for automatic publication', () => {
  const ready = {
    status: 'review_queued',
    sourceMode: 'upload',
    visibility: '공개',
    scanStatus: 'clean',
    scanRecordedBy: 'event-driven-file-scanner',
  }
  assert.equal(automaticUploadPublicationDecision(ready), 'auto_publish')
  assert.equal(automaticUploadPublicationDecision({ ...ready, scanStatus: 'blocked' }), 'exception_queue')
  assert.equal(automaticUploadPublicationDecision({ ...ready, visibility: '보류' }), 'exception_queue')
  assert.equal(automaticUploadPublicationDecision({ ...ready, scanRecordedBy: 'manual-attestor' }), 'exception_queue')
  assert.equal(automaticUploadPublicationDecision({ ...ready, sourceMode: 'google_drive_link' }), 'exception_queue')
})

test('private clean uploads remain owner-ready without entering an operator exception', () => {
  const ready = {
    status: 'review_queued', sourceMode: 'upload', visibility: '보류', scanStatus: 'clean',
    scanRecordedBy: 'event-driven-file-scanner',
  }
  assert.equal(privateCleanUploadDecision(ready), 'ready')
  assert.equal(privateCleanUploadDecision({ ...ready, status: 'exception_queued' }), 'ready', 'legacy visibility_hold is repairable')
  assert.equal(privateCleanUploadDecision({ ...ready, scanStatus: 'blocked' }), 'not_private')
  assert.equal(privateCleanUploadDecision({ ...ready, operatorModeration: { action: 'hold' } }), 'not_private')
  assert.deepEqual(submissionOwnerRecord('legacy-private', {
    ...ready,
    status: 'exception_queued',
    title: '나만 보는 첨부',
    kind: '자료',
    attachmentStatus: 'error',
  }), {
    id: 'legacy-private',
    title: '나만 보는 첨부',
    kind: '자료',
    status: 'review_queued',
    visibility: '보류',
    sourceMode: 'upload',
    scanStatus: 'clean',
    attachmentStatus: 'clean',
    nextActionReason: 'none',
    availableActions: ['withdraw'],
  })
})

test('operator exception cursor is stable and page size is bounded to 25', () => {
  const cursor = encodeSubmissionExceptionCursor({
    seconds: 1_721_800_000,
    nanoseconds: 123_456_789,
    id: 'exception-25',
  })
  assert.deepEqual(decodeSubmissionExceptionCursor(cursor), {
    seconds: 1_721_800_000,
    nanoseconds: 123_456_789,
    id: 'exception-25',
  })
  assert.equal(decodeSubmissionExceptionCursor(undefined), null)
  assert.equal(submissionExceptionPageSize(undefined), 25)
  assert.equal(submissionExceptionPageSize(1), 1)
  assert.equal(submissionExceptionPageSize(25), 25)
  assert.equal(submissionExceptionPageSize(26), 25)
  assert.equal(submissionExceptionPageSize(50), 25)
  assert.throws(() => decodeSubmissionExceptionCursor('not-a-cursor'), { code: 'invalid-argument' })
  assert.throws(() => decodeSubmissionExceptionCursor(encodeSubmissionExceptionCursor({
    seconds: -62_135_596_801,
    nanoseconds: 0,
    id: 'exception-25',
  })), { code: 'invalid-argument' })
})

test('submission value cursors preserve 100, 1000 and 10000 record ordering and recovery', () => {
  type Fixture = { id: string; seconds: number; nanoseconds: number }
  const afterCursor = (record: Fixture, encodedCursor: string | null) => {
    const cursor = decodeSubmissionExceptionCursor(encodedCursor)
    if (!cursor) return true
    if (record.seconds !== cursor.seconds) return record.seconds < cursor.seconds
    if (record.nanoseconds !== cursor.nanoseconds) return record.nanoseconds < cursor.nanoseconds
    return record.id < cursor.id
  }
  const page = (records: Fixture[], encodedCursor: string | null, pageSize: number) => {
    const matches = records.filter((record) => afterCursor(record, encodedCursor)).slice(0, pageSize + 1)
    const items = matches.slice(0, pageSize)
    return {
      items,
      hasMore: matches.length > pageSize,
      nextCursor: matches.length > pageSize && items.length
        ? encodeSubmissionExceptionCursor(items[items.length - 1] as Fixture)
        : null,
    }
  }

  for (const total of [100, 1_000, 10_000]) {
    const records = Array.from({ length: total }, (_, index) => ({
      id: `submission-${String(total - index).padStart(5, '0')}`,
      seconds: 1_900_000_000 - Math.floor(index / 11),
      nanoseconds: 990_000_000 - (index % 11),
    }))
    for (const pageSize of [25, 100]) {
      const collected: string[] = []
      let cursor: string | null = null
      do {
        const result = page(records, cursor, pageSize)
        assert.ok(result.items.length <= pageSize)
        collected.push(...result.items.map((record) => record.id))
        cursor = result.nextCursor
      } while (cursor)
      assert.deepEqual(collected, records.map((record) => record.id))
      assert.equal(new Set(collected).size, total)
      if (total > 100) assert.equal(collected[100], records[100]?.id)
    }

    const first = page(records, null, 25)
    assert.ok(first.nextCursor)
    const replay = page(records, first.nextCursor, 25)
    assert.deepEqual(replay, page(records, first.nextCursor, 25))
    const withoutCursorRecord = records.filter((record) => record.id !== first.items.at(-1)?.id)
    assert.deepEqual(page(withoutCursorRecord, first.nextCursor, 25), replay)
  }
})

test('submission sort migration accepts only a server-owned cursor flow', () => {
  assert.equal(validateSubmissionSortMigrationCommand({ action: 'dry_run' }), 'dry_run')
  assert.equal(validateSubmissionSortMigrationCommand({ action: 'apply' }), 'apply')
  assert.throws(
    () => validateSubmissionSortMigrationCommand({ action: 'apply', cursor: 'submission-9999' }),
    { code: 'invalid-argument' },
  )
  assert.throws(
    () => validateSubmissionSortMigrationCommand({ action: 'apply', progress: 9_999 }),
    { code: 'invalid-argument' },
  )
  assert.throws(() => validateSubmissionSortMigrationCommand({ action: 'reset' }), { code: 'invalid-argument' })
})

test('submission sort migration rejects parallel and stale workers', () => {
  const now = 10_000
  assert.equal(assertSubmissionSortMigrationClaimable({}, now), 'backfill')
  assert.equal(assertSubmissionSortMigrationClaimable({
    schemaVersion: 1,
    phase: 'complete',
  }, now), 'complete')
  assert.equal(assertSubmissionSortMigrationClaimable({
    schemaVersion: 0,
    phase: 'complete',
  }, now), 'backfill')
  assert.equal(submissionSortMigrationCursorId({
    schemaVersion: 0,
    phase: 'verify',
    verificationCursorId: 'attacker-skip-point',
  }, 'backfill'), null)
  assert.equal(submissionSortMigrationCursorId({
    schemaVersion: 1,
    phase: 'backfill',
    backfillCursorId: 'submission-0200',
  }, 'backfill'), 'submission-0200')
  assert.equal(assertSubmissionSortMigrationClaimable({
    schemaVersion: 0,
    phase: 'verify',
    verificationCursorId: 'attacker-skip-point',
  }, now), 'backfill')
  assert.equal(assertSubmissionSortMigrationClaimable({
    schemaVersion: 0,
    phase: 'backfill',
    backfillCursorId: 'attacker-skip-point',
  }, now), 'backfill')
  assert.throws(() => assertSubmissionSortMigrationClaimable({
    phase: 'backfill',
    leaseToken: 'live-worker',
    leaseExpiresAt: Timestamp.fromMillis(now + 1),
  }, now), { code: 'aborted' })
  assert.equal(assertSubmissionSortMigrationClaimable({
    phase: 'backfill',
    leaseToken: 'expired-worker',
    leaseExpiresAt: Timestamp.fromMillis(now),
  }, now), 'backfill')

  assert.doesNotThrow(() => assertSubmissionSortMigrationLease({
    schemaVersion: 1,
    phase: 'verify',
    verificationCursorId: 'submission-0200',
    leaseToken: 'current-worker',
    leaseExpiresAt: Timestamp.fromMillis(now + 1),
  }, {
    phase: 'verify',
    cursorId: 'submission-0200',
    token: 'current-worker',
    nowMs: now,
  }))
  assert.throws(() => assertSubmissionSortMigrationLease({
    schemaVersion: 1,
    phase: 'verify',
    verificationCursorId: 'submission-0400',
    leaseToken: 'new-worker',
  }, {
    phase: 'verify',
    cursorId: 'submission-0200',
    token: 'stale-worker',
    nowMs: now,
  }), { code: 'aborted' })
  assert.throws(() => assertSubmissionSortMigrationLease({
    schemaVersion: 1,
    phase: 'verify',
    verificationCursorId: 'submission-0200',
    leaseToken: 'expired-worker',
    leaseExpiresAt: Timestamp.fromMillis(now),
  }, {
    phase: 'verify',
    cursorId: 'submission-0200',
    token: 'expired-worker',
    nowMs: now,
  }), { code: 'aborted' })
})

test('submission sort migration requires a complete second document-id pass', () => {
  assert.equal(submissionSortMigrationNextPhase('backfill', 200), 'backfill')
  assert.equal(submissionSortMigrationNextPhase('backfill', 199), 'verify')
  assert.equal(submissionSortMigrationNextPhase('verify', 200), 'verify')
  assert.equal(submissionSortMigrationNextPhase('verify', 199), 'complete')
  assert.equal(submissionSortMigrationNextPhase('verify', 0, 1), 'backfill')
  assert.equal(submissionSortMigrationNextPhase('complete', 0), 'complete')
})

test('submission sort migration derives a total immutable timestamp for legacy records', () => {
  const createdAt = new Timestamp(1_900_000_000, 123_456_789)
  const updatedAt = new Timestamp(1_800_000_000, 987_654_321)
  assert.equal(submissionSortCreatedAt({ createdAt, updatedAt }), createdAt)
  assert.equal(submissionSortCreatedAt({ createdAt: 'invalid', updatedAt }), updatedAt)
  assert.deepEqual(submissionSortCreatedAt({}), new Timestamp(0, 0))
  assert.deepEqual(
    submissionSortCreatedAt({ createdAt: null, updatedAt: { seconds: 12 } }),
    new Timestamp(0, 0),
  )
  assert.deepEqual(
    submissionSortCreatedAtRepair({ createdAt, sortCreatedAt: 'invalid' }),
    { sortCreatedAt: createdAt },
  )
  assert.deepEqual(
    submissionSortCreatedAtRepair({ updatedAt, sortCreatedAt: null }),
    { sortCreatedAt: updatedAt },
  )
  assert.deepEqual(
    submissionSortCreatedAtRepair({ sortCreatedAt: new Timestamp(10, 1) }),
    { sortCreatedAt: new Timestamp(0, 0) },
  )
  assert.equal(submissionSortCreatedAtRepair({ createdAt, sortCreatedAt: createdAt }), null)
})

test('owner submission cursor pagination reaches every record with stable identical timestamp ties', () => {
  type Fixture = { id: string; seconds: number; nanoseconds: number }
  const afterCursor = (record: Fixture, encodedCursor: string | null) => {
    const cursor = decodeOwnerSubmissionCursor(encodedCursor)
    if (!cursor) return true
    if (record.seconds !== cursor.seconds) return record.seconds < cursor.seconds
    if (record.nanoseconds !== cursor.nanoseconds) return record.nanoseconds < cursor.nanoseconds
    return record.id < cursor.id
  }
  const page = (records: Fixture[], encodedCursor: string | null, pageSize: number) => {
    const matches = records.filter((record) => afterCursor(record, encodedCursor)).slice(0, pageSize + 1)
    const items = matches.slice(0, pageSize)
    const hasMore = matches.length > pageSize
    const nextCursor = hasMore && items.length
      ? encodeOwnerSubmissionCursor(items.at(-1) as Fixture)
      : null
    assert.equal(hasMore, nextCursor !== null)
    return { items, hasMore, nextCursor }
  }

  for (const total of [100, 1_000, 10_000]) {
    const records = Array.from({ length: total }, (_, index) => ({
      id: `submission-${String(total - index).padStart(5, '0')}`,
      seconds: 1_900_000_000 - Math.floor(index / 37),
      nanoseconds: index % 74 < 37 ? 777_777_777 : 111_111_111,
    })).sort((left, right) => (
      right.seconds - left.seconds
      || right.nanoseconds - left.nanoseconds
      || right.id.localeCompare(left.id)
    ))
    const collected: string[] = []
    let cursor: string | null = null
    do {
      const result = page(records, cursor, ownerSubmissionPageSize(50))
      collected.push(...result.items.map((record) => record.id))
      cursor = result.nextCursor
    } while (cursor)
    assert.deepEqual(collected, records.map((record) => record.id))
    assert.equal(new Set(collected).size, total)
    if (total > 100) assert.equal(collected[100], records[100]?.id)
  }

  assert.equal(ownerSubmissionPageSize(undefined), 50)
  assert.equal(ownerSubmissionPageSize(999), 50)
  assert.throws(() => ownerSubmissionPageSize(0), { code: 'invalid-argument' })
  assert.throws(() => decodeOwnerSubmissionCursor('attacker-controlled-cursor'), { code: 'invalid-argument' })
})

test('submission exception queue is restricted to moderator and administrator roles', () => {
  assert.doesNotThrow(() => requireSubmissionOperator({ role: 'moderator' }))
  assert.doesNotThrow(() => requireSubmissionOperator({ role: 'administrator' }))
  assert.throws(() => requireSubmissionOperator({ role: 'member' }), { code: 'permission-denied' })
  assert.throws(() => requireSubmissionOperator(undefined), { code: 'permission-denied' })
})

test('operator exception projection joins only bounded non-sensitive submission fields', () => {
  const record = submissionOperatorExceptionRecord('exception-1', {
    submissionId: 'submission-1',
    type: 'automatic_publication_failed',
    status: 'open',
    createdAt: Timestamp.fromMillis(1_721_800_000_000),
    internalError: 'private-stack',
  }, {
    title: ' 자동 게시 실패 자료 ',
    kind: '활동 기록',
    status: 'publishing_failed',
    sourceMode: 'upload',
    scanStatus: 'clean',
    scanRecordedBy: 'event-driven-file-scanner',
    cleanupState: 'failed',
    ownerUid: 'private-owner',
    reviewerUid: 'private-reviewer',
    scanAttestation: { scanId: 'private-scan' },
  })
  assert.deepEqual(record, {
    id: 'exception-1',
    submissionId: 'submission-1',
    type: 'automatic_publication_failed',
    status: 'open',
    title: '자동 게시 실패 자료',
    kind: '활동 기록',
    sourceMode: 'upload',
    scanStatus: 'clean',
    cleanupState: 'failed',
    createdAt: 1_721_800_000_000,
    createdAtMs: 1_721_800_000_000,
    nextActions: ['request_revision', 'retry_publication'],
  })
  assert.equal(record && 'ownerUid' in record, false)
  assert.equal(record && 'reviewerUid' in record, false)
  assert.equal(record && 'scanAttestation' in record, false)
})

test('operator exception actions expose only server-enforced safe transitions', () => {
  assert.deepEqual(allowedSubmissionExceptionActions({
    type: 'scan_failed',
    status: 'open',
  }, {
    status: 'exception_queued',
    sourceMode: 'upload',
    scanStatus: 'error',
  }), ['request_revision'])
  assert.deepEqual(allowedSubmissionExceptionActions({
    type: 'cleanup_dead_letter',
    status: 'open',
  }, {
    status: 'unpublished',
    cleanupState: 'dead_letter',
  }, {
    planVersion: 1,
    objects: [{ path: 'managed/submission/file.pdf', generation: '17' }],
  }), ['retry_cleanup', 'dismiss'])
  assert.deepEqual(allowedSubmissionExceptionActions({
    type: 'cleanup_dead_letter',
    status: 'open',
  }, {
    status: 'unpublished',
    cleanupState: 'dead_letter',
  }, {
    planVersion: 1,
    objects: [{ path: 'managed/submission/file.pdf' }],
  }), ['dismiss'])
  assert.deepEqual(allowedSubmissionExceptionActions({
    type: 'automatic_publication_failed',
    status: 'open',
  }, {
    status: 'publishing_failed',
    sourceMode: 'upload',
    scanStatus: 'clean',
    scanRecordedBy: 'event-driven-file-scanner',
  }), ['request_revision', 'retry_publication'])
  assert.deepEqual(allowedSubmissionExceptionActions({
    type: 'scan_failed',
    status: 'open',
  }, {
    status: 'published',
    sourceMode: 'upload',
    scanStatus: 'clean',
  }), [])
})

test('successfully published clean uploads are excluded from the operator exception queue', () => {
  assert.equal(submissionOperatorExceptionRecord('exception-stale', {
    submissionId: 'submission-published',
    type: 'scan_failed',
    status: 'open',
    createdAt: Timestamp.fromMillis(1_721_800_000_000),
  }, {
    title: '이미 자동 게시된 자료',
    kind: '자료',
    status: 'published',
    sourceMode: 'upload',
    scanStatus: 'clean',
  }), null)
})

test('returns an editable owner draft without review, scan or operator fields', () => {
  const record = submissionEditableRecord('submission-edit-1', {
    ...validInput,
    status: 'revision_requested',
    ownerUid: 'private-member-id',
    reviewerUid: 'private-reviewer-id',
    scanAttestation: { scanId: 'private-scan-id' },
    approvalLeaseExpiresAt: 'private-lease',
    reviewNote: 'private-note',
    activity: {
      topic: '관계와 공동체', type: '대화 모임', date: '2026-07-23', place: '서울',
      summary: '함께 나눈 기록', story: '준비한 이야기', outcome: '다음 약속', nextAction: '다시 만나기',
    },
  }, 2)
  assert.equal(record.id, 'submission-edit-1')
  assert.equal(record.status, 'revision_requested')
  assert.equal(record.existingFileCount, 2)
  assert.equal('ownerUid' in record, false)
  assert.equal('reviewerUid' in record, false)
  assert.equal('scanAttestation' in record, false)
  assert.equal('approvalLeaseExpiresAt' in record, false)
  assert.equal('reviewNote' in record, false)
  assert.throws(() => submissionEditableRecord('submission-locked', { ...validInput, status: 'review_queued' }), { code: 'failed-precondition' })
  assert.throws(() => submissionEditableRecord('submission-other', { ...validInput, status: 'published' }), { code: 'failed-precondition' })
})

test('keeps the original source mode while an owner edits a submission', () => {
  assert.doesNotThrow(() => requireSameSubmissionSourceMode('upload', 'upload'))
  assert.doesNotThrow(() => requireSameSubmissionSourceMode('google_drive_link', 'google_drive_link'))
  assert.doesNotThrow(() => requireSameSubmissionSourceMode('instagram_url', 'instagram_url'))
  assert.throws(() => requireSameSubmissionSourceMode('upload', 'google_drive_link'), { code: 'failed-precondition' })
  assert.throws(() => requireSameSubmissionSourceMode('instagram_url', 'upload'), { code: 'failed-precondition' })
})

test('normalizes optional public Instagram references and keeps them in activity publication', () => {
  const result = validateSubmissionInput({
    ...validInput,
    kind: '활동 기록',
    instagramAttachments: [{
      sourceUrl: 'https://instagram.com/p/AbC_123/?igsh=tracking',
      originalAuthor: '@won_buddhism_youth',
    }],
    activity: {
      topic: '관계와 공동체', type: '대화 모임', date: '2026-07-22', place: '서울',
      summary: '함께 나눈 기록', story: '모임을 시작했어요', outcome: '다음 이야기를 정했어요', nextAction: '다시 만나요',
    },
  })
  assert.deepEqual(result.instagramAttachments, [{
    sourceUrl: 'https://www.instagram.com/p/AbC_123/',
    mediaType: 'post',
    shortcode: 'AbC_123',
    originalAuthor: 'won_buddhism_youth',
  }])
  assert.deepEqual(buildActivityPublication('submission-instagram-1', result, 'public')?.instagramAttachments, result.instagramAttachments)
})

test('rejects unsupported and duplicate Instagram references at the submission boundary', () => {
  assert.throws(() => validateSubmissionInput({
    ...validInput,
    instagramAttachments: [{ sourceUrl: 'https://example.com/p/AbC_123/' }],
  }), { code: 'invalid-argument' })
  assert.throws(() => validateSubmissionInput({
    ...validInput,
    instagramAttachments: [
      { sourceUrl: 'https://instagram.com/reel/ZXy-987/?igsh=one' },
      { sourceUrl: 'https://www.instagram.com/reel/ZXy-987/?igsh=two' },
    ],
  }), { code: 'invalid-argument' })
})

test('accepts Instagram links as the only source and requires at least one public reference', () => {
  const result = validateSubmissionInput({
    ...validInput,
    sourceMode: 'instagram_url',
    redistribution: 'source_link_only',
    retention: 'source_link',
    instagramAttachments: [{
      sourceUrl: 'https://www.instagram.com/reel/ZXy-987/?igsh=tracking',
      originalAuthor: '@won_buddhism_youth',
    }],
  })
  assert.equal(result.sourceMode, 'instagram_url')
  assert.equal(result.sourceLink, undefined)
  assert.deepEqual(result.instagramAttachments, [{
    sourceUrl: 'https://www.instagram.com/reel/ZXy-987/',
    mediaType: 'reel',
    shortcode: 'ZXy-987',
    originalAuthor: 'won_buddhism_youth',
  }])
  const [attachment] = result.instagramAttachments ?? []
  assert.ok(attachment)
  assert.notEqual(
    instagramAttachmentsFingerprint(result.instagramAttachments ?? []),
    instagramAttachmentsFingerprint([{ ...attachment, originalAuthor: 'another_author' }]),
  )
  assert.throws(() => validateSubmissionInput({
    ...validInput,
    sourceMode: 'instagram_url',
    redistribution: 'source_link_only',
    retention: 'source_link',
  }), { code: 'invalid-argument' })
})

test('lets an owner publish their own visible Google or Instagram reference', () => {
  assert.equal(canSubmissionOwnerPublish({
    actorUid: 'member-1',
    ownerUid: 'member-1',
    sourceMode: 'instagram_url',
    visibility: '회원 전용',
  }), true)
  assert.equal(canSubmissionOwnerPublish({
    actorUid: 'member-1',
    ownerUid: 'member-2',
    sourceMode: 'instagram_url',
    visibility: '공개',
  }), false)
  assert.equal(canSubmissionOwnerPublish({
    actorUid: 'member-1',
    ownerUid: 'member-1',
    sourceMode: 'google_drive_link',
    visibility: '공개',
  }), true)
  assert.equal(canSubmissionOwnerPublish({
    actorUid: 'member-1',
    ownerUid: 'member-1',
    sourceMode: 'instagram_url',
    visibility: '보류',
  }), false)
})

test('requires consent before an upload draft is created', () => {
  assert.throws(() => validateSubmissionInput({ ...validInput, consentConfirmed: false }), { code: 'failed-precondition' })
})

test('canonicalizes Google source links and forces link-only rights', () => {
  const result = validateSubmissionInput({
    ...validInput,
    sourceMode: 'google_drive_link',
    sourceLinkUrl: `${sourceLinkUrl}?usp=sharing`,
    redistribution: 'source_link_only',
    retention: 'source_link',
  })
  assert.equal(result.sourceMode, 'google_drive_link')
  assert.equal(result.sourceLink?.sourceUrl, sourceLinkUrl)
  assert.equal(result.sourceLink?.publicAccessVerified, false)
})

test('rejects mixed or incorrectly retained Google source submissions', () => {
  assert.throws(() => validateSubmissionInput({
    ...validInput,
    sourceMode: 'google_drive_link',
    sourceLinkUrl,
  }), { code: 'invalid-argument' })
  assert.throws(() => validateSubmissionInput({
    ...validInput,
    sourceMode: 'upload',
    sourceLinkUrl,
  }), { code: 'invalid-argument' })
  assert.throws(() => validateSubmissionInput({
    ...validInput,
    sourceMode: 'google_drive_link',
    sourceLinkUrl: 'https://example.com/file',
    redistribution: 'source_link_only',
    retention: 'source_link',
  }), { code: 'invalid-argument' })
})

test('requires a current manual verification for the exact source fingerprint', () => {
  const source = buildGoogleDriveSourceLink(sourceLinkUrl)
  const fingerprint = googleDriveSourceFingerprint(source)
  const verification = {
    status: 'verified' as const,
    verificationId: 'verification-1',
    sourceFingerprint: fingerprint,
    verifiedAt: Timestamp.fromMillis(1_000),
    reviewDueAt: Timestamp.fromMillis(20_000),
  }
  assert.equal(sourceLinkApprovalFingerprint(source, verification, 10_000), fingerprint)
  assert.throws(() => sourceLinkApprovalFingerprint(source, { ...verification, status: 'pending' }, 10_000), { code: 'failed-precondition' })
  assert.throws(() => sourceLinkApprovalFingerprint(source, { ...verification, sourceFingerprint: 'changed' }, 10_000), { code: 'failed-precondition' })
  assert.throws(() => sourceLinkApprovalFingerprint(source, verification, 20_000), { code: 'failed-precondition' })
})

test('enforces exactly one source mode at submission time', () => {
  assert.doesNotThrow(() => assertSubmissionFilePolicy('upload', 1))
  assert.doesNotThrow(() => assertSubmissionFilePolicy('google_drive_link', 0))
  assert.doesNotThrow(() => assertSubmissionFilePolicy('instagram_url', 0))
  assert.throws(() => assertSubmissionFilePolicy('upload', 0), { code: 'failed-precondition' })
  assert.throws(() => assertSubmissionFilePolicy('google_drive_link', 1), { code: 'failed-precondition' })
  assert.throws(() => assertSubmissionFilePolicy('instagram_url', 1), { code: 'failed-precondition' })
  assert.throws(() => assertSubmissionFilePolicy('upload', 21), { code: 'failed-precondition' })
})

test('requires an explicit signed-out viewer attestation from the operator', () => {
  assert.deepEqual(validateSourceLinkVerificationAttestation({
    checkedWithoutSignIn: true,
    accessLevel: 'anyone_with_link_viewer',
    note: ' 시크릿 창에서 원본 열람 확인 ',
  }), {
    checkedWithoutSignIn: true,
    accessLevel: 'anyone_with_link_viewer',
    note: '시크릿 창에서 원본 열람 확인',
  })
  assert.throws(() => validateSourceLinkVerificationAttestation({
    checkedWithoutSignIn: false,
    accessLevel: 'anyone_with_link_viewer',
    note: '확인함',
  }), { code: 'failed-precondition' })
  assert.throws(() => validateSourceLinkVerificationAttestation({
    checkedWithoutSignIn: true,
    accessLevel: 'editor',
    note: '확인함',
  }), { code: 'failed-precondition' })
})

test('upload publication stays closed until the event-driven scanner is configured and recorded the result', () => {
  assert.doesNotThrow(() => assertAutomatedScanPublicationReady(
    'https://scanner.internal.example',
    'event-driven-file-scanner',
  ))
  assert.doesNotThrow(() => assertAutomatedScanPublicationReady('', 'event-driven-file-scanner'))
  for (const invalid of ['http://scanner.internal.example', 'https://', 'not-a-url']) {
    assert.throws(
      () => assertAutomatedScanPublicationReady(invalid, 'event-driven-file-scanner'),
      (error: HttpsError) => error.code === 'failed-precondition',
    )
  }
  assert.throws(
    () => assertAutomatedScanPublicationReady('https://scanner.internal.example', 'manual-attestor'),
    (error: HttpsError) => error.code === 'failed-precondition',
  )
})

test('validates and trims optional activity metadata for activity records', () => {
  const result = validateSubmissionInput({
    ...validInput,
    kind: '활동 기록',
    activity: {
      topic: '관계와 공동체',
      type: ' 정기훈련 ',
      date: ' 2026년 7월 22일 ',
      place: ' 서울 ',
      summary: ' 함께 배우고 나눈 하루 ',
      story: ' 준비부터 마무리까지의 기록 ',
      outcome: ' 다음 모임의 진행자를 정함 ',
      nextAction: ' 후속 자료 공유 ',
    },
  })
  assert.deepEqual(result.activity, {
    topic: '관계와 공동체',
    type: '정기훈련',
    date: '2026년 7월 22일',
    place: '서울',
    summary: '함께 배우고 나눈 하루',
    story: '준비부터 마무리까지의 기록',
    outcome: '다음 모임의 진행자를 정함',
    nextAction: '후속 자료 공유',
  })
})

test('rejects activity metadata on other kinds and invalid activity fields', () => {
  assert.throws(() => validateSubmissionInput({ ...validInput, activity: { summary: '상세 기록' } }), { code: 'invalid-argument' })
  assert.throws(() => validateSubmissionInput({ ...validInput, kind: '활동 기록', activity: { topic: '없는 주제' } }), { code: 'invalid-argument' })
  assert.throws(() => validateSubmissionInput({ ...validInput, kind: '활동 기록', activity: { story: '가'.repeat(4_001) } }), { code: 'invalid-argument' })
  assert.throws(() => validateSubmissionInput({ ...validInput, kind: '활동 기록', activity: { summary: '기록' }, recipe: { purpose: '목적' } }), { code: 'invalid-argument' })
})

test('keeps detailed activity fields optional when a summary is present', () => {
  const result = validateSubmissionInput({
    ...validInput,
    kind: '활동 기록',
    activity: { topic: '관계와 공동체', summary: '일부 필드만 입력' },
  })
  assert.deepEqual(result.activity, {
    topic: '관계와 공동체',
    type: '',
    date: '',
    place: '',
    summary: '일부 필드만 입력',
    story: '일부 필드만 입력',
    outcome: '',
    nextAction: '',
  })
})

test('builds the exact public activity reader record and deterministic material link', () => {
  const input = validateSubmissionInput({
    ...validInput,
    kind: '활동 기록',
    activity: {
      topic: '배움과 신앙',
      type: '마음공부',
      date: '2026년 여름',
      place: '온라인',
      summary: '마음공부를 함께 시작했어요',
      story: '질문을 나누며 공부했어요',
      outcome: '다음 공부 주제를 정했어요',
      nextAction: '한 달 뒤 다시 만나요',
    },
  })
  const first = buildActivityPublication('submission-activity-1', input, 'public')
  const retry = buildActivityPublication('submission-activity-1', input, 'public')
  assert.deepEqual(first, retry)
  assert.deepEqual(first, {
    slug: 'submission-activity-1',
    title: validInput.title,
    topic: '배움과 신앙',
    type: '마음공부',
    date: '2026년 여름',
    place: '온라인',
    summary: '마음공부를 함께 시작했어요',
    story: '질문을 나누며 공부했어요',
    outcome: '다음 공부 주제를 정했어요',
    nextAction: '한 달 뒤 다시 만나요',
    tone: 'blueprint',
    status: 'published',
    visibility: 'public',
    submissionId: 'submission-activity-1',
    materialId: 'submission-activity-1',
    owner: validInput.owner,
    source: validInput.source,
    attribution: validInput.attribution,
  })
})

test('does not publish activity documents for non-activity records', () => {
  const input = validateSubmissionInput(validInput)
  assert.equal(buildActivityPublication('submission-material-1', input, 'public'), null)
})

test('keeps legacy activity submissions material-only when detailed activity data is absent', () => {
  const input = validateSubmissionInput({ ...validInput, kind: '활동 기록', visibility: '회원 전용' })
  const activity = buildActivityPublication('submission-private-1', input, 'member_only')
  assert.equal(activity, null)
})

test('publishes activity recipes with private visibility and reader-compatible recipe fields', () => {
  const input = validateSubmissionInput({
    ...validInput,
    kind: '활동 레시피',
    visibility: '회원 전용',
    activity: {
      topic: '관계와 공동체',
      type: '활동 레시피',
      date: '2026년 여름',
      place: '서울',
      summary: '함께 행사를 만드는 방법',
      story: '역할을 나누며 준비했어요',
      outcome: '운영 순서를 정리했어요',
      nextAction: '다음 행사에서 활용해요',
    },
    recipe: {
      purpose: ' 처음 기획하는 사람도 참여하게 해요 ',
      preparation: ' 역할과 일정을 나눠요 ',
      promotion: ' 초대할 사람부터 떠올려요 ',
      lessons: ' 행사가 끝나면 바로 회고해요 ',
    },
  })
  const activity = buildActivityPublication('submission-recipe-1', input, 'member_only')
  assert.equal(activity?.visibility, 'member_only')
  assert.equal(activity?.type, '활동 레시피')
  assert.deepEqual(activity?.recipe, {
    purpose: '처음 기획하는 사람도 참여하게 해요',
    preparation: '역할과 일정을 나눠요',
    promotion: '초대할 사람부터 떠올려요',
    lessons: '행사가 끝나면 바로 회고해요',
  })
})

test('uses merge-set semantics so an activity document from a prior partial attempt is safely updated', () => {
  assert.deepEqual(activityPublicationSetOptions, { merge: true })
})

const cleanAttestation: ScanAttestation = {
  schemaVersion: 1,
  verdict: 'clean',
  provider: 'test-scanner',
  scanId: 'scan-001',
  engineVersion: '1.0.0',
  scannedAtMs: 1_000,
  objects: [
    { path: 'quarantined/user/submission/z.pdf', generation: '2', size: 20, contentHash: 'md5:z' },
    { path: 'quarantined/user/submission/a.pdf', generation: '1', size: 10, contentHash: 'md5:a' },
  ],
}

test('builds a deterministic private copy manifest and stable material paths', () => {
  const first = buildApprovalCopyManifest('submission-1', cleanAttestation)
  const second = buildApprovalCopyManifest('submission-1', cleanAttestation)

  assert.deepEqual(first, second)
  assert.deepEqual(first.map((entry) => entry.path), [
    'quarantined/user/submission/a.pdf',
    'quarantined/user/submission/z.pdf',
  ])
  assert.ok(first.every((entry) => entry.destinationPath.startsWith('managed/submission-1/')))
  assert.ok(first.every((entry) => entry.state === 'pending'))
})

test('preserves completed copy progress only for the exact scanned generation and hash', () => {
  const pending = buildApprovalCopyManifest('submission-1', cleanAttestation)
  const completed = markApprovalCopyComplete(pending, pending[0].destinationPath, 2_000)
  const resumed = buildApprovalCopyManifest('submission-1', cleanAttestation, completed)
  assert.equal(resumed[0].state, 'copied')
  assert.equal(resumed[0].copiedAtMs, 2_000)

  const changed: ScanAttestation = {
    ...cleanAttestation,
    objects: cleanAttestation.objects.map((entry) => entry.path.endsWith('/a.pdf')
      ? { ...entry, generation: '3', contentHash: 'md5:changed' }
      : entry),
  }
  const rebuilt = buildApprovalCopyManifest('submission-1', changed, completed)
  assert.equal(rebuilt.find((entry) => entry.path.endsWith('/a.pdf'))?.state, 'pending')
})

test('rejects progress updates for a destination outside the reserved manifest', () => {
  const manifest = buildApprovalCopyManifest('submission-1', cleanAttestation)
  assert.throws(() => markApprovalCopyComplete(manifest, 'managed/other/file.pdf', 2_000))
})

test('records only superseded private managed paths for later cleanup', () => {
  const previous = buildApprovalCopyManifest('submission-1', cleanAttestation)
    .map((entry, index) => ({ ...entry, destinationGeneration: String(index + 17) }))
  const rescanned: ScanAttestation = {
    ...cleanAttestation,
    scanId: 'scan-002',
  }
  const next = buildApprovalCopyManifest('submission-1', rescanned)
  assert.deepEqual(
    staleApprovalManagedPaths(previous, next),
    previous
      .map((entry) => ({ path: entry.destinationPath, generation: entry.destinationGeneration }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  )
  assert.deepEqual(staleApprovalManagedPaths(next, next), [])
  assert.deepEqual(staleApprovalManagedPaths([
    { ...previous[0], destinationPath: 'approved/do-not-delete.pdf' },
  ], next), [])
})

test('allows exactly one live approval lease and resumes only after failure or expiry', () => {
  const base = { materialId: 'submission-1', expectedMaterialId: 'submission-1', nowMs: 10_000 }
  assert.equal(approvalReservationDecision({ ...base, status: 'review_queued', leaseExpiresAtMs: 0 }), 'reserve')
  assert.equal(approvalReservationDecision({ ...base, status: 'publishing', leaseExpiresAtMs: 11_000 }), 'busy')
  assert.equal(approvalReservationDecision({ ...base, status: 'publishing', leaseExpiresAtMs: 9_999 }), 'reserve')
  assert.equal(approvalReservationDecision({ ...base, status: 'publishing_failed', leaseExpiresAtMs: 0 }), 'reserve')
})

test('treats deterministic publication as idempotent and rejects mismatched material state', () => {
  const base = { status: 'published', expectedMaterialId: 'submission-1', leaseExpiresAtMs: 0, nowMs: 10_000 }
  assert.equal(approvalReservationDecision({ ...base, materialId: 'submission-1' }), 'published')
  assert.equal(approvalReservationDecision({ ...base, materialId: 'another-material' }), 'invalid')
})
