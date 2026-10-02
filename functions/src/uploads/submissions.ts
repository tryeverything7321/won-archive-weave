import { createHash, randomUUID } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import {
  FieldPath,
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  buildGoogleDriveSourceLink,
  googleDriveSourceFingerprint,
  type GoogleDriveSourceLink,
} from '../google/drive-import.js'
import {
  InstagramUrlPolicyError,
  validateInstagramAttachments,
  type InstagramPostAttachment,
} from '../social/instagram-url.js'
import { requireActorPolicy } from '../community/actor-policy.js'
import { validateRightsRecord, validateUploadDescriptor } from './contracts.js'
import { normalizeTextContent, type TextContent } from './text-content.js'
import {
  assertAttestationMatchesObjects,
  parseScanAttestation,
  requireScanAttestor,
  type QuarantinedObjectFingerprint,
  type ScanAttestation,
} from './scan-attestation.js'
import {
  attemptSubmissionStorageCleanup,
  storageCleanupObjects,
  type StorageCleanupObject,
} from './storage-cleanup.js'
import {
  operatorModerationBlocksPublication,
  operatorModerationCommandKey,
  preservedPublishedVisibility,
  projectOperatorModerationNotice,
  validateReasonedContentModeration,
  type OperatorVisibilityAction,
  type ReasonedContentModerationAction,
} from './content-moderation.js'
import { selectedUploadNames, type UploadSelection } from './upload-selection.js'
import { FILE_SCANNER_ENDPOINT, resolveScannerEndpoint } from './scanner-endpoint.js'

if (!getApps().length) initializeApp()

const allowedKinds = ['활동 기록', '자료', '활동 레시피'] as const
const allowedVisibility = ['공개', '회원 전용', '보류'] as const
const allowedActivityTopics = ['나와 마음', '관계와 공동체', '일과 진로', '배움과 신앙', '사회와 실천'] as const
const MAX_SUBMISSION_FILES = 20
const APPROVAL_LEASE_MS = 5 * 60 * 1_000
const SOURCE_LINK_REVIEW_MS = 90 * 24 * 60 * 60 * 1_000
const MAX_OWNER_SUBMISSIONS = 100
const MAX_OWNER_SUBMISSION_PAGE_SIZE = 50
const MAX_OPERATOR_EXCEPTION_PAGE_SIZE = 25
const SUBMISSION_SORT_MIGRATION_BATCH_SIZE = 200
const SUBMISSION_SORT_MIGRATION_LEASE_MS = 5 * 60 * 1_000
const SUBMISSION_SORT_MIGRATION_SCHEMA_VERSION = 1
const SUBMISSION_SORT_MIGRATION_ID = 'submissions-sort-created-at-v1'
const MIN_FIRESTORE_TIMESTAMP_SECONDS = -62_135_596_800
const MAX_FIRESTORE_TIMESTAMP_SECONDS = 253_402_300_799

export const submissionStatuses = [
  'draft',
  'review_queued',
  'revision_requested',
  'held',
  'rejected',
  'publishing',
  'publishing_failed',
  'exception_queued',
  'published',
  'change_pending',
  'unpublished',
  'withdrawn',
] as const

export type SubmissionStatus = typeof submissionStatuses[number]
export type SubmissionOwnerAction = 'edit' | 'withdraw' | 'request_revision' | 'unpublish' | 'restore_private'
export type AttachmentStatus = 'pending' | 'clean' | 'blocked' | 'error' | 'not_applicable'

export function attachmentStatusProjection(value: Record<string, unknown>): AttachmentStatus {
  if (value.attachmentStatus === 'pending' || value.attachmentStatus === 'clean'
    || value.attachmentStatus === 'blocked' || value.attachmentStatus === 'error') return value.attachmentStatus
  if (value.scanStatus === 'clean' && typeof value.approvedStoragePath === 'string') return 'clean'
  if (value.scanStatus === 'blocked') return 'blocked'
  if (value.scanStatus === 'error') return 'error'
  if (value.sourceMode !== 'upload' && value.scanStatus === 'not_applicable') return 'not_applicable'
  return 'pending'
}

export function assertRestorableMaterialProjection(
  submissionId: string,
  value: Record<string, unknown>,
): void {
  if (value.status !== 'held' && value.status !== 'unpublished') {
    throw new HttpsError('failed-precondition', '복원할 안전한 공개 자료를 찾지 못했어요')
  }
  const approvedObjects = Array.isArray(value.approvedStorageObjects) ? value.approvedStorageObjects : []
  const hasApprovedUpload = approvedObjects.length > 0 && approvedObjects.every((item) => {
    if (!item || typeof item !== 'object') return false
    const object = item as Record<string, unknown>
    return typeof object.path === 'string'
      && object.path.startsWith(`managed/${submissionId}/`)
      && typeof object.generation === 'string'
      && object.generation.length > 0
  })
  const sourceLink = value.sourceLink && typeof value.sourceLink === 'object'
    ? value.sourceLink as Record<string, unknown>
    : undefined
  const hasVerifiedSourceLink = sourceLink?.status === 'verified'
    && typeof sourceLink.verificationId === 'string'
    && sourceLink.verificationId.length > 0
    && typeof sourceLink.sourceFingerprint === 'string'
    && sourceLink.sourceFingerprint.length > 0
  const hasApprovedInstagram = (() => {
    try {
      return validateInstagramAttachments(value.instagramAttachments).length > 0
    } catch {
      return false
    }
  })()
  const hasText = value.sourceMode === 'text' && Boolean(normalizeTextContent(value.textContent))
  const hasIndependentBodyProjection = value.sourceMode === 'upload'
    && value.attachmentLifecycleVersion === 1
    && (value.attachmentStatus === 'pending' || value.attachmentStatus === 'blocked' || value.attachmentStatus === 'error')
    && typeof value.title === 'string'
    && value.title.trim().length > 0
  if (!hasApprovedUpload && !hasVerifiedSourceLink && !hasApprovedInstagram && !hasText && !hasIndependentBodyProjection) {
    throw new HttpsError('failed-precondition', '복원할 안전한 공개 자료를 찾지 못했어요')
  }
}

export function submissionModerationPlan(input: {
  status: SubmissionStatus
  action: ReasonedContentModerationAction
  hasPublicProjection: boolean
  hasPriorGuidance: boolean
  markerAction?: OperatorVisibilityAction
}): {
  nextStatus: SubmissionStatus
  publicAction: 'unchanged' | 'hide' | 'restore'
  markerAction: OperatorVisibilityAction | null
} {
  if (input.action === 'warn') {
    if (input.status === 'withdrawn' || input.status === 'rejected') throw new HttpsError('failed-precondition', '현재 제출에는 운영 안내를 보낼 수 없어요')
    return { nextStatus: input.status, publicAction: 'unchanged', markerAction: input.markerAction ?? null }
  }
  if (input.action === 'request_correction') {
    if (!input.hasPublicProjection || input.status === 'withdrawn' || input.status === 'rejected' || input.status === 'publishing') {
      throw new HttpsError('failed-precondition', '현재 제출에는 수정 요청을 보낼 수 없어요')
    }
    return { nextStatus: 'revision_requested', publicAction: 'unchanged', markerAction: input.markerAction ?? null }
  }
  if (input.action === 'hold') {
    if (!input.hasPublicProjection || input.status === 'withdrawn' || input.status === 'rejected') throw new HttpsError('failed-precondition', '공개된 자료만 숨길 수 있어요')
    return { nextStatus: 'held', publicAction: 'hide', markerAction: 'hold' }
  }
  if (input.action === 'remove') {
    if (!input.hasPublicProjection || !input.hasPriorGuidance) throw new HttpsError('failed-precondition', '먼저 작성자에게 경고 또는 수정 요청을 보내 주세요')
    return { nextStatus: 'unpublished', publicAction: 'hide', markerAction: 'remove' }
  }
  if (!input.hasPublicProjection || !input.markerAction) throw new HttpsError('failed-precondition', '운영자가 숨기거나 내린 자료만 복원할 수 있어요')
  const nextStatus = input.status === 'held' || input.status === 'unpublished' ? 'published' : input.status
  return { nextStatus, publicAction: 'restore', markerAction: null }
}

export function automaticUploadPublicationDecision(
  input: Record<string, unknown>,
): 'auto_publish' | 'exception_queue' {
  return input.status === 'review_queued'
    && input.sourceMode === 'upload'
    && (input.visibility === '공개' || input.visibility === '회원 전용')
    && input.scanStatus === 'clean'
    && input.scanRecordedBy === 'event-driven-file-scanner'
    ? 'auto_publish'
    : 'exception_queue'
}

export function privateCleanUploadDecision(input: Record<string, unknown>): 'ready' | 'not_private' {
  return input.sourceMode === 'upload'
    && input.visibility === '보류'
    && (input.status === 'review_queued' || input.status === 'exception_queued')
    && input.scanStatus === 'clean'
    && (input.scanRecordedBy === 'event-driven-file-scanner' || input.scanRecordedBy === 'manual-scan-attestor')
    && !operatorModerationBlocksPublication(input.operatorModeration)
    ? 'ready'
    : 'not_private'
}

export function assertAutomatedScanPublicationReady(
  scannerEndpoint: string,
  scanRecordedBy: unknown,
): void {
  if (scanRecordedBy !== 'event-driven-file-scanner') {
    throw new HttpsError('failed-precondition', '자동 파일 검사가 준비되기 전에는 업로드 자료를 공개할 수 없어요')
  }
  try { resolveScannerEndpoint(scannerEndpoint) }
  catch { throw new HttpsError('failed-precondition', '자동 파일 검사가 준비되기 전에는 업로드 자료를 공개할 수 없어요') }
}

export function requireSubmissionOwner(
  ownerUid: unknown,
  actorUid: string,
): void {
  if (typeof ownerUid !== 'string' || ownerUid !== actorUid) {
    throw new HttpsError('permission-denied', '내가 만든 제출만 관리할 수 있어요')
  }
}

export function submissionOwnerTransition(
  status: unknown,
  action: SubmissionOwnerAction,
): SubmissionStatus {
  if (typeof status !== 'string' || !submissionStatuses.includes(status as SubmissionStatus)) {
    throw new HttpsError('failed-precondition', '제출 상태를 확인할 수 없어요')
  }
  if (action === 'edit' && (status === 'draft' || status === 'revision_requested')) return status
  if (
    action === 'withdraw'
    && (status === 'draft' || status === 'revision_requested' || status === 'review_queued' || status === 'exception_queued')
  ) return 'withdrawn'
  if (action === 'request_revision' && status === 'published') return 'revision_requested'
  if (action === 'unpublish' && (status === 'published' || status === 'revision_requested')) return 'unpublished'
  if (action === 'restore_private' && (status === 'withdrawn' || status === 'unpublished')) return 'draft'
  throw new HttpsError('failed-precondition', '현재 상태에서는 이 작업을 할 수 없어요')
}

export function submissionPrivateDraftRestorePlan(
  value: Record<string, unknown>,
): { nextStatus: 'draft'; visibility: '보류'; publicAction: 'hide'; alreadyApplied: boolean } {
  const alreadyApplied = value.status === 'draft'
    && value.visibility === '보류'
    && (value.restoredFromWithdrawal === true || value.restoredFromUnpublication === true)
  if (value.status !== 'withdrawn' && value.status !== 'unpublished' && !alreadyApplied) {
    throw new HttpsError('failed-precondition', '공개를 중단하거나 철회한 내용만 비공개 초안으로 복원할 수 있어요')
  }
  if (value.status === 'unpublished' && operatorModerationBlocksPublication(value.operatorModeration)) {
    throw new HttpsError('failed-precondition', '운영자가 공개를 중단한 내용은 직접 복원할 수 없어요')
  }
  return { nextStatus: 'draft', visibility: '보류', publicAction: 'hide', alreadyApplied }
}

export function submissionOwnerManagementTransition(
  value: Record<string, unknown>,
  action: SubmissionOwnerAction,
): SubmissionStatus {
  if (
    action === 'edit'
    && value.status === 'review_queued'
    && value.sourceMode === 'text'
    && value.visibility === '보류'
  ) return 'draft'
  if (action === 'restore_private') return submissionPrivateDraftRestorePlan(value).nextStatus
  return submissionOwnerTransition(value.status, action)
}

function timestampMillis(value: unknown): number | undefined {
  if (value instanceof Timestamp) return value.toMillis()
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const result = value.toMillis()
    return Number.isFinite(result) ? result : undefined
  }
  return undefined
}

export function submissionOwnerRecord(
  id: string,
  value: Record<string, unknown>,
): {
  id: string
  title: string
  kind: string
  status: SubmissionStatus
  visibility: string
  sourceMode: SubmissionSourceMode
  createdAtMs?: number
  updatedAtMs?: number
    availableActions: SubmissionOwnerAction[]
  scanStatus: 'pending' | 'clean' | 'blocked' | 'error' | 'not_applicable'
  cleanupState?: 'pending' | 'failed' | 'dead_letter' | 'completed'
    nextActionReason: string
    moderationNotice?: ReturnType<typeof projectOperatorModerationNotice>
    attachmentStatus: AttachmentStatus
    previewStatus?: 'ready' | 'not_provided' | 'queued' | 'failed'
} {
  const storedStatus = submissionStatuses.includes(value.status as SubmissionStatus)
    ? value.status as SubmissionStatus
    : 'draft'
  const privateReady = privateCleanUploadDecision({ ...value, status: storedStatus }) === 'ready'
  const status = privateReady ? 'review_queued' : storedStatus
  const candidates: SubmissionOwnerAction[] = ['edit', 'withdraw', 'request_revision', 'unpublish', 'restore_private']
  const availableActions = candidates.filter((action) => {
    if (action === 'restore_private' && status !== 'withdrawn' && status !== 'unpublished') return false
    try {
      submissionOwnerManagementTransition({ ...value, status }, action)
      return true
    } catch {
      return false
    }
  })
  const createdAtMs = timestampMillis(value.createdAt)
  const updatedAtMs = timestampMillis(value.updatedAt)
  const scanStatus = value.scanStatus === 'clean'
    || value.scanStatus === 'blocked'
    || value.scanStatus === 'error'
    || value.scanStatus === 'not_applicable'
    ? value.scanStatus
    : 'pending'
  const cleanupState = value.cleanupState === 'pending'
    || value.cleanupState === 'failed'
    || value.cleanupState === 'dead_letter'
    || value.cleanupState === 'completed'
    ? value.cleanupState
    : undefined
  const sourceMode = value.sourceMode === 'text' || value.sourceMode === 'google_drive_link' || value.sourceMode === 'instagram_url'
    ? value.sourceMode
    : 'upload'
  const attachmentStatus = privateReady ? 'clean' : attachmentStatusProjection(value)
  const nextActionReason = privateReady
    ? 'none'
    : scanStatus === 'pending'
    ? 'scan_pending'
    : scanStatus === 'blocked'
      ? 'scan_blocked_operator_review'
      : scanStatus === 'error'
        ? 'scan_failed_operator_review'
        : cleanupState === 'dead_letter'
          ? 'cleanup_operator_action_required'
          : cleanupState === 'failed'
            ? 'cleanup_retry_scheduled'
            : status === 'publishing_failed'
              ? 'publication_retry_required'
              : status === 'review_queued' && scanStatus === 'clean'
                ? 'automatic_publication_pending'
                : 'none'
  const previewStatus = sourceMode === 'upload' && attachmentStatus === 'clean' && status === 'published'
    && (value.previewStatus === 'ready' || value.previewStatus === 'not_provided'
    || value.previewStatus === 'queued' || value.previewStatus === 'failed'
    ) ? value.previewStatus
    : undefined
  return {
    id,
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '제목 없는 제출',
    kind: isOneOf(value.kind, allowedKinds) ? value.kind : '자료',
    status,
    visibility: isOneOf(value.visibility, allowedVisibility) ? value.visibility : '보류',
    sourceMode,
    scanStatus,
    attachmentStatus,
    ...(previewStatus ? { previewStatus } : {}),
    ...(cleanupState ? { cleanupState } : {}),
    nextActionReason,
    ...(createdAtMs !== undefined ? { createdAtMs } : {}),
    ...(updatedAtMs !== undefined ? { updatedAtMs } : {}),
    availableActions,
    ...(projectOperatorModerationNotice(value.moderationNotice)
      ? { moderationNotice: projectOperatorModerationNotice(value.moderationNotice) }
      : {}),
  }
}

type SubmissionExceptionCursor = {
  seconds: number
  nanoseconds: number
  id: string
}

type SubmissionSortMigrationPhase = 'backfill' | 'verify' | 'complete'

type SubmissionSortMigrationMarker = {
  schemaVersion?: unknown
  phase?: unknown
  backfillCursorId?: unknown
  verificationCursorId?: unknown
  leaseToken?: unknown
  leaseExpiresAt?: unknown
}

export function submissionSortCreatedAt(value: Record<string, unknown>): Timestamp {
  if (value.createdAt instanceof Timestamp) return value.createdAt
  if (value.updatedAt instanceof Timestamp) return value.updatedAt
  return new Timestamp(0, 0)
}

export function submissionSortCreatedAtRepair(
  value: Record<string, unknown>,
): { sortCreatedAt: Timestamp } | null {
  const expected = submissionSortCreatedAt(value)
  const current = value.sortCreatedAt
  if (current instanceof Timestamp && timestampsEqual(current, expected)) return null
  return { sortCreatedAt: expected }
}

function timestampsEqual(left: Timestamp, right: Timestamp): boolean {
  return left.seconds === right.seconds && left.nanoseconds === right.nanoseconds
}

