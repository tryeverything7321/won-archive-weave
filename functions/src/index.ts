import { onCall } from 'firebase-functions/v2/https'
export {
  cleanupExpiredOAuthArtifacts,
  createOrRotatePseudonym,
  exchangeOAuthCompletion,
  issueOAuthStartTicket,
  oauthGateway,
} from './auth/oauth.js'
export { acceptMemberTerms, disconnectPlatformAccount } from './auth/account-functions.js'
export { getOnboardingState, recordOnboardingOutcome } from './auth/onboarding.js'
export { getMyMemberProfile, updateMyMemberProfile } from './profile/member-profile.js'
export {
  approveSubmission,
  moderateSubmissionContent,
  createSubmission,
  getMySubmissionDraft,
  getMySubmissionManagement,
  listSubmissionOperatorExceptions,
  listMySubmissions,
  migrateSubmissionSortCreatedAt,
  repairCreatedSubmissionSortTimestamp,
  recordSubmissionScanResult,
  requestSubmissionChange,
  resolveSubmissionOperatorException,
  reviewSubmission,
  submitSubmission,
  updateSubmissionDraft,
  verifySubmissionSourceLink,
  withdrawSubmission,
} from './uploads/submissions.js'
export { createApprovedDownload, createApprovedPreview, createOwnerSubmissionAttachmentAccess } from './uploads/downloads.js'
export { cleanMaterialPreviewCache } from './uploads/document-preview-cleanup.js'
export { prepareSubmissionUploads, reconcileSubmissionUpload, cleanupExpiredUploadReservations } from './uploads/upload-selection.js'
export {
  aggregateSubmittedEventScan,
  aggregateSubmittedUploadScan,
  scanQuarantinedUpload,
} from './uploads/scanner-worker.js'
export { processPendingSubmissionCleanups } from './uploads/storage-cleanup.js'
export {
  appealCommunityModeration,
  blockCommunityAuthor,
  createCommunityComment,
  createCommunityPost,
  deleteCommunityComment,
  deleteCommunityPost,
  editCommunityComment,
  editCommunityPost,
  getCommunityOwnership,
  listCommunityPostsForAdmin,
  listMyCommunityCases,
  moderateCommunityComment,
  moderateCommunityContent,
  moderateCommunityPost,
  reportCommunityContent,
  resolveCommunityCase,
  unblockCommunityAuthor,
} from './community/posts.js'
export {
  getCalendarImportChange,
  applyCalendarImportChange,
  disconnectCalendarSource,
  reviewCalendarImportCandidate,
  reviewCalendarSource,
  submitSelectedGoogleCalendarEvents,
  submitCalendarSource,
  syncCalendarSourcePreview,
  syncGooglePublicCalendarSource,
} from './calendar/external-calendar-functions.js'
export {
  cancelOwnedEvent,
  createManualEvent,
  listOwnedEvents,
  recordEventMediaScanResult,
  restoreOwnedEvent,
  reviewManualEvent,
  moderateManualEventContent,
  setEventOrganizerTrust,
  unpublishOwnedEvent,
  updateManualEvent,
} from './calendar/event-management.js'
import { platformStatus } from './platform.js'

export const getPlatformStatus = onCall(
  { region: 'asia-northeast3', enforceAppCheck: false },
  () => platformStatus(),
)
export { setActivityMaterialLinks, getActivityMaterialLinks, getMaterialLinkImpact } from './uploads/material-links.js'

export { getOperationsOverview, listOperationsQueue } from './operations/overview.js'
export { listOperatorAuditEvents } from './operations/audit.js'
export { listAdminMembers, getAdminMemberOverview, listAdminMemberActivity, getAdminMemberPrivateDetails } from './operations/members.js'
