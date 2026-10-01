export const submissionVisibilities = ['public', 'member_only', 'hold'] as const
export const submissionStatuses = ['draft', 'review_queued', 'revision_requested', 'held', 'approved', 'published', 'withdrawn'] as const
export type SubmissionVisibility = typeof submissionVisibilities[number]
export type SubmissionStatus = typeof submissionStatuses[number]

export type RightsRecord = {
  source: string
  owner: string
  attribution: string
  redistribution: 'download_allowed' | 'view_only' | 'source_link_only'
  consentBasis: string
  sensitiveDataReviewed: boolean
  retention: 'managed' | 'source_link' | 'takedown_pending'
  reviewDueAtMs: number
}

export type UploadDescriptor = {
  name: string
  size: number
  contentType: string
}

export class SubmissionPolicyError extends Error {
  constructor(public readonly code: 'invalid_rights' | 'invalid_file' | 'invalid_transition' | 'scan_required' | 'download_denied') {
    super(code)
  }
}

const allowedMime = new Set([
  'application/pdf',
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/hwp+zip',
  'application/vnd.hancom.hwpx',
  'application/haansofthwpx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/jpeg',
  'image/png',
  'image/webp',
])

const canonicalMimeByExtension: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}

const hangulMimeByExtension = {
  hwp: new Set<string>([
    'application/x-hwp',
    'application/haansofthwp',
    'application/vnd.hancom.hwp',
    'application/octet-stream',
  ]),
  hwpx: new Set<string>([
    'application/hwp+zip',
    'application/vnd.hancom.hwpx',
    'application/haansofthwpx',
    'application/zip',
    'application/octet-stream',
  ]),
} as const

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function validateRightsRecord(value: RightsRecord, nowMs: number): RightsRecord {
  if (
    value.source.trim().length < 2
    || value.owner.trim().length < 2
    || value.attribution.trim().length < 2
    || value.consentBasis.trim().length < 2
    || value.sensitiveDataReviewed !== true
    || value.reviewDueAtMs <= nowMs
  ) throw new SubmissionPolicyError('invalid_rights')
  return { ...value, source: value.source.trim(), owner: value.owner.trim(), attribution: value.attribution.trim(), consentBasis: value.consentBasis.trim() }
}

export function sanitizeUploadName(name: string): string {
  const leaf = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const safe = leaf.normalize('NFKC').replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/_+/g, '_')
  if (!safe || safe === '.' || safe === '..' || safe.length > 160) throw new SubmissionPolicyError('invalid_file')
  return safe
}

export function validateUploadDescriptor(file: UploadDescriptor, maxBytes = 20 * 1024 * 1024): UploadDescriptor & { safeName: string } {
  const extension = extensionOf(file.name)
  const hasValidHangulPair = (
    (extension === 'hwp' && hangulMimeByExtension.hwp.has(file.contentType))
    || (extension === 'hwpx' && hangulMimeByExtension.hwpx.has(file.contentType))
  )
  const hasMismatchedHangulExtension = (
    (extension === 'hwp' || extension === 'hwpx')
    && !hasValidHangulPair
  )
  // Browser MIME fallback happens before upload. The server validates the
  // resulting pair, never trusts an arbitrary extension or MIME on its own.
  const hasValidNativePair = Object.prototype.hasOwnProperty.call(canonicalMimeByExtension, extension)
    && canonicalMimeByExtension[extension] === file.contentType
  if (
    !Number.isSafeInteger(file.size)
    || file.size <= 0
    || file.size > maxBytes
    || hasMismatchedHangulExtension
    || (!hasValidHangulPair && (!allowedMime.has(file.contentType) || !hasValidNativePair))
  ) {
    throw new SubmissionPolicyError('invalid_file')
  }
  return { ...file, safeName: sanitizeUploadName(file.name) }
}

export function transitionSubmission(current: SubmissionStatus, action: 'submit' | 'request_revision' | 'hold' | 'approve' | 'publish' | 'withdraw', scanStatus: 'pending' | 'clean' | 'blocked'): SubmissionStatus {
  const transitions: Record<typeof action, SubmissionStatus> = {
    submit: 'review_queued', request_revision: 'revision_requested', hold: 'held', approve: 'approved', publish: 'published', withdraw: 'withdrawn',
  }
  const allowed = (
    (action === 'submit' && (current === 'draft' || current === 'revision_requested'))
    || ((action === 'request_revision' || action === 'hold') && current === 'review_queued')
    || (action === 'approve' && current === 'review_queued')
    || (action === 'publish' && current === 'approved')
    || (action === 'withdraw' && current !== 'withdrawn')
  )
  if (!allowed) throw new SubmissionPolicyError('invalid_transition')
  if ((action === 'approve' || action === 'publish') && scanStatus !== 'clean') throw new SubmissionPolicyError('scan_required')
  return transitions[action]
}

export function canDownload(input: {
  status: SubmissionStatus
  visibility: SubmissionVisibility
  signedIn: boolean
  redistribution: RightsRecord['redistribution']
}): boolean {
  if (input.status !== 'published' || input.redistribution !== 'download_allowed') return false
  if (input.visibility === 'hold') return false
  return input.visibility === 'public' || input.signedIn
}

export function canPreview(input: {
  status: SubmissionStatus
  visibility: SubmissionVisibility
  signedIn: boolean
}): boolean {
  if (input.status !== 'published' || input.visibility === 'hold') return false
  return input.visibility === 'public' || input.signedIn
}