export function validateSubmissionSortMigrationCommand(value: unknown): 'dry_run' | 'apply' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', '마이그레이션 작업을 확인할 수 없어요')
  }
  const data = value as Record<string, unknown>
  if (Object.keys(data).some((key) => key !== 'action')) {
    throw new HttpsError('invalid-argument', '마이그레이션 진행 위치는 서버에서만 관리해요')
  }
  if (data.action !== 'dry_run' && data.action !== 'apply') {
    throw new HttpsError('invalid-argument', '마이그레이션 작업을 확인할 수 없어요')
  }
  return data.action
}

function migrationPhase(value: unknown): SubmissionSortMigrationPhase {
  return value === 'verify' || value === 'complete' ? value : 'backfill'
}

export function submissionSortMigrationCursorId(
  marker: SubmissionSortMigrationMarker,
  phase: SubmissionSortMigrationPhase,
): string | null {
  if (marker.schemaVersion !== SUBMISSION_SORT_MIGRATION_SCHEMA_VERSION) return null
  const value = phase === 'verify' ? marker.verificationCursorId : marker.backfillCursorId
  return typeof value === 'string' && value ? value : null
}

export function assertSubmissionSortMigrationClaimable(
  marker: SubmissionSortMigrationMarker,
  nowMs: number,
): SubmissionSortMigrationPhase {
  const recordedPhase = migrationPhase(marker.phase)
  const phase = marker.schemaVersion === SUBMISSION_SORT_MIGRATION_SCHEMA_VERSION
    ? recordedPhase
    : 'backfill'
  if (phase === 'complete') return phase
  const leaseExpiresAtMs = timestampMillis(marker.leaseExpiresAt)
  if (typeof marker.leaseToken === 'string' && leaseExpiresAtMs !== undefined && leaseExpiresAtMs > nowMs) {
    throw new HttpsError('aborted', '다른 마이그레이션 작업이 진행 중이에요')
  }
  return phase
}

export function assertSubmissionSortMigrationLease(
  marker: SubmissionSortMigrationMarker,
  expected: {
    token: string
    phase: SubmissionSortMigrationPhase
    cursorId: string | null
    nowMs?: number
  },
): void {
  const actualPhase = migrationPhase(marker.phase)
  const actualCursor = submissionSortMigrationCursorId(marker, actualPhase)
  const leaseExpiresAtMs = timestampMillis(marker.leaseExpiresAt)
  if (
    marker.leaseToken !== expected.token
    || actualPhase !== expected.phase
    || actualCursor !== expected.cursorId
    || (expected.nowMs !== undefined
      && (leaseExpiresAtMs === undefined || leaseExpiresAtMs <= expected.nowMs))
  ) {
    throw new HttpsError('aborted', '만료되었거나 뒤처진 마이그레이션 작업이에요')
  }
}

export function ownerSubmissionPageSize(value: unknown): number {
  if (value === undefined || value === null) return MAX_OWNER_SUBMISSION_PAGE_SIZE
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new HttpsError('invalid-argument', '목록 크기를 확인할 수 없어요')
  }
  return Math.min(Number(value), MAX_OWNER_SUBMISSION_PAGE_SIZE)
}

export function submissionSortMigrationNextPhase(
  phase: SubmissionSortMigrationPhase,
  batchSize: number,
  mismatchCount = 0,
): SubmissionSortMigrationPhase {
  if (phase === 'complete') return 'complete'
  if (phase === 'verify' && mismatchCount > 0) return 'backfill'
  if (batchSize < SUBMISSION_SORT_MIGRATION_BATCH_SIZE) {
    return phase === 'backfill' ? 'verify' : 'complete'
  }
  return phase
}

export function encodeOwnerSubmissionCursor(cursor: SubmissionExceptionCursor): string {
  return encodeSubmissionExceptionCursor(cursor)
}

export function decodeOwnerSubmissionCursor(value: unknown): SubmissionExceptionCursor | null {
  try {
    return decodeSubmissionExceptionCursor(value)
  } catch {
    throw new HttpsError('invalid-argument', '내 제출 목록 위치를 확인할 수 없어요')
  }
}

export function encodeSubmissionExceptionCursor(cursor: SubmissionExceptionCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeSubmissionExceptionCursor(value: unknown): SubmissionExceptionCursor | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 500) {
    throw new HttpsError('invalid-argument', '예외 대기열 위치를 확인할 수 없어요')
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (
      !Number.isSafeInteger(parsed.seconds)
      || Number(parsed.seconds) < MIN_FIRESTORE_TIMESTAMP_SECONDS
      || Number(parsed.seconds) > MAX_FIRESTORE_TIMESTAMP_SECONDS
      || !Number.isSafeInteger(parsed.nanoseconds)
      || Number(parsed.nanoseconds) < 0
      || Number(parsed.nanoseconds) > 999_999_999
      || typeof parsed.id !== 'string'
      || !parsed.id
      || parsed.id.length > 180
      || parsed.id.includes('/')
    ) throw new Error('invalid_cursor')
    return {
      seconds: Number(parsed.seconds),
      nanoseconds: Number(parsed.nanoseconds),
      id: parsed.id,
    }
  } catch {
    throw new HttpsError('invalid-argument', '예외 대기열 위치를 확인할 수 없어요')
  }
}

export function submissionExceptionPageSize(value: unknown): number {
  if (value === undefined || value === null) return MAX_OPERATOR_EXCEPTION_PAGE_SIZE
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new HttpsError('invalid-argument', '예외 대기열 조회 개수를 확인할 수 없어요')
  }
  return Math.min(Number(value), MAX_OPERATOR_EXCEPTION_PAGE_SIZE)
}

function timestampCursor(
  document: QueryDocumentSnapshot<DocumentData>,
  field: string,
): SubmissionExceptionCursor | null {
  const value = document.get(field)
  return value instanceof Timestamp
    ? {
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
      id: document.id,
    }
    : null
}

const operatorExceptionTypes = [
  'scan_blocked',
  'scan_failed',
  'automatic_publication_exception',
  'automatic_publication_failed',
  'manual_publication_failed',
  'cleanup_failed',
  'cleanup_dead_letter',
] as const

const submissionExceptionActions = [
  'retry_scan',
  'request_revision',
  'retry_cleanup',
  'retry_publication',
  'dismiss',
] as const
type SubmissionExceptionAction = typeof submissionExceptionActions[number]

export function allowedSubmissionExceptionActions(
  exception: Record<string, unknown>,
  submission: Record<string, unknown>,
  cleanupJob?: Record<string, unknown>,
): SubmissionExceptionAction[] {
  const type = isOneOf(exception.type, operatorExceptionTypes) ? exception.type : 'automatic_publication_exception'
  const status = submissionStatuses.includes(submission.status as SubmissionStatus)
    ? submission.status as SubmissionStatus
    : 'exception_queued'
  const actions: SubmissionExceptionAction[] = []
  if (
    type !== 'cleanup_failed'
    && type !== 'cleanup_dead_letter'
    && (status === 'exception_queued' || status === 'publishing_failed' || status === 'review_queued')
  ) actions.push('request_revision')
  if (
    (type === 'cleanup_failed' || type === 'cleanup_dead_letter')
    && (submission.cleanupState === 'failed' || submission.cleanupState === 'dead_letter')
    && cleanupJob?.planVersion === 1
    && Array.isArray(cleanupJob.objects)
    && cleanupJob.objects.length > 0
    && cleanupJob.objects.every((object) => (
      object
      && typeof object === 'object'
      && typeof (object as Record<string, unknown>).path === 'string'
      && typeof (object as Record<string, unknown>).generation === 'string'
      && Boolean((object as Record<string, unknown>).generation)
    ))
  ) actions.push('retry_cleanup')
  if (
    (type === 'automatic_publication_failed' || type === 'manual_publication_failed')
    && status === 'publishing_failed'
    && submission.sourceMode === 'upload'
    && submission.scanStatus === 'clean'
    && submission.scanRecordedBy === 'event-driven-file-scanner'
  ) actions.push('retry_publication')
  if (
    (status === 'withdrawn' || status === 'rejected' || status === 'unpublished')
    && exception.status === 'open'
  ) actions.push('dismiss')
  return actions
}

export function submissionOperatorExceptionRecord(
  id: string,
  exception: Record<string, unknown>,
  submission: Record<string, unknown> | undefined,
  cleanupJob?: Record<string, unknown>,
) {
  if (!submission) return null
  const sourceMode = submission.sourceMode === 'google_drive_link' || submission.sourceMode === 'instagram_url'
    ? submission.sourceMode
    : 'upload'
  const scanStatus = submission.scanStatus === 'clean'
    || submission.scanStatus === 'blocked'
    || submission.scanStatus === 'error'
    || submission.scanStatus === 'not_applicable'
    ? submission.scanStatus
    : 'pending'
  if (submission.status === 'published' && sourceMode === 'upload' && scanStatus === 'clean') return null
  const status = exception.status === 'resolved' ? 'resolved' : 'open'
  const type = isOneOf(exception.type, operatorExceptionTypes) ? exception.type : 'automatic_publication_exception'
  const createdAtMs = timestampMillis(exception.createdAt) ?? 0
  const cleanupState = submission.cleanupState === 'pending'
    || submission.cleanupState === 'failed'
    || submission.cleanupState === 'dead_letter'
    || submission.cleanupState === 'completed'
    ? submission.cleanupState
    : undefined
  const nextActions = allowedSubmissionExceptionActions(exception, submission, cleanupJob)
  return {
    id,
    submissionId: typeof exception.submissionId === 'string' ? exception.submissionId : id,
    type,
    status,
    title: typeof submission.title === 'string' && submission.title.trim()
      ? submission.title.trim().slice(0, 160)
      : '제목 없는 제출',
    kind: isOneOf(submission.kind, allowedKinds) ? submission.kind : '자료',
    sourceMode,
    scanStatus,
    ...(cleanupState ? { cleanupState } : {}),
    createdAt: createdAtMs,
    createdAtMs,
    nextActions,
  }
}

export function submissionEditableRecord(
  id: string,
  value: Record<string, unknown>,
  existingFileCount = 0,
): Record<string, unknown> {
  const status = submissionOwnerManagementTransition(value, 'edit')
  const textContent = normalizeTextContent(value.textContent)
  const sourceMode = value.sourceMode === 'text' || value.sourceMode === 'google_drive_link' || value.sourceMode === 'instagram_url'
    ? value.sourceMode
    : 'upload'
  const sourceLink = value.sourceLink && typeof value.sourceLink === 'object'
    ? value.sourceLink as Record<string, unknown>
    : undefined
  return {
    id,
    status,
    sourceMode,
    title: typeof value.title === 'string' ? value.title : '',
    kind: isOneOf(value.kind, allowedKinds) ? value.kind : '자료',
    source: typeof value.source === 'string' ? value.source : '',
    owner: typeof value.owner === 'string' ? value.owner : '',
    visibility: isOneOf(value.visibility, allowedVisibility) ? value.visibility : '보류',
    attribution: typeof value.attribution === 'string' ? value.attribution : '',
    consentBasis: typeof value.consentBasis === 'string' ? value.consentBasis : '',
    redistribution: value.redistribution === 'view_only' || value.redistribution === 'source_link_only'
      ? value.redistribution
      : 'download_allowed',
    consentConfirmed: value.consentConfirmed === true,
    sensitiveDataReviewed: value.sensitiveDataReviewed === true,
    ...(sourceMode === 'google_drive_link' && typeof sourceLink?.sourceUrl === 'string'
      ? { sourceLinkUrl: sourceLink.sourceUrl }
      : {}),
    ...(Array.isArray(value.instagramAttachments) ? { instagramAttachments: value.instagramAttachments } : {}),
    ...(value.activity && typeof value.activity === 'object' ? { activity: value.activity } : {}),
    ...(value.recipe && typeof value.recipe === 'object' ? { recipe: value.recipe } : {}),
    ...(textContent ? { textContent } : {}),
    existingFileCount: sourceMode === 'upload' ? Math.max(0, Math.min(MAX_SUBMISSION_FILES, existingFileCount)) : 0,
  }
}

export type SubmissionSourceMode = 'text' | 'upload' | 'google_drive_link' | 'instagram_url'

export function assertNewSubmissionKind(value: unknown): void {
  if (value !== '활동 기록' && value !== '자료') {
    throw new HttpsError('invalid-argument', '새 글은 활동 기록 또는 자료 나눔으로 작성해 주세요')
  }
}

export function requireSameSubmissionKind(current: unknown, next: unknown): void {
  if (current !== next) throw new HttpsError('failed-precondition', '수정 중에는 기록 종류를 바꿀 수 없어요')
}

export function requireSameSubmissionSourceMode(
  current: unknown,
  next: SubmissionSourceMode,
): void {
  const currentMode = current === 'text' || current === 'google_drive_link' || current === 'instagram_url' ? current : 'upload'
  if (next !== currentMode) {
    throw new HttpsError('failed-precondition', '수정 중에는 자료 연결 방법을 바꿀 수 없어요. 다른 방법으로 올리려면 새로 제출해 주세요')
  }
}

export type ActivityMetadata = {
  topic: typeof allowedActivityTopics[number]
  type: string
  date: string
  place: string
  summary: string
  story: string
  outcome: string
  nextAction: string
}

export type ActivityRecipeMetadata = {
  purpose: string
  preparation: string
  promotion: string
  lessons: string
}

export type SubmissionInput = {
  textContent?: TextContent
  sourceMode: SubmissionSourceMode
  title: string
  kind: typeof allowedKinds[number]
  source: string
  owner: string
  visibility: typeof allowedVisibility[number]
  consentConfirmed: boolean
  attribution: string
  redistribution: 'download_allowed' | 'view_only' | 'source_link_only'
  consentBasis: string
  sensitiveDataReviewed: boolean
  retention: 'managed' | 'source_link'
  sourceLink?: GoogleDriveSourceLink
  instagramAttachments?: InstagramPostAttachment[]
  activity?: ActivityMetadata
  recipe?: ActivityRecipeMetadata
}

export type SourceLinkVerification = {
  status: 'pending' | 'verified' | 'rejected' | 'revoked'
  verificationId?: string
  sourceFingerprint?: string
  verifiedAt?: Timestamp
  verifiedByUid?: string
  method?: 'manual_signed_out_view_check' | 'owner_public_link_confirmation'
  note?: string
  reviewDueAt?: Timestamp
}

export type PublishedActivityRecord = {
  textContent?: TextContent
  slug: string
  title: string
  topic: typeof allowedActivityTopics[number]
  type: string
  date: string
  place: string
  summary: string
  story: string
  outcome: string
  nextAction: string
  tone: 'blueprint'
  status: 'published'
  visibility: 'public' | 'member_only' | 'hold'
  submissionId: string
  materialId: string
  owner: string
  source: string
  attribution: string
  instagramAttachments?: InstagramPostAttachment[]
  recipe?: ActivityRecipeMetadata
}

export const activityPublicationSetOptions = { merge: true } as const

export type ApprovalCopyManifestEntry = QuarantinedObjectFingerprint & {
  destinationPath: string
  state: 'pending' | 'copied'
  copiedAtMs?: number
  destinationGeneration?: string
}

type ApprovalState = SubmissionInput & {
  ownerUid?: string
  status?: string
  scanStatus?: string
  scanAttestation?: ScanAttestation
  scanRecordedBy?: string
  materialId?: string
  approvalAttemptId?: string
  approvalLeaseExpiresAt?: Timestamp
  copyManifest?: ApprovalCopyManifestEntry[]
  sourceVerification?: SourceLinkVerification
  approvalSourceFingerprint?: string
  approvalSourceVerificationId?: string
}

function approvalKey(scanId: string): string {
  return createHash('sha256').update(scanId).digest('hex').slice(0, 24)
}

function fileName(path: string): string {
  return path.split('/').pop() ?? 'material'
}

export function originalUploadFileName(path: string): string {
  return fileName(path).replace(/^u[a-f0-9]{24}--/, '')
}

