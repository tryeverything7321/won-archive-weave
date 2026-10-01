import { httpsCallable } from 'firebase/functions'
import { getFirebaseServices } from '../../lib/firebase/client'
import { parseEditableSubmissionDraft, parseOwnedSubmissions, type SubmissionOwnerAction, type SubmissionStatus } from './submission-model'

function services() {
  const value = getFirebaseServices()
  if (!value) throw new Error('Firebase is not configured')
  return value
}

export async function withdrawSubmission(submissionId: string) {
  const firebase = services()
  const callable = httpsCallable<{ submissionId: string }, { status: 'withdrawn' }>(firebase.functions, 'withdrawSubmission')
  return (await callable({ submissionId })).data
}

export type OwnedSubmissionPage = {
  submissions: ReturnType<typeof parseOwnedSubmissions>
  limit: number
  hasMore: boolean
  nextCursor: string | null
  migrationRequired: boolean
}

export async function listMySubmissions(cursor: string | null = null): Promise<OwnedSubmissionPage> {
  const firebase = services()
  const callable = httpsCallable<
    { cursor?: string; pageSize: number },
    {
      submissions: unknown[]
      limit: number
      hasMore?: boolean
      nextCursor?: string | null
      migrationRequired?: boolean
    }
  >(firebase.functions, 'listMySubmissions')
  const result = await callable({
    pageSize: 100,
    ...(cursor ? { cursor } : {}),
  })
  const nextCursor = typeof result.data.nextCursor === 'string' && result.data.nextCursor
    ? result.data.nextCursor
    : null
  return {
    submissions: parseOwnedSubmissions(result.data.submissions),
    limit: typeof result.data.limit === 'number' ? result.data.limit : 100,
    hasMore: result.data.hasMore === true && nextCursor !== null,
    nextCursor,
    migrationRequired: result.data.migrationRequired === true,
  }
}

export async function updateSubmissionDraft(submissionId: string, submission: Record<string, unknown>) {
  const firebase = services()
  const callable = httpsCallable<
    { submissionId: string; submission: Record<string, unknown> },
    { status: 'draft' | 'revision_requested' }
  >(firebase.functions, 'updateSubmissionDraft')
  return (await callable({ submissionId, submission })).data
}

export async function getMySubmissionDraft(submissionId: string) {
  const firebase = services()
  const callable = httpsCallable<{ submissionId: string }, { submission: unknown }>(firebase.functions, 'getMySubmissionDraft')
  const result = await callable({ submissionId })
  return parseEditableSubmissionDraft(result.data.submission)
}

export type SubmissionManagement = {
  id: string
  status: SubmissionStatus
  availableActions: SubmissionOwnerAction[]
}

export async function getMySubmissionManagement(submissionIds: string[]): Promise<SubmissionManagement[]> {
  const firebase = services()
  const callable = httpsCallable<{ submissionIds: string[] }, { submissions: SubmissionManagement[] }>(
    firebase.functions, 'getMySubmissionManagement',
  )
  const result = await callable({ submissionIds })
  if (!Array.isArray(result.data.submissions)) throw new Error('Invalid management response')
  return result.data.submissions
}

export async function requestSubmissionChange(
  submissionId: string,
  action: Extract<SubmissionOwnerAction, 'request_revision' | 'unpublish' | 'restore_private'>,
) {
  const firebase = services()
  const callable = httpsCallable<
    { submissionId: string; action: 'request_revision' | 'unpublish' | 'restore_private' },
    {
      status: 'change_pending' | 'unpublished' | 'draft'
      changeRequestId: string
      cleanupState?: 'pending' | 'failed' | 'dead_letter' | 'completed'
    }
  >(firebase.functions, 'requestSubmissionChange')
  return (await callable({ submissionId, action })).data
}

export async function createApprovedDownload(materialId: string) {
  const firebase = services()
  const callable = httpsCallable<{ materialId: string }, { url: string; expiresAtMs: number }>(firebase.functions, 'createApprovedDownload')
  return (await callable({ materialId })).data
}

export async function createApprovedPreview(materialId: string) {
  const firebase = services()
  const callable = httpsCallable<{ materialId: string }, { url: string; expiresAtMs: number }>(firebase.functions, 'createApprovedPreview', { timeout: 120_000 })
  return (await callable({ materialId })).data
}

export type OwnerSubmissionAttachmentAccess =
  | { url: string; expiresAtMs: number; renderFormat: 'download'; fileName: string }
  | { url: string; expiresAtMs: number; renderFormat: 'pdf' | 'image' | 'text' | 'csv'; text?: string; truncated?: boolean }

export async function createOwnerSubmissionAttachmentAccess(
  submissionId: string,
  action: 'preview' | 'download',
): Promise<OwnerSubmissionAttachmentAccess> {
  const firebase = services()
  const callable = httpsCallable<
    { submissionId: string; action: 'preview' | 'download' },
    OwnerSubmissionAttachmentAccess
  >(firebase.functions, 'createOwnerSubmissionAttachmentAccess', { timeout: 120_000 })
  return (await callable({ submissionId, action })).data
}