function sameOptionalStringList(left?: string[], right?: string[]): boolean {
  if (!left || !right) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export type PublishedDocumentAssets = {
  sourcePath: string
  sourceFormat: string
  previewStoragePath?: string
  previewStatus: 'ready' | 'not_provided'
}

function fileExtension(path: string): string {
  return fileName(path).split('.').pop()?.toLowerCase() ?? ''
}

function isAuthorProvidedPreview(path: string): boolean {
  return fileName(path).includes('__preview__-')
}

export function classifyPublishedDocumentAssets(paths: string[]): PublishedDocumentAssets {
  const previewPaths = paths.filter(isAuthorProvidedPreview)
  const sourcePaths = paths.filter((path) => !isAuthorProvidedPreview(path))
  if (!sourcePaths.length) {
    throw new HttpsError('failed-precondition', '공개할 원본 파일을 찾지 못했어요')
  }
  if (previewPaths.length > 1 || previewPaths.some((path) => fileExtension(path) !== 'pdf')) {
    throw new HttpsError('failed-precondition', '한글 문서 미리보기는 PDF 한 개만 사용할 수 있어요')
  }
  const sourcePath = sourcePaths[0]
  const sourceFormat = fileExtension(sourcePath)
  if (previewPaths.length && sourceFormat !== 'hwp' && sourceFormat !== 'hwpx') {
    throw new HttpsError('failed-precondition', '미리보기 PDF는 HWP 또는 HWPX 원본과 함께 올려 주세요')
  }
  return {
    sourcePath,
    sourceFormat,
    ...(previewPaths[0] ? { previewStoragePath: previewPaths[0] } : {}),
    previewStatus: previewPaths[0] ? 'ready' : 'not_provided',
  }
}

export function buildApprovalCopyManifest(
  submissionId: string,
  attestation: ScanAttestation,
  previous: ApprovalCopyManifestEntry[] = [],
): ApprovalCopyManifestEntry[] {
  const previousBySource = new Map(previous.map((entry) => [`${entry.path}\u0000${entry.generation}`, entry]))
  const key = approvalKey(attestation.scanId)
  return [...attestation.objects]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((object) => {
      const sourceKey = createHash('sha256').update(object.path).digest('hex').slice(0, 12)
      const destinationPath = `managed/${submissionId}/${key}/${sourceKey}-${originalUploadFileName(object.path)}`
      const existing = previousBySource.get(`${object.path}\u0000${object.generation}`)
      const copied = existing?.state === 'copied'
        && existing.destinationPath === destinationPath
        && existing.size === object.size
        && existing.contentHash === object.contentHash
      return {
        ...object,
        destinationPath,
        state: copied ? 'copied' : 'pending',
        ...(copied && existing?.copiedAtMs ? { copiedAtMs: existing.copiedAtMs } : {}),
        ...(copied && existing?.destinationGeneration ? { destinationGeneration: existing.destinationGeneration } : {}),
      }
    })
}

export function markApprovalCopyComplete(
  manifest: ApprovalCopyManifestEntry[],
  destinationPath: string,
  copiedAtMs: number,
  destinationGeneration?: string,
): ApprovalCopyManifestEntry[] {
  let found = false
  const next = manifest.map((entry) => {
    if (entry.destinationPath !== destinationPath) return entry
    found = true
    return {
      ...entry,
      state: 'copied' as const,
      copiedAtMs,
      ...(destinationGeneration ? { destinationGeneration } : {}),
    }
  })
  if (!found) throw new Error('Approval copy manifest entry was not found')
  return next
}

export function staleApprovalManagedPaths(
  previous: ApprovalCopyManifestEntry[] = [],
  next: ApprovalCopyManifestEntry[] = [],
): StorageCleanupObject[] {
  const activePaths = new Set(next.map((entry) => entry.destinationPath))
  const byPath = new Map<string, StorageCleanupObject>()
  previous
    .filter((entry) => entry.destinationPath.startsWith('managed/') && !activePaths.has(entry.destinationPath))
    .forEach((entry) => {
      const current = byPath.get(entry.destinationPath)
      if (!current || (!current.generation && entry.destinationGeneration)) {
        byPath.set(entry.destinationPath, {
          path: entry.destinationPath,
          ...(entry.destinationGeneration ? { generation: entry.destinationGeneration } : {}),
        })
      }
    })
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export function approvalReservationDecision(input: {
  status: string | undefined
  materialId: string | undefined
  expectedMaterialId: string
  leaseExpiresAtMs: number
  nowMs: number
}): 'published' | 'reserve' | 'busy' | 'invalid' {
  if (input.status === 'published') {
    return input.materialId === input.expectedMaterialId ? 'published' : 'invalid'
  }
  if (input.status === 'publishing' && input.leaseExpiresAtMs > input.nowMs) return 'busy'
  if (input.status === 'review_queued' || input.status === 'publishing_failed' || input.status === 'publishing') return 'reserve'
  return 'invalid'
}

export function attachmentPublicationReservationDecision(input: {
  status: unknown
  attachmentStatus: unknown
  scanStatus: unknown
  attachmentRevision: unknown
  attemptId?: unknown
  leaseExpiresAtMs?: number
  nowMs: number
}): 'complete' | 'reserve' | 'busy' | 'invalid' {
  if (input.status !== 'published' || typeof input.attachmentRevision !== 'string' || !input.attachmentRevision) return 'invalid'
  if (input.attachmentStatus === 'clean') return 'complete'
  if ((input.attachmentStatus !== 'pending' && input.attachmentStatus !== 'error') || input.scanStatus !== 'clean') return 'invalid'
  if (typeof input.attemptId === 'string' && (input.leaseExpiresAtMs ?? 0) > input.nowMs) return 'busy'
  return 'reserve'
}

export function attachmentPublicationMatchesReservation(input: {
  status: unknown
  attachmentRevision: unknown
  attemptId: unknown
  expectedRevision: string
  expectedAttemptId: string
}): boolean {
  return input.status === 'published'
    && input.attachmentRevision === input.expectedRevision
    && input.attemptId === input.expectedAttemptId
}

export function sourceLinkApprovalFingerprint(
  sourceLink: GoogleDriveSourceLink | undefined,
  verification: SourceLinkVerification | undefined,
  nowMs: number,
): string {
  if (!sourceLink || verification?.status !== 'verified' || !verification.verificationId || !verification.verifiedAt) {
    throw new HttpsError('failed-precondition', '원본 링크의 공개 상태를 먼저 확인해 주세요')
  }
  const fingerprint = googleDriveSourceFingerprint(sourceLink)
  if (verification.sourceFingerprint !== fingerprint) {
    throw new HttpsError('failed-precondition', '확인한 링크와 현재 원본 링크가 달라 다시 확인해야 해요')
  }
  if (!verification.reviewDueAt || verification.reviewDueAt.toMillis() <= nowMs) {
    throw new HttpsError('failed-precondition', '원본 링크의 공개 상태를 다시 확인해 주세요')
  }
  return fingerprint
}

export function assertSubmissionFilePolicy(
  sourceMode: SubmissionSourceMode,
  fileCount: number,
): void {
  if (!Number.isSafeInteger(fileCount) || fileCount < 0 || fileCount > MAX_SUBMISSION_FILES) {
    throw new HttpsError('failed-precondition', `한 번에 파일을 ${MAX_SUBMISSION_FILES}개까지만 제출할 수 있어요`)
  }
  if (sourceMode !== 'upload' && fileCount !== 0) {
    throw new HttpsError('failed-precondition', '원문 링크 제출에는 파일을 함께 올릴 수 없어요')
  }
  if (sourceMode === 'upload' && fileCount === 0) {
    throw new HttpsError('failed-precondition', '제출할 파일을 먼저 올려 주세요')
  }
}

export function instagramAttachmentsFingerprint(attachments: InstagramPostAttachment[]): string {
  return createHash('sha256').update(JSON.stringify(attachments)).digest('hex')
}

export function validateSourceLinkVerificationAttestation(value: unknown): {
  note: string
  checkedWithoutSignIn: true
  accessLevel: 'anyone_with_link_viewer'
} {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', '원본 링크 확인 내용을 입력해 주세요')
  }
  const data = value as Record<string, unknown>
  const note = typeof data.note === 'string' ? data.note.trim() : ''
  if (data.checkedWithoutSignIn !== true || data.accessLevel !== 'anyone_with_link_viewer') {
    throw new HttpsError('failed-precondition', '로그아웃 상태에서 보기 권한을 직접 확인해 주세요')
  }
  if (note.length < 2 || note.length > 500) {
    throw new HttpsError('invalid-argument', '확인 내용을 2자 이상 500자 이하로 남겨 주세요')
  }
  return { note, checkedWithoutSignIn: true, accessLevel: 'anyone_with_link_viewer' }
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

function optionalActivityText(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${label}을 확인해 주세요`)
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > maxLength) throw new HttpsError('invalid-argument', `${label}은 ${maxLength}자 이하로 입력해 주세요`)
  return trimmed
}

function requiredActivityText(value: unknown, label: string, maxLength: number): string {
  const text = optionalActivityText(value, label, maxLength)
  if (!text) throw new HttpsError('invalid-argument', `${label}을 입력해 주세요`)
  return text
}

function validateActivityMetadata(value: unknown): ActivityMetadata | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', '활동 기록의 상세 내용을 확인해 주세요')
  }
  const data = value as Record<string, unknown>
  if (!isOneOf(data.topic, allowedActivityTopics)) {
    throw new HttpsError('invalid-argument', '활동 주제를 확인해 주세요')
  }
  const type = optionalActivityText(data.type, '활동 유형', 80) ?? ''
  const date = optionalActivityText(data.date, '활동 날짜', 80) ?? ''
  const place = optionalActivityText(data.place, '활동 장소', 160) ?? ''
  const summary = requiredActivityText(data.summary, '활동 요약', 500)
  const story = optionalActivityText(data.story, '활동 이야기', 4_000) ?? summary
  const outcome = optionalActivityText(data.outcome, '활동 결과', 1_500) ?? ''
  const nextAction = optionalActivityText(data.nextAction, '다음 활동', 1_000) ?? ''
  const metadata: ActivityMetadata = {
    topic: data.topic,
    type,
    date,
    place,
    summary,
    story,
    outcome,
    nextAction,
  }
  return metadata
}

function validateActivityRecipeMetadata(value: unknown): ActivityRecipeMetadata | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', '활동 레시피의 상세 내용을 확인해 주세요')
  }
  const data = value as Record<string, unknown>
  const purpose = optionalActivityText(data.purpose, '활동 목적', 1_500) ?? ''
  const preparation = optionalActivityText(data.preparation, '준비 방법', 1_500) ?? ''
  const promotion = optionalActivityText(data.promotion, '홍보 방법', 1_500) ?? ''
  const lessons = optionalActivityText(data.lessons, '활동에서 배운 점', 1_500) ?? ''
  if (!purpose && !preparation && !promotion && !lessons) return undefined
  const recipe: ActivityRecipeMetadata = {
    purpose,
    preparation,
    promotion,
    lessons,
  }
  return recipe
}

export function buildActivityPublication(
  submissionId: string,
  submission: Pick<SubmissionInput, 'title' | 'kind' | 'owner' | 'source' | 'attribution' | 'activity' | 'recipe' | 'instagramAttachments' | 'textContent'>,
  visibility: PublishedActivityRecord['visibility'],
): PublishedActivityRecord | null {
  if ((submission.kind !== '활동 기록' && submission.kind !== '활동 레시피') || !submission.activity) return null
  const activity = submission.activity
  return {
    slug: submissionId,
    ...(submission.textContent ? { textContent: submission.textContent } : {}),
    title: submission.title,
    topic: activity.topic,
    type: activity.type,
    date: activity.date,
    place: activity.place,
    summary: activity.summary,
    story: activity.story,
    outcome: activity.outcome,
    nextAction: activity.nextAction,
    tone: 'blueprint',
    status: 'published',
    visibility,
    submissionId,
    materialId: submissionId,
    owner: submission.owner,
    source: submission.source,
    attribution: submission.attribution,
    ...(submission.instagramAttachments?.length
      ? { instagramAttachments: submission.instagramAttachments }
      : {}),
    ...(submission.kind === '활동 레시피' && submission.recipe
      ? {
          recipe: {
            purpose: submission.recipe.purpose,
            preparation: submission.recipe.preparation,
            promotion: submission.recipe.promotion,
            lessons: submission.recipe.lessons,
          },
        }
      : {}),
  }
}

export function buildPendingUploadPublication(
  submissionId: string,
  submission: SubmissionInput,
  visibility: 'public' | 'member_only',
  attachmentStatus: 'pending' | 'error' = 'pending',
): { material: Record<string, unknown>; activity: PublishedActivityRecord | null } {
  const activity = buildActivityPublication(submissionId, submission, visibility)
  return {
    material: {
      sourceMode: 'upload',
      attachmentLifecycleVersion: 1,
      ...(submission.textContent ? { textContent: submission.textContent } : {}),
      title: submission.title,
      kind: submission.kind,
      owner: submission.owner,
      status: 'published',
      visibility,
      attachmentStatus,
      ...(activity ? { activitySlug: activity.slug } : {}),
      rights: {
        source: submission.source,
        owner: submission.owner,
        attribution: submission.attribution,
        redistribution: submission.redistribution,
        consentBasis: submission.consentBasis,
        sensitiveDataReviewed: submission.sensitiveDataReviewed,
        retention: submission.retention,
      },
    },
    activity,
  }
}

export function validateSubmissionInput(value: unknown): SubmissionInput {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', '제출 내용을 확인해 주세요')
  const data = value as Record<string, unknown>
  const textContent = normalizeTextContent(data.textContent)
  const sourceMode = data.sourceMode === undefined ? 'upload' : data.sourceMode
  if (sourceMode !== 'text' && sourceMode !== 'upload' && sourceMode !== 'google_drive_link' && sourceMode !== 'instagram_url') {
    throw new HttpsError('invalid-argument', '자료를 올릴 방법을 선택해 주세요')
  }
  if (sourceMode === 'text' && !textContent) throw new HttpsError('invalid-argument', '공유할 내용을 적어 주세요')
  const title = typeof data.title === 'string' ? data.title.trim() : ''
  const source = typeof data.source === 'string' ? data.source.trim() : ''
  const owner = typeof data.owner === 'string' ? data.owner.trim() : ''
  if (title.length < 2 || title.length > 120) throw new HttpsError('invalid-argument', '제목은 2자 이상 120자 이하로 입력해 주세요')
  if (source.length < 2 || source.length > 160) throw new HttpsError('invalid-argument', '출처를 확인해 주세요')
  if (owner.length < 2 || owner.length > 160) throw new HttpsError('invalid-argument', '소유자 또는 담당을 확인해 주세요')
  if (!isOneOf(data.kind, allowedKinds)) throw new HttpsError('invalid-argument', '기록 형식을 선택해 주세요')
  if (!isOneOf(data.visibility, allowedVisibility)) throw new HttpsError('invalid-argument', '공개 범위를 선택해 주세요')
  if (data.consentConfirmed !== true) throw new HttpsError('failed-precondition', '공개와 공유 권한을 확인해 주세요')
  const attribution = typeof data.attribution === 'string' ? data.attribution.trim() : ''
  const consentBasis = typeof data.consentBasis === 'string' ? data.consentBasis.trim() : ''
  const redistribution = data.redistribution
  const retention = data.retention
  if (redistribution !== 'download_allowed' && redistribution !== 'view_only' && redistribution !== 'source_link_only') throw new HttpsError('invalid-argument', '재배포 방식을 선택해 주세요')
  if (retention !== 'managed' && retention !== 'source_link') throw new HttpsError('invalid-argument', '보관 방식을 선택해 주세요')
  let sourceLink: GoogleDriveSourceLink | undefined
  if (sourceMode === 'google_drive_link') {
    if (redistribution !== 'source_link_only' || retention !== 'source_link') {
      throw new HttpsError('invalid-argument', 'Google 원본 링크는 원본에서 열람하는 방식으로만 공유할 수 있어요')
    }
    if (typeof data.sourceLinkUrl !== 'string') {
      throw new HttpsError('invalid-argument', 'Google Drive 또는 Google Docs 링크를 입력해 주세요')
    }
    try {
      sourceLink = buildGoogleDriveSourceLink(data.sourceLinkUrl)
    } catch {
      throw new HttpsError('invalid-argument', '올바른 Google Drive 또는 Google Docs 링크를 입력해 주세요')
    }
  } else if (sourceMode === 'instagram_url') {
    if (redistribution !== 'source_link_only' || retention !== 'source_link') {
      throw new HttpsError('invalid-argument', 'Instagram 원문은 원본에서 열람하는 방식으로만 공유할 수 있어요')
    }
    if (data.sourceLinkUrl !== undefined) {
      throw new HttpsError('invalid-argument', 'Instagram 원문과 Google 링크를 동시에 주 출처로 제출할 수 없어요')
    }
  } else {
    if (retention !== 'managed') throw new HttpsError('invalid-argument', '올린 파일은 위브 보관 공간에서 관리해야 해요')
    if (data.sourceLinkUrl !== undefined) throw new HttpsError('invalid-argument', '파일과 원본 링크를 동시에 제출할 수 없어요')
  }
  if (data.activity !== undefined && data.kind !== '활동 기록' && data.kind !== '활동 레시피') {
    throw new HttpsError('invalid-argument', '활동 상세 내용은 활동 기록과 활동 레시피에만 입력할 수 있어요')
  }
  if (data.recipe !== undefined && data.kind !== '활동 레시피') {
    throw new HttpsError('invalid-argument', '레시피 상세 내용은 활동 레시피에만 입력할 수 있어요')
  }
  const activity = validateActivityMetadata(data.activity)
  const recipe = validateActivityRecipeMetadata(data.recipe)
  let instagramAttachments: InstagramPostAttachment[]
  try {
    instagramAttachments = validateInstagramAttachments(data.instagramAttachments)
  } catch (error) {
    const code = error instanceof InstagramUrlPolicyError ? error.code : 'invalid_url'
    const messages: Record<InstagramUrlPolicyError['code'], string> = {
      invalid_url: 'Instagram 링크를 확인해 주세요',
      unsupported_url: '공개 Instagram 게시물이나 릴 링크만 연결할 수 있어요',
      duplicate: '같은 Instagram 링크를 두 번 연결할 수 없어요',
      too_many: 'Instagram 링크는 5개까지 연결할 수 있어요',
      invalid_author: 'Instagram 작성자 계정을 확인해 주세요',
    }
    throw new HttpsError('invalid-argument', messages[code])
  }
  if (sourceMode === 'instagram_url' && instagramAttachments.length === 0) {
    throw new HttpsError('invalid-argument', 'Instagram 게시물이나 릴 링크를 하나 이상 연결해 주세요')
  }
  validateRightsRecord({ source, owner, attribution, redistribution, consentBasis, sensitiveDataReviewed: data.sensitiveDataReviewed === true, retention, reviewDueAtMs: Date.now() + 2 * 365 * 24 * 60 * 60 * 1_000 }, Date.now())
  return {
    sourceMode,
    title,
    kind: data.kind,
    source,
    owner,
    visibility: data.visibility,
    consentConfirmed: true,
    attribution,
    redistribution,
    consentBasis,
    sensitiveDataReviewed: true,
    retention,
    ...(sourceLink ? { sourceLink } : {}),
    ...(textContent ? { textContent } : {}),
    ...(instagramAttachments.length ? { instagramAttachments } : {}),
    ...(activity ? { activity } : {}),
    ...(recipe ? { recipe } : {}),
  }
}

export function requireSubmissionOperator(token: Record<string, unknown> | undefined): void {
  if (token?.role !== 'moderator' && token?.role !== 'administrator') {
    throw new HttpsError('permission-denied', '검토 권한이 필요합니다')
  }
}

export function canSubmissionOwnerPublish(input: {
  actorUid: string
  ownerUid: unknown
  sourceMode: SubmissionSourceMode
  visibility: unknown
}): boolean {
  return typeof input.ownerUid === 'string'
    && input.ownerUid === input.actorUid
    && (input.sourceMode === 'text' || input.sourceMode === 'instagram_url' || input.sourceMode === 'google_drive_link')
    && input.visibility !== '보류'
}

export function submissionSubmitRetryDecision(value: Record<string, unknown>): 'start' | 'return_published' | 'return_in_progress' | 'resume_publication' | 'invalid' {
  const sourceMode = value.sourceMode === 'text' || value.sourceMode === 'google_drive_link' || value.sourceMode === 'instagram_url'
    ? value.sourceMode
    : 'upload'
  if (value.status === 'published' && typeof value.materialId === 'string') return 'return_published'
  if (value.status === 'publishing') return 'return_in_progress'
  if (value.status === 'review_queued' || value.status === 'publishing_failed') {
    return sourceMode === 'text' || sourceMode === 'google_drive_link' || sourceMode === 'instagram_url'
      ? 'resume_publication'
      : 'return_in_progress'
  }
  if (value.status === 'draft' || value.status === 'revision_requested') return 'start'
  return 'invalid'
}

async function getQuarantinedObjects(
  prefix: string,
  selectedNames?: string[],
): Promise<QuarantinedObjectFingerprint[]> {
  const bucket = getStorage().bucket()
  const files = selectedNames
    ? selectedNames.map((name) => bucket.file(`${prefix}${name}`))
    : (await bucket.getFiles({ prefix, maxResults: MAX_SUBMISSION_FILES + 1 }))[0]
  if (files.length > MAX_SUBMISSION_FILES) {
    throw new HttpsError('failed-precondition', `한 번에 파일을 ${MAX_SUBMISSION_FILES}개까지만 제출할 수 있어요`)
  }
  try {
    return await Promise.all(files.map(async (file) => {
    const [metadata] = await file.getMetadata()
    const generation = String(metadata.generation ?? '')
    const size = Number(metadata.size ?? 0)
    const contentHash = typeof metadata.metadata?.weaveSha256 === 'string'
      ? `sha256:${metadata.metadata.weaveSha256}`
      : metadata.md5Hash
        ? `md5:${metadata.md5Hash}`
      : metadata.crc32c
        ? `crc32c:${metadata.crc32c}`
        : ''
    if (!generation || !Number.isSafeInteger(size) || size <= 0 || !contentHash) {
      throw new HttpsError('failed-precondition', '파일 식별 정보를 확인할 수 없어 검사를 진행할 수 없어요')
    }
      return { path: file.name, generation, size, contentHash }
    }))
  } catch (error) {
    if (selectedNames && isStorageNotFound(error)) {
      throw new HttpsError('failed-precondition', '선택한 첨부 파일을 모두 올린 뒤 다시 시도해 주세요')
    }
    throw error
  }
}

function isStorageNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && Number((error as { code?: unknown }).code) === 404
}

function isStoragePreconditionFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && Number((error as { code?: unknown }).code) === 412
}

async function copyApprovalObject(entry: ApprovalCopyManifestEntry): Promise<string> {
  const bucket = getStorage().bucket()
  const source = bucket.file(entry.path, { generation: entry.generation })
  const destination = bucket.file(entry.destinationPath)
  try {
    await source.copy(destination, {
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        weaveSourcePath: entry.path,
        weaveSourceGeneration: entry.generation,
        weaveContentHash: entry.contentHash,
      },
    })
  } catch (error) {
    if (!isStoragePreconditionFailure(error)) throw error
  }
  const [metadata] = await destination.getMetadata()
  const custom = metadata.metadata as Record<string, string> | undefined
  if (
    custom?.weaveSourcePath !== entry.path
    || custom.weaveSourceGeneration !== entry.generation
    || custom.weaveContentHash !== entry.contentHash
    || typeof metadata.generation !== 'string'
  ) {
    throw new HttpsError('aborted', '이전 승인 시도의 파일과 현재 파일이 달라 다시 검사해야 해요')
  }
  return metadata.generation
}

export function submissionCreateId(uid: string, requestId: string): string {
  return createHash('sha256').update(`submission-create:${uid}:${requestId}`).digest('hex').slice(0, 40)
}

export function submissionCreateFingerprint(input: SubmissionInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export function submissionCreateReplayDecision(
  existing: Record<string, unknown> | undefined,
  uid: string,
  fingerprint: string,
): 'create' | 'replay' | 'conflict' {
  if (!existing) return 'create'
  return existing.ownerUid === uid && existing.initialCreateFingerprint === fingerprint ? 'replay' : 'conflict'
}

export const createSubmission = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const input = validateSubmissionInput(request.data)
  assertNewSubmissionKind(input.kind)
  const firestore = getFirestore()
  const rawClientRequestId = request.data?.clientRequestId
  const clientRequestId = rawClientRequestId === undefined ? undefined
    : typeof rawClientRequestId === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(rawClientRequestId)
      ? rawClientRequestId
      : (() => { throw new HttpsError('invalid-argument', '요청 식별자를 확인해 주세요') })()
  const ref = clientRequestId
    ? firestore.collection('submissions').doc(submissionCreateId(uid, clientRequestId))
    : firestore.collection('submissions').doc()
  const createdAt = FieldValue.serverTimestamp()
  const fingerprint = submissionCreateFingerprint(input)
  if (clientRequestId) {
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const decision = submissionCreateReplayDecision(snapshot.exists ? snapshot.data() : undefined, uid, fingerprint)
      if (decision === 'conflict') throw new HttpsError('already-exists', '같은 요청 식별자가 다른 초안에 사용됐어요')
      if (decision === 'replay') return
      transaction.create(ref, {
        ...input,
        ownerUid: uid,
        initialCreateFingerprint: fingerprint,
        status: 'draft',
        scanStatus: input.sourceMode === 'upload' ? 'pending' : 'not_applicable',
        ...(input.sourceMode === 'google_drive_link'
          ? { sourceVerification: { status: 'pending' } satisfies SourceLinkVerification }
          : {}),
        createdAt,
        sortCreatedAt: createdAt,
        updatedAt: createdAt,
      })
      transaction.create(firestore.collection('auditEvents').doc(), {
        type: 'submission.draft_created', submissionId: ref.id, uid, at: createdAt,
      })
    })
  } else {
    await ref.set({
      ...input,
      ownerUid: uid,
      status: 'draft',
      scanStatus: input.sourceMode === 'upload' ? 'pending' : 'not_applicable',
      ...(input.sourceMode === 'google_drive_link'
        ? { sourceVerification: { status: 'pending' } satisfies SourceLinkVerification }
        : {}),
      createdAt,
      sortCreatedAt: createdAt,
      updatedAt: createdAt,
    })
    await firestore.collection('auditEvents').doc().set({
      type: 'submission.draft_created', submissionId: ref.id, uid, at: FieldValue.serverTimestamp(),
    })
  }
  return {
    submissionId: ref.id,
    ...(input.sourceMode === 'upload'
      ? { uploadPrefix: `quarantined/${uid}/${ref.id}` }
      : {}),
  }
})

export const listMySubmissions = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  const firestore = getFirestore()
  const migration = await firestore.collection('systemMigrations').doc(SUBMISSION_SORT_MIGRATION_ID).get()
  const migrationComplete = migration.get('schemaVersion') === SUBMISSION_SORT_MIGRATION_SCHEMA_VERSION
    && migration.get('phase') === 'complete'
  if (!migrationComplete) {
    const snapshot = await firestore
      .collection('submissions')
      .where('ownerUid', '==', request.auth.uid)
      .limit(MAX_OWNER_SUBMISSIONS)
      .get()
    const submissions = snapshot.docs
      .filter((document) => document.get('deletedFromListings') !== true)
      .map((document) => submissionOwnerRecord(document.id, document.data()))
      .sort((left, right) => (right.updatedAtMs ?? right.createdAtMs ?? 0) - (left.updatedAtMs ?? left.createdAtMs ?? 0))
    return {
      submissions,
      limit: MAX_OWNER_SUBMISSIONS,
      migrationRequired: true,
      hasMore: false,
      nextCursor: null,
    }
  }

  const pageSize = ownerSubmissionPageSize(request.data?.limit ?? request.data?.pageSize)
  const cursor = decodeOwnerSubmissionCursor(request.data?.cursor)
  let query = firestore
    .collection('submissions')
    .where('ownerUid', '==', request.auth.uid)
    .orderBy('sortCreatedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(pageSize + 1)
  if (cursor) {
    query = query.startAfter(
      new Timestamp(cursor.seconds, cursor.nanoseconds),
      cursor.id,
    )
  }
  const snapshot = await query.get()
  const visible = snapshot.docs.slice(0, pageSize)
  const hasMore = snapshot.size > pageSize
  const last = visible.at(-1)
  const next = last ? timestampCursor(last, 'sortCreatedAt') : null
  if (hasMore && !next) {
    throw new HttpsError('data-loss', '내 제출 목록의 다음 위치를 만들 수 없어요')
  }
  return {
    submissions: visible.filter((document) => document.get('deletedFromListings') !== true).map((document) => submissionOwnerRecord(document.id, document.data())),
    limit: pageSize,
    migrationRequired: false,
    hasMore,
    nextCursor: hasMore && next ? encodeOwnerSubmissionCursor(next) : null,
  }
})

// Resolve only the requested public cards. Omit missing and other members' records alike.
export function submissionManagementForOwner(id: string, value: Record<string, unknown> | undefined, uid: string) {
  if (!value || value.ownerUid !== uid || value.deletedFromListings === true) return null
  const owned = submissionOwnerRecord(id, value)
  return { id: owned.id, status: owned.status, availableActions: owned.availableActions }
}

export const getMySubmissionManagement = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const rawIds = request.data?.submissionIds
  if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 30
    || rawIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
    throw new HttpsError('invalid-argument', '확인할 기록을 1~30개 선택해 주세요')
  }
  const ids = [...new Set(rawIds as string[])]
  const firestore = getFirestore()
  const snapshots = await firestore.getAll(...ids.map((id) => firestore.collection('submissions').doc(id)))
  return {
    submissions: snapshots.flatMap((snapshot) => {
      const owned = submissionManagementForOwner(snapshot.id, snapshot.data(), uid)
      return owned ? [owned] : []
    }),
  }
})

async function claimSubmissionSortMigrationLease(): Promise<{
  phase: SubmissionSortMigrationPhase
  cursorId: string | null
  token: string | null
}> {
  const firestore = getFirestore()
  const markerRef = firestore.collection('systemMigrations').doc(SUBMISSION_SORT_MIGRATION_ID)
  const nowMs = Date.now()
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(markerRef)
    const marker = (snapshot.data() ?? {}) as SubmissionSortMigrationMarker
    const phase = assertSubmissionSortMigrationClaimable(marker, nowMs)
    if (phase === 'complete') return { phase, cursorId: null, token: null }
    const resetsPriorVersion = marker.schemaVersion !== SUBMISSION_SORT_MIGRATION_SCHEMA_VERSION
    const cursorId = submissionSortMigrationCursorId(marker, phase)
    const token = randomUUID()
    transaction.set(markerRef, {
      schemaVersion: SUBMISSION_SORT_MIGRATION_SCHEMA_VERSION,
      phase,
      leaseToken: token,
      leaseExpiresAt: Timestamp.fromMillis(nowMs + SUBMISSION_SORT_MIGRATION_LEASE_MS),
      leaseStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(resetsPriorVersion
        ? {
            backfillCursorId: FieldValue.delete(),
            verificationCursorId: FieldValue.delete(),
            backfilledCount: 0,
            verifiedCount: 0,
            verificationFailureIds: FieldValue.delete(),
            verificationFailedAt: FieldValue.delete(),
          }
        : {}),
    }, { merge: true })
    return { phase, cursorId, token }
  })
}

async function finishSubmissionSortMigrationBatch(input: {
  phase: SubmissionSortMigrationPhase
  cursorId: string | null
  token: string
  lastDocumentId: string | null
  batchSize: number
  mismatchIds?: string[]
}): Promise<SubmissionSortMigrationPhase> {
  const firestore = getFirestore()
  const markerRef = firestore.collection('systemMigrations').doc(SUBMISSION_SORT_MIGRATION_ID)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(markerRef)
    const marker = (snapshot.data() ?? {}) as SubmissionSortMigrationMarker
    assertSubmissionSortMigrationLease(marker, { ...input, nowMs: Date.now() })
    const exhausted = input.batchSize < SUBMISSION_SORT_MIGRATION_BATCH_SIZE
    const nextPhase = submissionSortMigrationNextPhase(
      input.phase,
      input.batchSize,
      input.mismatchIds?.length ?? 0,
    )
    const common = {
      leaseToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (input.phase === 'verify' && input.mismatchIds?.length) {
      transaction.set(markerRef, {
        ...common,
        phase: 'backfill',
        backfillCursorId: FieldValue.delete(),
        verificationCursorId: FieldValue.delete(),
        verificationFailureIds: input.mismatchIds.slice(0, 20),
        verificationFailedAt: FieldValue.serverTimestamp(),
        backfilledCount: 0,
        verifiedCount: 0,
      }, { merge: true })
      return nextPhase
    }

    if (input.phase === 'backfill') {
      transaction.set(markerRef, exhausted
        ? {
            ...common,
            phase: 'verify',
            backfillCursorId: FieldValue.delete(),
            verificationCursorId: FieldValue.delete(),
            verificationFailureIds: FieldValue.delete(),
            verificationFailedAt: FieldValue.delete(),
            backfillCompletedAt: FieldValue.serverTimestamp(),
            backfilledCount: FieldValue.increment(input.batchSize),
          }
        : {
            ...common,
            phase: 'backfill',
            backfillCursorId: input.lastDocumentId,
            backfilledCount: FieldValue.increment(input.batchSize),
          }, { merge: true })
      return nextPhase
    }

    transaction.set(markerRef, exhausted
      ? {
          ...common,
          phase: 'complete',
          verificationCursorId: FieldValue.delete(),
          verificationCompletedAt: FieldValue.serverTimestamp(),
          completedAt: FieldValue.serverTimestamp(),
          verifiedCount: FieldValue.increment(input.batchSize),
        }
      : {
          ...common,
          phase: 'verify',
          verificationCursorId: input.lastDocumentId,
          verifiedCount: FieldValue.increment(input.batchSize),
        }, { merge: true })
    return nextPhase
  })
}

export const migrateSubmissionSortCreatedAt = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
    if (request.auth.token.role !== 'administrator') {
      throw new HttpsError('permission-denied', '관리자 권한이 필요합니다')
    }
    const action = validateSubmissionSortMigrationCommand(request.data)
    const firestore = getFirestore()
    const markerRef = firestore.collection('systemMigrations').doc(SUBMISSION_SORT_MIGRATION_ID)

    if (action === 'dry_run') {
      const markerSnapshot = await markerRef.get()
      const marker = (markerSnapshot.data() ?? {}) as SubmissionSortMigrationMarker
      const phase = assertSubmissionSortMigrationClaimable(
        { ...marker, leaseToken: undefined, leaseExpiresAt: undefined },
        Date.now(),
      )
      if (phase === 'complete') {
        return { action, phase, complete: true, wouldProcess: 0 }
      }
      const cursorId = submissionSortMigrationCursorId(marker, phase)
      let query = firestore.collection('submissions')
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(SUBMISSION_SORT_MIGRATION_BATCH_SIZE)
      if (cursorId) query = query.startAfter(cursorId)
      const snapshot = await query.get()
      const mismatchCount = phase === 'verify'
        ? snapshot.docs.filter((document) => {
            const current = document.get('sortCreatedAt')
            return !(current instanceof Timestamp)
              || !timestampsEqual(current, submissionSortCreatedAt(document.data()))
          }).length
        : snapshot.docs.filter((document) => {
            const current = document.get('sortCreatedAt')
            return !(current instanceof Timestamp)
              || !timestampsEqual(current, submissionSortCreatedAt(document.data()))
          }).length
      return {
        action,
        phase,
        complete: false,
        wouldProcess: snapshot.size,
        mismatchCount,
        cursorManagedByServer: true,
      }
    }

    const lease = await claimSubmissionSortMigrationLease()
    if (lease.phase === 'complete' || !lease.token) {
      return { action, phase: 'complete', complete: true, processed: 0 }
    }

    let query = firestore.collection('submissions')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(SUBMISSION_SORT_MIGRATION_BATCH_SIZE)
    if (lease.cursorId) query = query.startAfter(lease.cursorId)
    const snapshot = await query.get()
    const lastDocumentId = snapshot.docs.at(-1)?.id ?? null

    if (lease.phase === 'backfill') {
      const batch = firestore.batch()
      let mutationCount = 0
      snapshot.docs.forEach((document) => {
        const expected = submissionSortCreatedAt(document.data())
        const current = document.get('sortCreatedAt')
        if (!(current instanceof Timestamp) || !timestampsEqual(current, expected)) {
          batch.update(document.ref, { sortCreatedAt: expected })
          mutationCount += 1
        }
      })
      if (mutationCount) await batch.commit()
      const nextPhase = await finishSubmissionSortMigrationBatch({
        phase: lease.phase,
        cursorId: lease.cursorId,
        token: lease.token,
        lastDocumentId,
        batchSize: snapshot.size,
      })
      return {
        action,
        phase: nextPhase,
        complete: nextPhase === 'complete',
        processed: snapshot.size,
        mutated: mutationCount,
        cursorManagedByServer: true,
      }
    }

    const mismatchIds = snapshot.docs
      .filter((document) => {
        const current = document.get('sortCreatedAt')
        return !(current instanceof Timestamp)
          || !timestampsEqual(current, submissionSortCreatedAt(document.data()))
      })
      .map((document) => document.id)
    const nextPhase = await finishSubmissionSortMigrationBatch({
      phase: lease.phase,
      cursorId: lease.cursorId,
      token: lease.token,
      lastDocumentId,
      batchSize: snapshot.size,
      mismatchIds,
    })
    if (mismatchIds.length) {
      throw new HttpsError(
        'failed-precondition',
        '검증 중 누락된 정렬 값을 발견해 백필 단계를 처음부터 다시 시작해요',
      )
    }
    return {
      action,
      phase: nextPhase,
      complete: nextPhase === 'complete',
      processed: snapshot.size,
      verified: snapshot.size,
      cursorManagedByServer: true,
    }
  },
)

export const repairCreatedSubmissionSortTimestamp = onDocumentCreated(
  { region: 'asia-northeast3', document: 'submissions/{submissionId}', retry: true },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return
    const repair = submissionSortCreatedAtRepair(snapshot.data())
    if (repair) await snapshot.ref.update(repair)
  },
)

export const listSubmissionOperatorExceptions = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  requireSubmissionOperator(request.auth.token)
  const pageSize = submissionExceptionPageSize(request.data?.limit ?? request.data?.pageSize)
  const cursor = decodeSubmissionExceptionCursor(request.data?.cursor)
  const requestedStatus = request.data?.status ?? 'open'
  if (requestedStatus !== 'open' && requestedStatus !== 'resolved') {
    throw new HttpsError('invalid-argument', '예외 대기열 상태를 확인할 수 없어요')
  }

  const firestore = getFirestore()
  type ProjectedException = NonNullable<ReturnType<typeof submissionOperatorExceptionRecord>>
  const accepted: Array<{ document: QueryDocumentSnapshot<DocumentData>; record: ProjectedException }> = []
  const maxScannedDocuments = MAX_OPERATOR_EXCEPTION_PAGE_SIZE * 10
  let scanCursor = cursor
  let scannedDocuments = 0
  let queryExhausted = false
  let lastScannedDocument: QueryDocumentSnapshot<DocumentData> | undefined

  while (accepted.length < pageSize + 1 && scannedDocuments < maxScannedDocuments && !queryExhausted) {
    const batchLimit = Math.min(
      MAX_OPERATOR_EXCEPTION_PAGE_SIZE,
      maxScannedDocuments - scannedDocuments,
    )
    let query = firestore.collection('submissionOperatorExceptions')
      .where('status', '==', requestedStatus)
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(batchLimit)
    if (scanCursor) {
      query = query.startAfter(
        new Timestamp(scanCursor.seconds, scanCursor.nanoseconds),
        scanCursor.id,
      )
    }
    const snapshot = await query.get()
    if (snapshot.empty) {
      queryExhausted = true
      break
    }
    scannedDocuments += snapshot.size
    queryExhausted = snapshot.size < batchLimit
    const submissions = await firestore.getAll(...snapshot.docs.map((document) => {
      const submissionId = typeof document.get('submissionId') === 'string'
        ? document.get('submissionId') as string
        : document.id
      return firestore.collection('submissions').doc(submissionId)
    }))
    const cleanupJobs = await firestore.getAll(...snapshot.docs.map((document) => {
      const submissionId = typeof document.get('submissionId') === 'string'
        ? document.get('submissionId') as string
        : document.id
      return firestore.collection('storageCleanupJobs').doc(submissionId)
    }))
    const staleReferences = []
    for (const [index, document] of snapshot.docs.entries()) {
      lastScannedDocument = document
      const documentCursor = timestampCursor(document, 'createdAt')
      if (documentCursor) scanCursor = documentCursor
      const record = submissionOperatorExceptionRecord(
        document.id,
        document.data(),
        submissions[index]?.data(),
        cleanupJobs[index]?.data(),
      )
      if (!record) {
        staleReferences.push(document.ref)
        continue
      }
      accepted.push({ document, record })
      if (accepted.length >= pageSize + 1) break
    }
    if (staleReferences.length) {
      const cleanup = firestore.batch()
      staleReferences.forEach((reference) => cleanup.update(reference, {
        status: 'resolved',
        resolution: 'stale_clean_publication',
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }))
      await cleanup.commit()
    }
  }

  const exceptions = accepted.slice(0, pageSize).map(({ record }) => record)
  const hasMore = accepted.length > pageSize || !queryExhausted
  const lastDocument = accepted.length > pageSize
    ? accepted[pageSize - 1]?.document
    : hasMore
      ? lastScannedDocument
      : undefined
  const nextCursor = lastDocument ? timestampCursor(lastDocument, 'createdAt') : null
  return {
    status: requestedStatus,
    items: exceptions,
    exceptions,
    hasMore,
    nextCursor: hasMore && nextCursor
      ? encodeSubmissionExceptionCursor(nextCursor)
      : null,
  }
})

export const resolveSubmissionOperatorException = onCall({ region: 'asia-northeast3', timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  requireSubmissionOperator(request.auth.token)
  const exceptionId = typeof request.data?.exceptionId === 'string' ? request.data.exceptionId.trim() : ''
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId.trim() : ''
  const action = request.data?.action
  if (!exceptionId || !submissionId || !isOneOf(action, submissionExceptionActions)) {
    throw new HttpsError('invalid-argument', '예외 처리 요청을 확인할 수 없어요')
  }
  if (action === 'retry_scan') {
    throw new HttpsError('failed-precondition', '기존 파일은 직접 재검사하지 않아요 제출자에게 안전한 파일로 보완을 요청해 주세요')
  }
  const correction = action === 'request_revision'
    ? validateReasonedContentModeration({ ...request.data, action: 'request_correction' })
    : null

  const firestore = getFirestore()
  const exceptionRef = firestore.collection('submissionOperatorExceptions').doc(exceptionId)
  const submissionRef = firestore.collection('submissions').doc(submissionId)
  const cleanupJobRef = firestore.collection('storageCleanupJobs').doc(submissionId)
  const commandRef = correction
    ? firestore.collection('auditEvents').doc(operatorModerationCommandKey(request.auth.uid, correction.requestId))
    : null
  await firestore.runTransaction(async (transaction) => {
    const [exceptionSnapshot, submissionSnapshot, cleanupJobSnapshot, existingCommand] = await Promise.all([
      transaction.get(exceptionRef),
      transaction.get(submissionRef),
      transaction.get(cleanupJobRef),
      commandRef ? transaction.get(commandRef) : Promise.resolve(null),
    ])
    if (existingCommand?.exists) {
      if (existingCommand.get('commandType') !== 'submission.exception_correction'
        || existingCommand.get('submissionId') !== submissionId
        || existingCommand.get('exceptionId') !== exceptionId
        || existingCommand.get('reason') !== correction?.reason) {
        throw new HttpsError('already-exists', '같은 요청 식별자가 다른 운영 조치에 사용됐어요')
      }
      return
    }
    if (
      !exceptionSnapshot.exists
      || exceptionSnapshot.get('submissionId') !== submissionId
      || exceptionSnapshot.get('status') !== 'open'
      || !submissionSnapshot.exists
    ) throw new HttpsError('not-found', '처리할 수 있는 열린 예외를 찾지 못했어요')

    const exception = exceptionSnapshot.data() as Record<string, unknown>
    const submission = submissionSnapshot.data() as Record<string, unknown>
    const allowed = allowedSubmissionExceptionActions(
      exception,
      submission,
      cleanupJobSnapshot.data(),
    )
    if (!allowed.includes(action)) {
      throw new HttpsError('failed-precondition', '현재 예외 상태에서는 이 작업을 실행할 수 없어요')
    }

    if (action === 'request_revision') {
      const notice = { action: 'request_correction', reason: correction!.reason, createdAt: FieldValue.serverTimestamp() }
      transaction.update(submissionRef, {
        status: 'revision_requested',
        moderationNotice: notice,
        moderationGuidance: notice,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewerUid: request.auth?.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(exceptionRef, {
        status: 'resolved',
        resolution: action,
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } else if (action === 'retry_cleanup') {
      transaction.update(cleanupJobRef, {
        status: 'retry_pending',
        attemptCount: 0,
        nextAttemptAt: FieldValue.serverTimestamp(),
        operatorRetriedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(submissionRef, {
        cleanupState: 'pending',
        cleanupFailure: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(exceptionRef, {
        lastAction: action,
        lastActionAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } else if (action === 'retry_publication') {
      transaction.update(submissionRef, {
        status: 'review_queued',
        approvalFailure: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(exceptionRef, {
        lastAction: action,
        lastActionAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } else {
      transaction.update(exceptionRef, {
        status: 'resolved',
        resolution: action,
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    transaction.set(commandRef ?? firestore.collection('auditEvents').doc(), {
      type: 'submission.operator_exception_action',
      ...(correction ? { commandType: 'submission.exception_correction', reason: correction.reason, requestId: correction.requestId } : {}),
      exceptionId,
      submissionId,
      action,
      uid: request.auth?.uid,
      at: FieldValue.serverTimestamp(),
    })
  })

  if (action === 'retry_cleanup') {
    const result = await attemptSubmissionStorageCleanup(submissionId)
    return { status: result.state }
  }
  if (action === 'retry_publication') {
    return publishCleanUploadSubmission(submissionId)
  }
  return { status: action === 'dismiss' ? 'resolved' : 'revision_requested' }
})

export const getMySubmissionDraft = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  const uid = request.auth.uid
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId.trim() : ''
  if (!submissionId) throw new HttpsError('invalid-argument', '수정할 제출을 찾지 못했어요')
  const snapshot = await getFirestore().collection('submissions').doc(submissionId).get()
  if (!snapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
  const data = snapshot.data() as Record<string, unknown>
  requireSubmissionOwner(data.ownerUid, uid)
  submissionOwnerManagementTransition(data, 'edit')
  const sourceMode = data.sourceMode === 'text' || data.sourceMode === 'google_drive_link' || data.sourceMode === 'instagram_url'
    ? data.sourceMode
    : 'upload'
  let existingFileCount = 0
  if (sourceMode === 'upload') {
    const selectedNames = selectedUploadNames(data.uploadSelection)
    if (selectedNames) {
      try {
        await Promise.all(selectedNames.map((name) => getStorage().bucket()
          .file(`quarantined/${uid}/${submissionId}/${name}`).getMetadata()))
        existingFileCount = selectedNames.length
      } catch (error) {
        if (!isStorageNotFound(error)) throw error
        existingFileCount = 0
      }
    } else {
      const [files] = await getStorage().bucket().getFiles({
        prefix: `quarantined/${uid}/${submissionId}/`,
        maxResults: MAX_SUBMISSION_FILES + 1,
      })
      if (files.length > MAX_SUBMISSION_FILES) {
        throw new HttpsError('failed-precondition', '기존 파일 수를 확인해 주세요')
      }
      existingFileCount = files.length
    }
  }
  return { submission: submissionEditableRecord(submissionId, data, existingFileCount) }
})

export const updateSubmissionDraft = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId.trim() : ''
  if (!submissionId) throw new HttpsError('invalid-argument', '수정할 제출을 찾지 못했어요')
  const input = validateSubmissionInput(request.data?.submission)
  const firestore = getFirestore()
  const ref = firestore.collection('submissions').doc(submissionId)
  const status = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
    const current = snapshot.data() as Record<string, unknown>
    requireSubmissionOwner(current.ownerUid, uid)
    const editableStatus = submissionOwnerManagementTransition(current, 'edit')
    requireSameSubmissionSourceMode(current.sourceMode, input.sourceMode)
    requireSameSubmissionKind(current.kind, input.kind)
    transaction.update(ref, {
      ...input,
      status: editableStatus,
      activity: input.activity ?? FieldValue.delete(),
      ...(Object.prototype.hasOwnProperty.call(request.data?.submission ?? {}, 'textContent')
        ? { textContent: input.textContent ?? FieldValue.delete() } : {}),
      recipe: input.recipe ?? FieldValue.delete(),
      sourceLink: input.sourceLink ?? FieldValue.delete(),
      instagramAttachments: input.instagramAttachments ?? FieldValue.delete(),
      scanStatus: input.sourceMode === 'upload' ? 'pending' : 'not_applicable',
      scanAttestation: FieldValue.delete(),
      ...(current.attachmentLifecycleVersion === 1
        ? { attachmentStatus: 'pending', attachmentRevision: randomUUID() }
        : {}),
      sourceVerification: input.sourceMode === 'google_drive_link'
        ? { status: 'pending' } satisfies SourceLinkVerification
        : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: 'submission.draft_updated', submissionId, uid, at: FieldValue.serverTimestamp(),
    })
    return editableStatus
  })
  return { status }
})

export const submitSubmission = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId : ''
  if (!submissionId) throw new HttpsError('invalid-argument', '제출 대상을 찾지 못했어요')

  const firestore = getFirestore()
  const ref = firestore.collection('submissions').doc(submissionId)
  const snapshot = await ref.get()
  const data = snapshot.data() as (Record<string, unknown> & {
    ownerUid?: string
    status?: string
    sourceMode?: SubmissionSourceMode
    sourceLink?: GoogleDriveSourceLink
    visibility?: unknown
  }) | undefined
  if (!data || data.ownerUid !== uid) throw new HttpsError('permission-denied', '내가 만든 초안만 제출할 수 있어요')
  const retryDecision = submissionSubmitRetryDecision(data)
  if (retryDecision === 'return_published') {
    return {
      status: 'published',
      materialId: data.materialId,
      ...(data.sourceMode === 'upload' ? { attachmentStatus: attachmentStatusProjection(data) } : {}),
    }
  }
  if (retryDecision === 'return_in_progress') {
    return { status: data.status, ...(data.sourceMode === 'upload' ? { attachmentStatus: attachmentStatusProjection(data) } : {}) }
  }
  if (retryDecision === 'resume_publication') return publishSubmissionCore(submissionId, { uid })
  if (retryDecision === 'invalid') throw new HttpsError('failed-precondition', '현재 제출할 수 없는 상태입니다')
  if (data.sourceMode === 'text') {
    await firestore.runTransaction(async transaction => {
      const current = await transaction.get(ref)
      const record = current.data() as Record<string, unknown>
      requireSubmissionOwner(record.ownerUid, uid)
      if (operatorModerationBlocksPublication(record.operatorModeration)) throw new HttpsError('failed-precondition', '공개 중단된 자료예요')
      if (record.status === 'published' || record.status === 'review_queued' || record.status === 'publishing' || record.status === 'publishing_failed') return
      if (record.status !== 'draft' && record.status !== 'revision_requested') throw new HttpsError('failed-precondition', '현재 게시할 수 없는 상태예요')
      if (!normalizeTextContent(record.textContent)) throw new HttpsError('invalid-argument', '공유할 내용을 적어 주세요')
      transaction.update(ref, { status: 'review_queued', scanStatus: 'not_applicable', fileCount: 0,
        submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.set(firestore.collection('auditEvents').doc(), { type: 'submission.submitted', submissionId, uid, at: FieldValue.serverTimestamp() })
    })
    return data.visibility === '보류' ? { status: 'review_queued' } : publishSubmissionCore(submissionId, { uid })
  }
  const selectedNames = selectedUploadNames(data.uploadSelection)
  const prefix = `quarantined/${uid}/${submissionId}/`
  const files = selectedNames
    ? selectedNames.map((name) => getStorage().bucket().file(`${prefix}${name}`))
    : (await getStorage().bucket().getFiles({ prefix, maxResults: MAX_SUBMISSION_FILES + 1 }))[0]
  const sourceMode = data.sourceMode ?? 'upload'
  assertSubmissionFilePolicy(sourceMode, files.length)
  const storedSelection = data.uploadSelection as UploadSelection | undefined
  const attachmentExpectedObjects: Array<{ path: string; generation: string; size: number; contentHash?: string }> = []
  for (const file of files) {
    let metadata
    try { [metadata] = await file.getMetadata() } catch (error) {
      if (selectedNames && isStorageNotFound(error)) {
        throw new HttpsError('failed-precondition', '선택한 첨부 파일을 모두 올린 뒤 다시 시도해 주세요')
      }
      throw error
    }
    const size = Number(metadata.size ?? 0)
    const selected = storedSelection?.files.find((item) => item.targetName === file.name.split('/').pop())
    const contentType = String(metadata.contentType ?? '')
    validateUploadDescriptor({ name: selected?.name ?? file.name.split('/').pop() ?? '', size, contentType })
    if (selected && (selected.size !== size || selected.contentType !== contentType)) {
      throw new HttpsError('failed-precondition', '저장된 파일이 현재 선택한 파일과 달라요')
    }
    const generation = String(metadata.generation ?? '')
    if (!generation) throw new HttpsError('failed-precondition', '첨부 파일 버전을 확인할 수 없어요')
    attachmentExpectedObjects.push({
      path: file.name,
      generation,
      size,
      ...(selected ? { contentHash: `sha256:${selected.sha256}` } : {}),
    })
  }
  attachmentExpectedObjects.sort((left, right) => left.path.localeCompare(right.path))

  if (sourceMode === 'upload') {
    const attachmentRevision = randomUUID()
    const materialRef = firestore.collection('materials').doc(submissionId)
    const activityRef = firestore.collection('activities').doc(submissionId)
    return firestore.runTransaction(async (transaction) => {
      const [currentSnapshot, existingMaterial, existingActivity] = await Promise.all([
        transaction.get(ref),
        transaction.get(materialRef),
        transaction.get(activityRef),
      ])
      if (!currentSnapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
      const current = currentSnapshot.data() as Record<string, unknown>
      requireSubmissionOwner(current.ownerUid, uid)
      if (current.status !== 'draft' && current.status !== 'revision_requested') {
        throw new HttpsError('failed-precondition', '현재 제출할 수 없는 상태입니다')
      }
      if (operatorModerationBlocksPublication(current.operatorModeration)) throw new HttpsError('failed-precondition', '공개 중단된 자료예요')
      if (!sameOptionalStringList(selectedNames, selectedUploadNames(current.uploadSelection))) {
        throw new HttpsError('aborted', '제출 중 첨부 파일 선택이 바뀌었어요 다시 시도해 주세요')
      }
      const input = validateSubmissionInput(current)
      if (input.sourceMode !== 'upload') throw new HttpsError('failed-precondition', '첨부 제출 방식을 다시 확인해 주세요')
      const visible = input.visibility === '공개' || input.visibility === '회원 전용'
      const visibility = input.visibility === '회원 전용' ? 'member_only' : 'public'
      const pendingFailures = Array.isArray(current.pendingAttachmentFailures) ? current.pendingAttachmentFailures : []
      const attachmentStatus: 'pending' | 'error' = pendingFailures.some((failure) => failure && typeof failure === 'object'
        && attachmentExpectedObjects.some((object) => object.path === failure.path && object.generation === failure.generation))
        ? 'error'
        : 'pending'
      const projection = visible ? buildPendingUploadPublication(submissionId, input, visibility, attachmentStatus) : undefined
      const timestamp = FieldValue.serverTimestamp()
      transaction.update(ref, {
        status: visible ? 'published' : 'review_queued',
        materialId: visible ? materialRef.id : FieldValue.delete(),
        ...(visible
          ? { attachmentLifecycleVersion: 1, attachmentRevision, attachmentExpectedObjects }
          : { attachmentLifecycleVersion: FieldValue.delete(), attachmentRevision: FieldValue.delete(), attachmentExpectedObjects: FieldValue.delete() }),
        attachmentStatus,
        previewStatus: FieldValue.delete(),
        scanStatus: attachmentStatus,
        scanAttestation: FieldValue.delete(),
        scanRecordedBy: FieldValue.delete(),
        pendingAttachmentFailures: FieldValue.delete(),
        fileCount: attachmentExpectedObjects.length,
        submittedAt: timestamp,
        updatedAt: timestamp,
      })
      if (projection) {
        transaction.set(materialRef, {
          ...projection.material,
          rights: {
            ...(projection.material.rights as Record<string, unknown>),
            reviewDueAt: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1_000),
          },
          createdAt: existingMaterial.exists ? existingMaterial.get('createdAt') ?? timestamp : timestamp,
          updatedAt: timestamp,
        })
        if (projection.activity) {
          transaction.set(activityRef, {
            ...projection.activity,
            ownerUid: FieldValue.delete(),
            attachmentStatus,
            createdAt: existingActivity.exists ? existingActivity.get('createdAt') ?? timestamp : timestamp,
            updatedAt: timestamp,
          }, activityPublicationSetOptions)
        }
      }
      transaction.create(firestore.collection('auditEvents').doc(), {
        type: visible ? 'submission.body_published_attachment_pending' : 'submission.submitted',
        submissionId,
        uid,
        attachmentRevision,
        at: timestamp,
      })
      return visible
        ? { status: 'published' as const, materialId: materialRef.id, attachmentStatus }
        : { status: 'review_queued' as const, attachmentStatus }
    })
  }

  const nowMs = Date.now()
  const sourceVerification = sourceMode === 'google_drive_link' && data.sourceLink
    ? {
        status: 'verified' as const,
        verificationId: randomUUID(),
        sourceFingerprint: googleDriveSourceFingerprint(data.sourceLink),
        verifiedAt: Timestamp.fromMillis(nowMs),
        verifiedByUid: uid,
        method: 'owner_public_link_confirmation' as const,
        note: '작성자가 공개 링크와 공유 권한을 확인함',
        reviewDueAt: Timestamp.fromMillis(nowMs + SOURCE_LINK_REVIEW_MS),
      } satisfies SourceLinkVerification
    : undefined
  await ref.update({
    status: 'review_queued',
    scanStatus: 'not_applicable',
    scanAttestation: FieldValue.delete(),
    fileCount: files.length,
    ...(sourceMode === 'google_drive_link'
      ? { sourceVerification }
      : {}),
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await firestore.collection('auditEvents').doc().set({
    type: 'submission.submitted',
    submissionId,
    uid,
    at: FieldValue.serverTimestamp(),
  })
  if ((sourceMode === 'google_drive_link' || sourceMode === 'instagram_url') && data.visibility !== '보류') {
    return publishSubmissionCore(submissionId, { uid })
  }
  return { status: 'review_queued' }
})

export const withdrawSubmission = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId.trim() : ''
  if (!submissionId) throw new HttpsError('invalid-argument', '철회할 제출을 찾지 못했어요')
  const firestore = getFirestore()
  const ref = firestore.collection('submissions').doc(submissionId)
  await firestore.runTransaction(async (transaction) => {
    const exceptionRef = firestore.collection('submissionOperatorExceptions').doc(submissionId)
    const [snapshot, operatorException] = await Promise.all([
      transaction.get(ref),
      transaction.get(exceptionRef),
    ])
    if (!snapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
    const data = snapshot.data() as Record<string, unknown>
    requireSubmissionOwner(data.ownerUid, uid)
    submissionOwnerTransition(data.status, 'withdraw')
    transaction.update(ref, { status: 'withdrawn', withdrawnAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    if (operatorException.exists) {
      transaction.update(exceptionRef, {
        status: 'resolved',
        resolution: 'withdrawn',
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: 'submission.withdrawn', submissionId, uid, at: FieldValue.serverTimestamp(),
    })
  })
  return { status: 'withdrawn' }
})

export const requestSubmissionChange = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId.trim() : ''
  const action = request.data?.action
  if (!submissionId) throw new HttpsError('invalid-argument', '변경할 제출을 찾지 못했어요')
  if (action !== 'request_revision' && action !== 'unpublish' && action !== 'restore_private') {
    throw new HttpsError('invalid-argument', '변경 방법을 확인해 주세요')
  }
  const firestore = getFirestore()
  const ref = firestore.collection('submissions').doc(submissionId)
  const materialRef = firestore.collection('materials').doc(submissionId)
  const activityRef = firestore.collection('activities').doc(submissionId)
  const changeRef = firestore.collection('submissionChangeRequests').doc()
  const cleanupJobRef = firestore.collection('storageCleanupJobs').doc(submissionId)
  const result = await firestore.runTransaction(async (transaction) => {
    const [snapshot, material, activity] = await Promise.all([
      transaction.get(ref),
      transaction.get(materialRef),
      transaction.get(activityRef),
    ])
    if (!snapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
    const data = snapshot.data() as Record<string, unknown>
    requireSubmissionOwner(data.ownerUid, uid)
    if (data.deletedFromListings === true) throw new HttpsError('failed-precondition', '삭제된 자료는 복원할 수 없어요')
    const restorePlan = action === 'restore_private' ? submissionPrivateDraftRestorePlan(data) : null
    const nextStatus = restorePlan?.nextStatus ?? submissionOwnerTransition(data.status, action)
    const restoreChangeRequestId = restorePlan?.alreadyApplied && typeof data.restoreChangeRequestId === 'string'
      ? data.restoreChangeRequestId
      : changeRef.id
    const cleanupObjects = action === 'unpublish'
      ? storageCleanupObjects(
          material.data() as Record<string, unknown> | undefined,
          data,
        )
      : []
    if (!restorePlan?.alreadyApplied) {
      transaction.update(ref, {
        status: nextStatus,
        updatedAt: FieldValue.serverTimestamp(),
        ...(action === 'unpublish' ? { unpublishedAt: FieldValue.serverTimestamp() } : {}),
        ...(action === 'restore_private' ? {
          visibility: '보류',
          restoredFromWithdrawal: data.status === 'withdrawn',
          restoredFromUnpublication: data.status === 'unpublished',
          restoredAt: FieldValue.serverTimestamp(),
          restoreChangeRequestId,
        } : {}),
        ...(action === 'unpublish' && cleanupObjects.length
          ? {
              cleanupState: 'pending',
              cleanupObjects,
              cleanupRequestId: changeRef.id,
              cleanupQueuedAt: FieldValue.serverTimestamp(),
            }
          : {}),
      })
      transaction.set(changeRef, {
        submissionId,
        ownerUid: uid,
        action,
        status: action === 'unpublish' || action === 'restore_private' ? 'completed' : 'pending',
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    if (action === 'unpublish') {
      if (material.exists) transaction.update(materialRef, { status: 'unpublished', updatedAt: FieldValue.serverTimestamp() })
      if (activity.exists) transaction.update(activityRef, { status: 'unpublished', visibility: 'hold', updatedAt: FieldValue.serverTimestamp() })
      if (cleanupObjects.length) {
        transaction.set(cleanupJobRef, {
          submissionId,
          cleanupRequestId: changeRef.id,
          planVersion: 0,
          rawObjects: cleanupObjects,
          attemptCount: 0,
          status: 'queued',
          nextAttemptAt: FieldValue.serverTimestamp(),
          queuedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    }
    if (action === 'restore_private') {
      if (material.exists && (material.get('status') !== 'unpublished' || material.get('visibility') !== 'hold')) {
        transaction.update(materialRef, { status: 'unpublished', visibility: 'hold', updatedAt: FieldValue.serverTimestamp() })
      }
      if (activity.exists && (activity.get('status') !== 'unpublished' || activity.get('visibility') !== 'hold')) {
        transaction.update(activityRef, { status: 'unpublished', visibility: 'hold', updatedAt: FieldValue.serverTimestamp() })
      }
    }
    if (!restorePlan?.alreadyApplied) {
      transaction.set(firestore.collection('auditEvents').doc(), {
        type: action === 'unpublish'
          ? 'submission.unpublished'
          : action === 'restore_private' ? 'submission.restored_private_draft' : 'submission.revision_requested_by_owner',
        submissionId,
        changeRequestId: restoreChangeRequestId,
        ...(action === 'restore_private' ? { previousStatus: data.status, visibility: '보류' } : {}),
        uid,
        at: FieldValue.serverTimestamp(),
      })
    }
    return { status: nextStatus, cleanupQueued: cleanupObjects.length > 0, changeRequestId: restoreChangeRequestId }
  })
  const cleanup = action === 'unpublish' && result.cleanupQueued
    ? await attemptSubmissionStorageCleanup(submissionId)
    : undefined
  return {
    status: result.status,
    changeRequestId: result.changeRequestId,
    cleanupState: cleanup?.state ?? (action === 'unpublish' ? 'not_required' : undefined),
  }
})

export const reviewSubmission = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  requireSubmissionOperator(request.auth.token)
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId : ''
  const decision = request.data?.decision
  if (decision !== 'revision_requested' && decision !== 'held') throw new HttpsError('invalid-argument', '검토 결정을 확인해 주세요')
  const firestore = getFirestore()
  const ref = firestore.collection('submissions').doc(submissionId)
  await firestore.runTransaction(async (transaction) => {
    const exceptionRef = firestore.collection('submissionOperatorExceptions').doc(submissionId)
    const [snapshot, operatorException] = await Promise.all([
      transaction.get(ref),
      transaction.get(exceptionRef),
    ])
    if (!snapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
    if (snapshot.get('status') === 'publishing' || snapshot.get('status') === 'published') {
      throw new HttpsError('failed-precondition', '공개 작업이 시작된 자료의 상태는 바꿀 수 없어요')
    }
    transaction.update(ref, { status: decision, reviewedAt: FieldValue.serverTimestamp(), reviewerUid: request.auth?.uid, updatedAt: FieldValue.serverTimestamp() })
    if (operatorException.exists) {
      transaction.update(exceptionRef, {
        status: 'resolved',
        resolution: decision,
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  })
  return { status: decision }
})

export const moderateSubmissionContent = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  requireSubmissionOperator(request.auth.token)
  const operatorUid = request.auth.uid
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId.trim() : ''
  if (!submissionId) throw new HttpsError('invalid-argument', '운영할 제출을 확인해 주세요')
  const command = validateReasonedContentModeration(request.data)
  const firestore = getFirestore()
  const submissionRef = firestore.collection('submissions').doc(submissionId)
  const materialRef = firestore.collection('materials').doc(submissionId)
  const activityRef = firestore.collection('activities').doc(submissionId)
  const commandRef = firestore.collection('auditEvents').doc(operatorModerationCommandKey(operatorUid, command.requestId))
  return firestore.runTransaction(async (transaction) => {
    const [submissionSnapshot, materialSnapshot, activitySnapshot, existingCommand] = await Promise.all([
      transaction.get(submissionRef),
      transaction.get(materialRef),
      transaction.get(activityRef),
      transaction.get(commandRef),
    ])
    if (!submissionSnapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
    if (existingCommand.exists) {
      const same = existingCommand.get('commandType') === 'content.moderation_command'
        && existingCommand.get('targetType') === 'submission'
        && existingCommand.get('targetId') === submissionId
        && existingCommand.get('action') === command.action
        && existingCommand.get('reason') === command.reason
      const status = existingCommand.get('nextStatus')
      if (!same || typeof status !== 'string' || !submissionStatuses.includes(status as SubmissionStatus)) {
        throw new HttpsError('already-exists', '같은 요청 식별자가 다른 운영 조치에 사용됐어요')
      }
      return { status: status as SubmissionStatus, action: command.action, repeated: true }
    }
    const value = submissionSnapshot.data() as Record<string, unknown>
    if (value.deletedFromListings === true) throw new HttpsError('failed-precondition', '삭제된 자료는 복원할 수 없어요')
    const currentStatus = value.status as SubmissionStatus
    if (!submissionStatuses.includes(currentStatus)) throw new HttpsError('failed-precondition', '제출 상태를 확인할 수 없어요')
    const marker = value.operatorModeration as Record<string, unknown> | undefined
    const markerAction = operatorModerationBlocksPublication(marker) ? marker?.action as OperatorVisibilityAction : undefined
    const hasVisibleOrOperatorHiddenProjection = materialSnapshot.get('status') === 'published'
      || activitySnapshot.get('status') === 'published'
      || Boolean(markerAction && (materialSnapshot.exists || activitySnapshot.exists))
    const plan = submissionModerationPlan({
      status: currentStatus,
      action: command.action,
      hasPublicProjection: hasVisibleOrOperatorHiddenProjection,
      hasPriorGuidance: Boolean(value.moderationGuidance),
      markerAction,
    })
    const timestamp = FieldValue.serverTimestamp()
    const notice = { action: command.action, reason: command.reason, createdAt: timestamp }
    const previousActivityVisibility = preservedPublishedVisibility(
      marker,
      activitySnapshot.get('visibility'),
      materialSnapshot.get('visibility'),
    )
    transaction.update(submissionRef, {
      status: plan.nextStatus,
      moderationNotice: notice,
      ...(command.action === 'warn' || command.action === 'request_correction'
        ? { moderationGuidance: notice }
        : command.action === 'remove' || command.action === 'restore'
          ? { moderationGuidance: FieldValue.delete() }
          : {}),
      ...(command.action === 'hold' || command.action === 'remove'
        ? {
            operatorModeration: {
              action: command.action,
              reason: command.reason,
              requestId: command.requestId,
              previousActivityVisibility,
              createdAt: timestamp,
            },
          }
        : command.action === 'restore'
          ? { operatorModeration: FieldValue.delete() }
          : {}),
      updatedAt: timestamp,
    })
    if (plan.publicAction === 'hide') {
      if (materialSnapshot.exists) transaction.update(materialRef, { status: command.action === 'hold' ? 'held' : 'unpublished', updatedAt: timestamp })
      if (activitySnapshot.exists) transaction.update(activityRef, { status: 'unpublished', visibility: 'hold', updatedAt: timestamp })
    } else if (plan.publicAction === 'restore') {
      if (!materialSnapshot.exists) throw new HttpsError('failed-precondition', '복원할 안전한 공개 자료를 찾지 못했어요')
      assertRestorableMaterialProjection(submissionId, materialSnapshot.data() as Record<string, unknown>)
      transaction.update(materialRef, { status: 'published', updatedAt: timestamp })
      if (activitySnapshot.exists) {
        if (!previousActivityVisibility) {
          throw new HttpsError('failed-precondition', '복원할 원래 공개 범위를 확인하지 못했어요')
        }
        transaction.update(activityRef, {
          status: 'published',
          visibility: previousActivityVisibility,
          updatedAt: timestamp,
        })
      }
    }
    transaction.create(commandRef, {
      type: `submission.${command.action}`,
      commandType: 'content.moderation_command',
      targetType: 'submission',
      targetId: submissionId,
      action: command.action,
      reason: command.reason,
      requestId: command.requestId,
      previousStatus: currentStatus,
      nextStatus: plan.nextStatus,
      uid: operatorUid,
      at: timestamp,
    })
    return { status: plan.nextStatus, action: command.action, repeated: false }
  })
})

export const verifySubmissionSourceLink = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  requireSubmissionOperator(request.auth.token)
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId.trim() : ''
  const attestation = validateSourceLinkVerificationAttestation(request.data)
  if (!submissionId) throw new HttpsError('invalid-argument', '제출 대상을 찾지 못했어요')
  const firestore = getFirestore()
  const ref = firestore.collection('submissions').doc(submissionId)
  const verificationId = randomUUID()
  const nowMs = Date.now()
  const result = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
    const data = snapshot.data() as ApprovalState
    if (data.status !== 'review_queued' || data.sourceMode !== 'google_drive_link' || !data.sourceLink) {
      throw new HttpsError('failed-precondition', '원본 링크를 확인할 수 없는 제출 상태입니다')
    }
    const sourceFingerprint = googleDriveSourceFingerprint(data.sourceLink)
    const sourceVerification: SourceLinkVerification = {
      status: 'verified',
      verificationId,
      sourceFingerprint,
      verifiedAt: Timestamp.fromMillis(nowMs),
      verifiedByUid: request.auth?.uid,
      method: 'manual_signed_out_view_check',
      note: attestation.note,
      reviewDueAt: Timestamp.fromMillis(nowMs + SOURCE_LINK_REVIEW_MS),
    }
    transaction.update(ref, {
      sourceVerification,
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: 'submission.source_link_verified',
      submissionId,
      verificationId,
      sourceFingerprint,
      uid: request.auth?.uid,
      at: FieldValue.serverTimestamp(),
    })
    return { verificationId, sourceFingerprint }
  })
  return { status: 'verified', ...result }
})

export const recordSubmissionScanResult = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  requireScanAttestor(request.auth.token)
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId.trim() : ''
  if (!submissionId) throw new HttpsError('invalid-argument', '제출 대상을 찾지 못했어요')
  const attestation = parseScanAttestation(request.data?.attestation)
  const firestore = getFirestore()
  const ref = firestore.collection('submissions').doc(submissionId)
  const snapshot = await ref.get()
  const data = snapshot.data() as (Record<string, unknown> & { ownerUid?: string; status?: string; sourceMode?: SubmissionSourceMode }) | undefined
  const independent = data?.attachmentLifecycleVersion === 1
  if (!data || !data.ownerUid || (independent
    ? data.status !== 'published' || data.attachmentStatus !== 'pending' || operatorModerationBlocksPublication(data.operatorModeration)
    : data.status !== 'review_queued')) {
    throw new HttpsError('failed-precondition', '검사 결과를 기록할 수 없는 제출 상태입니다')
  }
  if (data.sourceMode && data.sourceMode !== 'upload') {
    throw new HttpsError('failed-precondition', '원본 링크 제출에는 파일 검사를 기록하지 않아요')
  }
  const capturedSelection = selectedUploadNames(data.uploadSelection)
  const objects = await getQuarantinedObjects(`quarantined/${data.ownerUid}/${submissionId}/`, capturedSelection)
  assertAttestationMatchesObjects(attestation, objects)
  const capturedRevision = data.attachmentRevision
  const recorded = await firestore.runTransaction(async (transaction) => {
    const materialRef = firestore.collection('materials').doc(submissionId)
    const activityRef = firestore.collection('activities').doc(submissionId)
    const [current, material, activity] = await Promise.all([
      transaction.get(ref), transaction.get(materialRef), transaction.get(activityRef),
    ])
    const currentIndependent = current.get('attachmentLifecycleVersion') === 1
    if (!sameOptionalStringList(capturedSelection, selectedUploadNames(current.get('uploadSelection')))) {
      throw new HttpsError('aborted', '첨부 파일 선택이 바뀌었어요 다시 확인해 주세요')
    }
    if (currentIndependent
      ? current.get('status') !== 'published' || current.get('attachmentStatus') !== 'pending'
        || current.get('attachmentRevision') !== capturedRevision
        || operatorModerationBlocksPublication(current.get('operatorModeration'))
      : current.get('status') !== 'review_queued') {
      throw new HttpsError('aborted', '제출 상태가 바뀌었어요 다시 확인해 주세요')
    }
    const timestamp = FieldValue.serverTimestamp()
    transaction.update(ref, {
      scanStatus: attestation.verdict,
      ...(currentIndependent ? {
        attachmentStatus: attestation.verdict === 'blocked' ? 'blocked' : 'pending',
        ...(attestation.verdict === 'blocked' ? { previewStatus: FieldValue.delete() } : {}),
      } : {}),
      scanAttestation: attestation,
      scanRecordedAt: timestamp,
      scanRecordedBy: 'manual-scan-attestor',
      scanRecordedByUid: request.auth?.uid,
      updatedAt: timestamp,
    })
    if (currentIndependent && attestation.verdict === 'blocked') {
      if (material.exists && material.get('status') === 'published') {
        transaction.update(materialRef, {
          attachmentStatus: 'blocked',
          approvedStoragePath: FieldValue.delete(), approvedStoragePaths: FieldValue.delete(),
          approvedStorageObjects: FieldValue.delete(), sourceFormat: FieldValue.delete(),
          previewStoragePath: FieldValue.delete(), previewStatus: FieldValue.delete(), updatedAt: timestamp,
        })
      }
      if (activity.exists && activity.get('status') === 'published') transaction.update(activityRef, { attachmentStatus: 'blocked', updatedAt: timestamp })
    }
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: 'submission.scan_recorded',
      submissionId,
      scanId: attestation.scanId,
      verdict: attestation.verdict,
      uid: request.auth?.uid,
      ...(currentIndependent ? { attachmentRevision: capturedRevision } : {}),
      at: timestamp,
    })
    return currentIndependent
  })
  if (recorded && attestation.verdict === 'clean') return publishCleanUploadSubmission(submissionId)
  return { scanStatus: attestation.verdict, scanId: attestation.scanId, ...(recorded ? { attachmentStatus: attestation.verdict } : {}) }
})

async function publishSubmissionCore(
  submissionId: string,
  actor: { uid: string; role?: 'administrator' | 'moderator' } | null,
) {
  const firestore = getFirestore()
  const ref = firestore.collection('submissions').doc(submissionId)
  const materialRef = firestore.collection('materials').doc(submissionId)
  const attemptId = randomUUID()
  const nowMs = Date.now()

  const reservation = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
    const data = snapshot.data() as ApprovalState
    if (operatorModerationBlocksPublication((data as Record<string, unknown>).operatorModeration)) {
      throw new HttpsError('failed-precondition', '운영자가 공개를 중단한 자료는 복원 뒤에만 다시 공개할 수 있어요')
    }
    const decision = approvalReservationDecision({
      status: data.status,
      materialId: data.materialId,
      expectedMaterialId: materialRef.id,
      leaseExpiresAtMs: data.approvalLeaseExpiresAt?.toMillis() ?? 0,
      nowMs,
    })
    if (decision === 'published') return { kind: 'published' as const }
    if (decision === 'busy') {
      throw new HttpsError('aborted', '다른 승인 작업이 진행 중이에요 잠시 뒤 다시 확인해 주세요')
    }
    if (decision === 'invalid') {
      throw new HttpsError('failed-precondition', '승인할 수 없는 제출 상태입니다')
    }
    if (!data.ownerUid) throw new HttpsError('failed-precondition', '제출자 정보를 확인할 수 없어요')
    const sourceMode = data.sourceMode ?? 'upload'
    const isModerator = actor?.role === 'moderator' || actor?.role === 'administrator'
    const isAutomatedCleanUpload = actor === null && sourceMode === 'upload'
    const canOwnerPublishInstagram = canSubmissionOwnerPublish({
      actorUid: actor?.uid ?? '',
      ownerUid: data.ownerUid,
      sourceMode,
      visibility: data.visibility,
    })
    if (!isModerator && !canOwnerPublishInstagram && !isAutomatedCleanUpload) {
      throw new HttpsError('permission-denied', '이 자료를 공개할 권한이 없어요')
    }
    let attestation: ScanAttestation | undefined
    let manifest: ApprovalCopyManifestEntry[] = []
    let sourceFingerprint: string | undefined
    let sourceVerificationId: string | undefined
    if (sourceMode === 'text') {
      const text = normalizeTextContent(data.textContent)
      if (!text || data.scanStatus !== 'not_applicable') throw new HttpsError('failed-precondition', '공유할 본문을 확인해 주세요')
      sourceFingerprint = createHash('sha256').update(JSON.stringify(text)).digest('hex')
    } else if (sourceMode === 'google_drive_link') {
      if (data.scanStatus !== 'not_applicable') {
        throw new HttpsError('failed-precondition', '원본 링크 제출의 검사 상태를 확인할 수 없어요')
      }
      sourceFingerprint = sourceLinkApprovalFingerprint(data.sourceLink, data.sourceVerification, nowMs)
      sourceVerificationId = data.sourceVerification?.verificationId
    } else if (sourceMode === 'instagram_url') {
      if (data.scanStatus !== 'not_applicable') {
        throw new HttpsError('failed-precondition', 'Instagram 원문 제출의 검사 상태를 확인할 수 없어요')
      }
      const instagramAttachments = validateInstagramAttachments(data.instagramAttachments)
      if (!instagramAttachments.length) {
        throw new HttpsError('failed-precondition', '검토할 Instagram 원문 링크를 찾지 못했어요')
      }
      data.instagramAttachments = instagramAttachments
      sourceFingerprint = instagramAttachmentsFingerprint(instagramAttachments)
    } else {
      assertAutomatedScanPublicationReady(FILE_SCANNER_ENDPOINT.value(), data.scanRecordedBy)
      if (data.scanStatus !== 'clean') throw new HttpsError('failed-precondition', '악성 파일 검사가 완료되기 전에는 승인할 수 없어요')
      attestation = parseScanAttestation(data.scanAttestation, nowMs)
      if (attestation.verdict !== 'clean') throw new HttpsError('failed-precondition', '안전한 파일만 승인할 수 있어요')
      manifest = buildApprovalCopyManifest(submissionId, attestation, data.copyManifest)
    }
    const staleManagedPaths = sourceMode === 'upload'
      ? staleApprovalManagedPaths(data.copyManifest, manifest)
      : []
    transaction.update(ref, {
      status: 'publishing',
      materialId: materialRef.id,
      approvalAttemptId: attemptId,
      ...(attestation ? { approvalScanId: attestation.scanId } : { approvalScanId: FieldValue.delete() }),
      ...(sourceFingerprint
        ? { approvalSourceFingerprint: sourceFingerprint }
        : { approvalSourceFingerprint: FieldValue.delete() }),
      ...(sourceVerificationId
        ? { approvalSourceVerificationId: sourceVerificationId }
        : { approvalSourceVerificationId: FieldValue.delete() }),
      approvalLeaseExpiresAt: Timestamp.fromMillis(nowMs + APPROVAL_LEASE_MS),
      approvalFailure: FieldValue.delete(),
      ...(sourceMode === 'upload' ? { copyManifest: manifest } : { copyManifest: FieldValue.delete() }),
      ...(staleManagedPaths.length
        ? { staleManagedPaths: FieldValue.arrayUnion(...staleManagedPaths) }
        : {}),
      publishingStartedAt: FieldValue.serverTimestamp(),
      reviewerUid: isModerator ? actor?.uid : FieldValue.delete(),
      publicationMode: isModerator
        ? 'manual_exception'
        : actor
          ? 'owner_self_service'
          : 'automatic_clean_upload',
      updatedAt: FieldValue.serverTimestamp(),
    })
    return {
      kind: 'reserved' as const,
      data,
      sourceMode,
      attestation,
      manifest,
      sourceFingerprint,
      sourceVerificationId,
    }
  })

  if (reservation.kind === 'published') return { status: 'published', materialId: materialRef.id }

  try {
    const quarantinedObjects = await getQuarantinedObjects(
      `quarantined/${reservation.data.ownerUid}/${submissionId}/`,
      selectedUploadNames((reservation.data as Record<string, unknown>).uploadSelection),
    )
    if (reservation.sourceMode !== 'upload') {
      if (quarantinedObjects.length) {
        throw new HttpsError('failed-precondition', '원본 링크 제출에는 파일을 함께 공개할 수 없어요')
      }
    } else {
      if (!reservation.attestation) throw new HttpsError('failed-precondition', '파일 검사 결과를 찾을 수 없어요')
      assertAttestationMatchesObjects(reservation.attestation, quarantinedObjects)
    }
    let manifest = reservation.manifest

    for (const entry of reservation.sourceMode === 'upload' ? manifest : []) {
      const destinationGeneration = await copyApprovalObject(entry)
      const copiedAtMs = Date.now()
      manifest = markApprovalCopyComplete(manifest, entry.destinationPath, copiedAtMs, destinationGeneration)
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(ref)
        if (current.get('status') !== 'publishing' || current.get('approvalAttemptId') !== attemptId) {
          throw new HttpsError('aborted', '승인 작업의 소유권이 바뀌었어요 다시 확인해 주세요')
        }
        if (operatorModerationBlocksPublication(current.get('operatorModeration'))) {
          throw new HttpsError('aborted', '운영자가 공개를 중단해 파일 복사를 계속할 수 없어요')
        }
        transaction.update(ref, {
          copyManifest: manifest,
          approvalLeaseExpiresAt: Timestamp.fromMillis(copiedAtMs + APPROVAL_LEASE_MS),
          updatedAt: FieldValue.serverTimestamp(),
        })
      })
    }

    const visibility = reservation.data.visibility === '공개' ? 'public' : reservation.data.visibility === '회원 전용' ? 'member_only' : 'hold'
    const activity = buildActivityPublication(submissionId, reservation.data, visibility)
    const activityRef = activity ? firestore.collection('activities').doc(submissionId) : null
    const publicationCleanupQueued = await firestore.runTransaction(async (transaction) => {
      const exceptionRef = firestore.collection('submissionOperatorExceptions').doc(submissionId)
      const [current, operatorException, existingMaterial, existingActivity] = await Promise.all([
        transaction.get(ref),
        transaction.get(exceptionRef),
        transaction.get(materialRef),
        activityRef ? transaction.get(activityRef) : Promise.resolve(null),
      ])
      const currentAttestation = current.get('scanAttestation') as ScanAttestation | undefined
      const currentManifest = current.get('copyManifest') as ApprovalCopyManifestEntry[] | undefined
      if (current.get('status') !== 'publishing' || current.get('approvalAttemptId') !== attemptId) {
        throw new HttpsError('aborted', '승인 작업의 상태가 바뀌었어요 다시 확인해 주세요')
      }
      if (operatorModerationBlocksPublication(current.get('operatorModeration'))) {
        throw new HttpsError('aborted', '운영자가 공개를 중단해 승인 작업을 마칠 수 없어요')
      }
      if (reservation.sourceMode === 'text') {
        const text = normalizeTextContent(current.get('textContent'))
        if (!text || current.get('scanStatus') !== 'not_applicable'
          || createHash('sha256').update(JSON.stringify(text)).digest('hex') !== reservation.sourceFingerprint) {
          throw new HttpsError('aborted', '게시 중 본문이 바뀌었어요. 다시 시도해 주세요')
        }
      } else if (reservation.sourceMode === 'google_drive_link') {
        const currentSource = current.get('sourceLink') as GoogleDriveSourceLink | undefined
        const currentVerification = current.get('sourceVerification') as SourceLinkVerification | undefined
        const currentFingerprint = sourceLinkApprovalFingerprint(currentSource, currentVerification, Date.now())
        if (
          current.get('scanStatus') !== 'not_applicable'
          || currentFingerprint !== reservation.sourceFingerprint
          || current.get('approvalSourceFingerprint') !== reservation.sourceFingerprint
          || currentVerification?.verificationId !== reservation.sourceVerificationId
          || current.get('approvalSourceVerificationId') !== reservation.sourceVerificationId
        ) throw new HttpsError('aborted', '원본 링크 확인 상태가 바뀌었어요 다시 확인해 주세요')
      } else if (reservation.sourceMode === 'instagram_url') {
        const currentAttachments = validateInstagramAttachments(current.get('instagramAttachments'))
        if (
          current.get('scanStatus') !== 'not_applicable'
          || !currentAttachments.length
          || instagramAttachmentsFingerprint(currentAttachments) !== reservation.sourceFingerprint
          || current.get('approvalSourceFingerprint') !== reservation.sourceFingerprint
        ) throw new HttpsError('aborted', 'Instagram 원문 링크가 바뀌었어요 다시 확인해 주세요')
      } else if (
        current.get('scanStatus') !== 'clean'
        || currentAttestation?.scanId !== reservation.attestation?.scanId
        || !currentManifest?.length
        || currentManifest.some((entry) => entry.state !== 'copied')
      ) throw new HttpsError('aborted', '검토 또는 복사 상태가 바뀌었어요 다시 확인해 주세요')

      const approvedPaths = reservation.sourceMode === 'upload'
        ? (currentManifest ?? []).map((entry) => entry.destinationPath)
        : []
      const approvedStorageObjects = reservation.sourceMode === 'upload'
        ? (currentManifest ?? []).map((entry) => ({
            path: entry.destinationPath,
            generation: entry.destinationGeneration,
          }))
        : []
      const documentAssets = reservation.sourceMode === 'upload'
        ? classifyPublishedDocumentAssets(approvedPaths)
        : undefined
      const staleCleanupObjects = storageCleanupObjects({
        staleManagedPaths: current.get('staleManagedPaths'),
      })
      const verifiedSourceLink = reservation.sourceMode === 'google_drive_link' && reservation.data.sourceLink
        ? {
            provider: reservation.data.sourceLink.provider,
            fileId: reservation.data.sourceLink.fileId,
            sourceKind: reservation.data.sourceLink.sourceKind,
            sourceUrl: reservation.data.sourceLink.sourceUrl,
            status: 'verified',
            verificationId: reservation.sourceVerificationId,
            sourceFingerprint: reservation.sourceFingerprint,
            verifiedAt: reservation.data.sourceVerification?.verifiedAt,
            reviewDueAt: reservation.data.sourceVerification?.reviewDueAt,
          }
        : undefined
      transaction.set(materialRef, {
        sourceMode: reservation.sourceMode,
        ...(reservation.data.textContent ? { textContent: reservation.data.textContent } : {}),
        title: reservation.data.title,
        kind: reservation.data.kind,
        owner: reservation.data.owner,
        status: 'published',
        visibility,
        ...(reservation.data.instagramAttachments?.length
          ? { instagramAttachments: reservation.data.instagramAttachments }
          : {}),
        ...(activity ? { activitySlug: activity.slug } : {}),
        ...(reservation.sourceMode === 'upload' && documentAssets
          ? {
              approvedStoragePath: documentAssets.sourcePath,
              approvedStoragePaths: approvedPaths,
              approvedStorageObjects,
              sourceFormat: documentAssets.sourceFormat,
              previewStatus: documentAssets.previewStatus,
              ...(documentAssets.previewStoragePath
                ? { previewStoragePath: documentAssets.previewStoragePath }
                : {}),
            }
          : reservation.sourceMode === 'google_drive_link'
            ? { sourceLink: verifiedSourceLink }
            : {}),
        rights: {
          source: reservation.data.source,
          owner: reservation.data.owner,
          attribution: reservation.data.attribution,
          redistribution: reservation.data.redistribution,
          consentBasis: reservation.data.consentBasis,
          sensitiveDataReviewed: reservation.data.sensitiveDataReviewed,
          retention: reservation.data.retention,
          reviewDueAt: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1_000),
        },
        createdAt: existingMaterial.exists
          ? existingMaterial.get('createdAt') ?? FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      if (activity && activityRef) {
        transaction.set(activityRef, {
          ...activity,
          ownerUid: FieldValue.delete(),
          createdAt: existingActivity?.exists
            ? existingActivity.get('createdAt') ?? FieldValue.serverTimestamp()
            : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, activityPublicationSetOptions)
      }
      transaction.update(ref, {
        status: 'published',
        materialId: materialRef.id,
        approvedAt: FieldValue.serverTimestamp(),
        approvalAttemptId: FieldValue.delete(),
        approvalLeaseExpiresAt: FieldValue.delete(),
        approvalFailure: FieldValue.delete(),
        approvalSourceFingerprint: FieldValue.delete(),
        approvalSourceVerificationId: FieldValue.delete(),
        ...(staleCleanupObjects.length
          ? {
                cleanupState: 'pending',
                cleanupObjects: staleCleanupObjects,
                cleanupRequestId: attemptId,
                cleanupQueuedAt: FieldValue.serverTimestamp(),
              }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.set(firestore.collection('auditEvents').doc(), {
        type: 'submission.published',
        submissionId,
        materialId: materialRef.id,
        ...(actor ? { uid: actor.uid } : { automatedBy: 'event-driven-file-scanner' }),
        at: FieldValue.serverTimestamp(),
      })
      if (operatorException.exists) {
        transaction.update(exceptionRef, {
          status: 'resolved',
          resolvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      if (staleCleanupObjects.length) {
        transaction.set(firestore.collection('storageCleanupJobs').doc(submissionId), {
          submissionId,
          cleanupRequestId: attemptId,
          planVersion: 0,
          rawObjects: staleCleanupObjects,
          attemptCount: 0,
          status: 'queued',
          nextAttemptAt: FieldValue.serverTimestamp(),
          queuedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      return staleCleanupObjects.length > 0
    })
    if (publicationCleanupQueued) await attemptSubmissionStorageCleanup(submissionId)
    return { status: 'published', materialId: materialRef.id }
  } catch (error) {
    try {
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(ref)
        if (current.get('status') !== 'publishing' || current.get('approvalAttemptId') !== attemptId) return
        transaction.update(ref, {
          status: 'publishing_failed',
          approvalAttemptId: FieldValue.delete(),
          approvalLeaseExpiresAt: FieldValue.delete(),
          approvalFailure: { code: 'copy_or_finalize_failed', at: FieldValue.serverTimestamp() },
          approvalSourceFingerprint: FieldValue.delete(),
          approvalSourceVerificationId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        transaction.set(firestore.collection('auditEvents').doc(), {
          type: 'submission.publish_failed',
          submissionId,
          ...(actor ? { uid: actor.uid } : { automatedBy: 'event-driven-file-scanner' }),
          at: FieldValue.serverTimestamp(),
        })
        transaction.set(firestore.collection('submissionOperatorExceptions').doc(submissionId), {
          submissionId,
          type: actor ? 'manual_publication_failed' : 'automatic_publication_failed',
          status: 'open',
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })
    } catch (failureStateError) {
      console.error('Submission failure state could not be persisted', { submissionId, failureStateError })
    }
    if (error instanceof HttpsError) throw error
    console.error('Submission publication failed', { submissionId, error })
    throw new HttpsError('unavailable', '파일을 공개하지 못했어요 잠시 뒤 자동으로 다시 시도합니다')
  }
}

async function publishCleanUploadAttachments(submissionId: string) {
  const firestore = getFirestore()
  const submissionRef = firestore.collection('submissions').doc(submissionId)
  const materialRef = firestore.collection('materials').doc(submissionId)
  const activityRef = firestore.collection('activities').doc(submissionId)
  const attemptId = randomUUID()
  const nowMs = Date.now()
  const reservation = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(submissionRef)
    if (!snapshot.exists) throw new HttpsError('not-found', '제출 기록을 찾지 못했어요')
    const data = snapshot.data() as ApprovalState & Record<string, unknown>
    if (data.attachmentLifecycleVersion !== 1 || data.sourceMode !== 'upload') {
      throw new HttpsError('failed-precondition', '독립 첨부 공개 대상이 아니에요')
    }
    if (operatorModerationBlocksPublication(data.operatorModeration)) {
      throw new HttpsError('failed-precondition', '운영자가 공개를 중단한 자료예요')
    }
    const decision = attachmentPublicationReservationDecision({
      status: data.status,
      attachmentStatus: data.attachmentStatus,
      scanStatus: data.scanStatus,
      attachmentRevision: data.attachmentRevision,
      attemptId: data.attachmentPublicationAttemptId,
      leaseExpiresAtMs: data.attachmentPublicationLeaseExpiresAt instanceof Timestamp
        ? data.attachmentPublicationLeaseExpiresAt.toMillis()
        : 0,
      nowMs,
    })
    if (decision === 'complete') return { kind: 'complete' as const }
    if (decision === 'busy') throw new HttpsError('aborted', '다른 첨부 공개 작업이 진행 중이에요')
    if (decision === 'invalid') throw new HttpsError('failed-precondition', '첨부를 공개할 수 있는 상태가 아니에요')
    if (data.scanRecordedBy === 'event-driven-file-scanner') {
      assertAutomatedScanPublicationReady(FILE_SCANNER_ENDPOINT.value(), data.scanRecordedBy)
    } else if (data.scanRecordedBy !== 'manual-scan-attestor') {
      throw new HttpsError('failed-precondition', '신뢰할 수 있는 첨부 검사 결과를 찾지 못했어요')
    }
    const attestation = parseScanAttestation(data.scanAttestation, nowMs)
    if (attestation.verdict !== 'clean') throw new HttpsError('failed-precondition', '안전한 첨부만 공개할 수 있어요')
    const revision = typeof data.attachmentRevision === 'string' ? data.attachmentRevision : ''
    const expected = Array.isArray(data.attachmentExpectedObjects) ? data.attachmentExpectedObjects : []
    if (!revision || expected.length !== attestation.objects.length || expected.some((item, index) => {
      if (!item || typeof item !== 'object') return true
      const object = item as Record<string, unknown>
      const actual = attestation.objects[index]
      return object.path !== actual?.path
        || object.generation !== actual.generation
        || object.size !== actual.size
        || (typeof object.contentHash === 'string' && object.contentHash !== actual.contentHash)
    })) throw new HttpsError('aborted', '제출한 첨부 버전과 검사 결과가 달라요')
    const manifest = buildApprovalCopyManifest(submissionId, attestation, data.copyManifest)
    const staleManagedPaths = staleApprovalManagedPaths(data.copyManifest, manifest)
    transaction.update(submissionRef, {
      attachmentPublicationAttemptId: attemptId,
      attachmentPublicationLeaseExpiresAt: Timestamp.fromMillis(nowMs + APPROVAL_LEASE_MS),
      copyManifest: manifest,
      ...(staleManagedPaths.length ? { staleManagedPaths: FieldValue.arrayUnion(...staleManagedPaths) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { kind: 'reserved' as const, data, revision, attestation, manifest }
  })
  if (reservation.kind === 'complete') return { status: 'published' as const, materialId: submissionId, attachmentStatus: 'clean' as const }

  try {
    const quarantinedObjects = await getQuarantinedObjects(
      `quarantined/${reservation.data.ownerUid}/${submissionId}/`,
      selectedUploadNames((reservation.data as Record<string, unknown>).uploadSelection),
    )
    assertAttestationMatchesObjects(reservation.attestation, quarantinedObjects)
    let manifest = reservation.manifest
    for (const entry of manifest) {
      const destinationGeneration = await copyApprovalObject(entry)
      const copiedAtMs = Date.now()
      manifest = markApprovalCopyComplete(manifest, entry.destinationPath, copiedAtMs, destinationGeneration)
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(submissionRef)
        if (!attachmentPublicationMatchesReservation({
          status: current.get('status'),
          attachmentRevision: current.get('attachmentRevision'),
          attemptId: current.get('attachmentPublicationAttemptId'),
          expectedRevision: reservation.revision,
          expectedAttemptId: attemptId,
        }) || operatorModerationBlocksPublication(current.get('operatorModeration'))) {
          throw new HttpsError('aborted', '첨부 공개 작업의 소유권이 바뀌었어요')
        }
        transaction.update(submissionRef, {
          copyManifest: manifest,
          attachmentPublicationLeaseExpiresAt: Timestamp.fromMillis(copiedAtMs + APPROVAL_LEASE_MS),
          updatedAt: FieldValue.serverTimestamp(),
        })
      })
    }

    const cleanupQueued = await firestore.runTransaction(async (transaction) => {
      const [current, material, activity] = await Promise.all([
        transaction.get(submissionRef),
        transaction.get(materialRef),
        transaction.get(activityRef),
      ])
      if (!attachmentPublicationMatchesReservation({
        status: current.get('status'),
        attachmentRevision: current.get('attachmentRevision'),
        attemptId: current.get('attachmentPublicationAttemptId'),
        expectedRevision: reservation.revision,
        expectedAttemptId: attemptId,
      }) || operatorModerationBlocksPublication(current.get('operatorModeration'))) {
        throw new HttpsError('aborted', '첨부 공개를 마칠 수 없는 상태예요')
      }
      if (!material.exists || material.get('status') !== 'published') throw new HttpsError('aborted', '공개 본문을 찾지 못했어요')
      const currentAttestation = current.get('scanAttestation') as ScanAttestation | undefined
      const currentManifest = current.get('copyManifest') as ApprovalCopyManifestEntry[] | undefined
      if (current.get('scanStatus') !== 'clean'
        || currentAttestation?.scanId !== reservation.attestation.scanId
        || !currentManifest?.length
        || currentManifest.some((entry) => entry.state !== 'copied' || !entry.destinationGeneration)) {
        throw new HttpsError('aborted', '첨부 검사 또는 복사 상태가 바뀌었어요')
      }
      const approvedPaths = currentManifest.map((entry) => entry.destinationPath)
      const approvedStorageObjects = currentManifest.map((entry) => ({
        path: entry.destinationPath,
        generation: entry.destinationGeneration,
      }))
      const documentAssets = classifyPublishedDocumentAssets(approvedPaths)
      const timestamp = FieldValue.serverTimestamp()
      transaction.update(materialRef, {
        attachmentStatus: 'clean',
        approvedStoragePath: documentAssets.sourcePath,
        approvedStoragePaths: approvedPaths,
        approvedStorageObjects,
        sourceFormat: documentAssets.sourceFormat,
        previewStatus: documentAssets.previewStatus,
        ...(documentAssets.previewStoragePath
          ? { previewStoragePath: documentAssets.previewStoragePath }
          : { previewStoragePath: FieldValue.delete() }),
        updatedAt: timestamp,
      })
      if (activity.exists) transaction.update(activityRef, { attachmentStatus: 'clean', updatedAt: timestamp })
      const staleCleanupObjects = storageCleanupObjects({ staleManagedPaths: current.get('staleManagedPaths') })
      transaction.update(submissionRef, {
        attachmentStatus: 'clean',
        previewStatus: documentAssets.previewStatus,
        attachmentPublicationAttemptId: FieldValue.delete(),
        attachmentPublicationLeaseExpiresAt: FieldValue.delete(),
        attachmentPublicationFailure: FieldValue.delete(),
        ...(staleCleanupObjects.length ? {
          cleanupState: 'pending', cleanupObjects: staleCleanupObjects, cleanupRequestId: attemptId, cleanupQueuedAt: timestamp,
        } : {}),
        updatedAt: timestamp,
      })
      transaction.create(firestore.collection('auditEvents').doc(), {
        type: 'submission.attachments_published', submissionId, attachmentRevision: reservation.revision, at: timestamp,
      })
      if (staleCleanupObjects.length) {
        transaction.set(firestore.collection('storageCleanupJobs').doc(submissionId), {
          submissionId, cleanupRequestId: attemptId, planVersion: 0, rawObjects: staleCleanupObjects,
          attemptCount: 0, status: 'queued', nextAttemptAt: timestamp, queuedAt: timestamp, updatedAt: timestamp,
        })
      }
      return staleCleanupObjects.length > 0
    })
    if (cleanupQueued) await attemptSubmissionStorageCleanup(submissionId)
    return { status: 'published' as const, materialId: submissionId, attachmentStatus: 'clean' as const }
  } catch (error) {
    await firestore.runTransaction(async (transaction) => {
      const [current, material, activity] = await Promise.all([
        transaction.get(submissionRef), transaction.get(materialRef), transaction.get(activityRef),
      ])
      if (!attachmentPublicationMatchesReservation({
        status: current.get('status'), attachmentRevision: current.get('attachmentRevision'),
        attemptId: current.get('attachmentPublicationAttemptId'), expectedRevision: reservation.revision, expectedAttemptId: attemptId,
      })) return
      const timestamp = FieldValue.serverTimestamp()
      transaction.update(submissionRef, {
        attachmentStatus: 'error', attachmentPublicationAttemptId: FieldValue.delete(),
        attachmentPublicationLeaseExpiresAt: FieldValue.delete(),
        attachmentPublicationFailure: { code: 'copy_or_finalize_failed', at: timestamp }, updatedAt: timestamp,
      })
      if (material.exists && material.get('status') === 'published') transaction.update(materialRef, { attachmentStatus: 'error', updatedAt: timestamp })
      if (activity.exists && activity.get('status') === 'published') transaction.update(activityRef, { attachmentStatus: 'error', updatedAt: timestamp })
      transaction.set(firestore.collection('submissionOperatorExceptions').doc(submissionId), {
        submissionId, type: 'attachment_publication_failed', status: 'open', updatedAt: timestamp, createdAt: timestamp,
      }, { merge: true })
      transaction.create(firestore.collection('auditEvents').doc(), {
        type: 'submission.attachment_publish_failed', submissionId, attachmentRevision: reservation.revision, at: timestamp,
      })
    })
    throw error
  }
}

export async function publishCleanUploadSubmission(submissionId: string) {
  const firestore = getFirestore()
  const reference = firestore.collection('submissions').doc(submissionId)
  const snapshot = await reference.get()
  if (snapshot.get('attachmentLifecycleVersion') === 1) return publishCleanUploadAttachments(submissionId)
  if (privateCleanUploadDecision(snapshot.data() ?? {}) === 'ready') {
    await firestore.runTransaction(async (transaction) => {
      const exceptionRef = firestore.collection('submissionOperatorExceptions').doc(submissionId)
      const [current, exception] = await Promise.all([transaction.get(reference), transaction.get(exceptionRef)])
      if (privateCleanUploadDecision(current.data() ?? {}) !== 'ready') return
      const timestamp = FieldValue.serverTimestamp()
      const repairSubmission = current.get('status') !== 'review_queued' || current.get('attachmentStatus') !== 'clean'
      const repairException = exception.exists
        && exception.get('status') === 'open'
        && exception.get('type') === 'automatic_publication_exception'
        && exception.get('reason') === 'visibility_hold'
      if (!repairSubmission && !repairException) return
      if (repairSubmission) {
        transaction.update(reference, {
          status: 'review_queued',
          attachmentStatus: 'clean',
          updatedAt: timestamp,
        })
      }
      if (repairException) {
        transaction.update(exceptionRef, {
          status: 'resolved', resolution: 'private_clean_ready', resolvedAt: timestamp, updatedAt: timestamp,
        })
      }
      transaction.create(firestore.collection('auditEvents').doc(), {
        type: 'submission.private_attachment_ready', submissionId, at: timestamp,
      })
    })
    return { status: 'review_queued' as const, attachmentStatus: 'clean' as const }
  }
  if (automaticUploadPublicationDecision(snapshot.data() ?? {}) !== 'auto_publish') {
    if (snapshot.exists && snapshot.get('scanStatus') === 'clean' && snapshot.get('status') === 'review_queued') {
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(reference)
        if (automaticUploadPublicationDecision(current.data() ?? {}) === 'auto_publish') return
        transaction.update(reference, {
          status: 'exception_queued',
          updatedAt: FieldValue.serverTimestamp(),
        })
        transaction.set(firestore.collection('submissionOperatorExceptions').doc(submissionId), {
          submissionId,
          type: 'automatic_publication_exception',
          status: 'open',
          reason: current.get('visibility') === '보류' ? 'visibility_hold' : 'publication_invariant',
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })
    }
    return { status: 'exception_queued' as const }
  }
  return publishSubmissionCore(submissionId, null)
}

export const approveSubmission = onCall({ region: 'asia-northeast3', timeoutSeconds: 120 }, async (request) => {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator', 'moderator'] })
  const submissionId = typeof request.data?.submissionId === 'string' ? request.data.submissionId.trim() : ''
  if (!submissionId) throw new HttpsError('invalid-argument', '제출 대상을 찾지 못했어요')
  return publishSubmissionCore(submissionId, {
    uid: actor.uid,
    ...(actor.roleException ? { role: actor.roleException } : {}),
  })
})
