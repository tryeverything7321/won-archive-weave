import { httpsCallable } from 'firebase/functions'
import { getFirebaseServices } from '../../lib/firebase/client'
import {
  parseCommunityOwnershipResponse,
  type CommunityOwnershipRequest,
} from './comment-policy-recovery'
import { communityWriteRequest, completeCommunityWriteRequest } from './community-write-request'

export const communityPostPurposes = [
  '생각 나눔',
  '질문',
  '경험과 노하우',
  '도움 요청',
  '함께할 사람 찾기',
] as const

export type CommunityPostPurpose = (typeof communityPostPurposes)[number]

export type CommunityAdminPost = {
  id: string
  body: string
  topic: string | null
  purpose: CommunityPostPurpose
  pseudonym: string
  provider: 'kakao' | 'naver' | null
  status: 'active' | 'held' | 'removed' | 'deleted'
  commentCount: number
  createdAtMs: number
  updatedAtMs: number
  moderationReason: string
}

export type CommunityAdminCase = {
  id: string
  caseType: 'report' | 'appeal'
  status: string
  targetType: 'post' | 'comment'
  targetId: string
  postId: string | null
  category: string
  details: string
  createdAtMs: number
  resolution: string
}

export type MyCommunityCases = {
  moderationNotices?: Array<{
    noticeId: string
    targetType: 'post' | 'comment'
    postId: string
    commentId: string | null
    action: 'warn' | 'request_correction' | 'hold' | 'remove' | 'restore'
    reason: string
    contentStatus: string
    body: string
    createdAtMs: number
  }>
  moderatedPosts: Array<{
    postId: string
    status: 'held' | 'removed'
    body: string
    reason: string
    appealed: boolean
  }>
  reports: Array<{
    reportId: string
    targetType: 'post' | 'comment'
    status: string
    category: string
    resolution: string
  }>
  appeals: Array<{
    appealId: string
    postId: string
    status: 'received' | 'accepted' | 'rejected'
    resolution: string
    createdAtMs: number
    resolvedAtMs: number
  }>
  blockedAuthors: Array<{
    blockId: string
    pseudonym: string
    provider: 'kakao' | 'naver' | null
  }>
}

export function parseCommunityPostPurpose(value: unknown): CommunityPostPurpose {
  return communityPostPurposes.includes(value as CommunityPostPurpose)
    ? value as CommunityPostPurpose
    : '생각 나눔'
}

function call<Input, Output>(name: string, input: Input): Promise<Output> {
  const services = getFirebaseServices()
  if (!services) return Promise.reject(new Error('Firebase is not configured'))
  return httpsCallable<Input, Output>(services.functions, name)(input).then(({ data }) => data)
}

export const communityApi = {
  createPost: async (input: { topic?: string | null; purpose: CommunityPostPurpose; body: string }) => {
    const pending = communityWriteRequest('post', input)
    const result = await call<typeof input & { requestId: string }, { postId: string }>('createCommunityPost', { ...input, requestId: pending.requestId })
    completeCommunityWriteRequest(pending.storageKey)
    return result
  },
  editPost: (input: { postId: string; body: string; topic?: string | null; purpose: CommunityPostPurpose }) => call<typeof input, { status: 'active' }>('editCommunityPost', input),
  deletePost: (input: { postId: string }) => call<typeof input, { status: 'deleted' }>('deleteCommunityPost', input),
  createComment: async (input: { postId: string; body: string }) => {
    const pending = communityWriteRequest('comment', input)
    const result = await call<typeof input & { requestId: string }, { commentId: string }>('createCommunityComment', { ...input, requestId: pending.requestId })
    completeCommunityWriteRequest(pending.storageKey)
    return result
  },
  editComment: (input: { postId: string; commentId: string; body: string }) => call<typeof input, { status: 'active' }>('editCommunityComment', input),
  deleteComment: (input: { postId: string; commentId: string }) => call<typeof input, { status: 'deleted' }>('deleteCommunityComment', input),
  ownership: (input: CommunityOwnershipRequest) =>
    call<CommunityOwnershipRequest, unknown>('getCommunityOwnership', input)
      .then((result) => parseCommunityOwnershipResponse(result, input)),
  blockAuthor: (input: { targetType: 'post' | 'comment'; targetId: string; postId?: string }) =>
    call<typeof input, { blockId: string }>('blockCommunityAuthor', input),
  unblockAuthor: (input: { blockId: string }) =>
    call<typeof input, { status: 'unblocked' }>('unblockCommunityAuthor', input),
  moderatePost: (input: { postId: string; action: 'warn' | 'request_correction' | 'hold' | 'remove' | 'restore'; reason: string; requestId?: string }) =>
    call<typeof input, { status: 'active' | 'held' | 'removed' }>('moderateCommunityContent', { ...input, requestId: input.requestId ?? crypto.randomUUID() }),
  moderateComment: (input: { postId: string; commentId: string; action: 'warn' | 'request_correction' | 'hold' | 'remove'; reason: string; requestId: string }) =>
    call<typeof input, { status: 'active' | 'held' | 'removed' }>('moderateCommunityComment', input),
  listAdminPosts: (input: {
    queue?: 'content' | 'reports' | 'appeals'
    status?: string | null
    cursorId?: string | null
  } = {}) =>
    call<typeof input, {
      queue: 'content' | 'reports' | 'appeals'
      posts: CommunityAdminPost[]
      cases: CommunityAdminCase[]
      hasMore: boolean
      nextCursorId: string | null
    }>('listCommunityPostsForAdmin', input),
  listMyCases: () => call<Record<string, never>, MyCommunityCases>('listMyCommunityCases', {}),
  resolveCase: async (input: {
    caseType: 'report' | 'appeal'
    caseId: string
    action: 'dismiss' | 'hold' | 'remove' | 'accept' | 'reject'
    resolution: string
  }) => {
    const pending = communityWriteRequest('case', input)
    const result = await call<typeof input & { requestId: string }, { status: string }>('resolveCommunityCase', { ...input, requestId: pending.requestId })
    completeCommunityWriteRequest(pending.storageKey)
    return result
  },
  report: (input: { targetType: 'post' | 'comment'; targetId: string; postId?: string; category: 'personal_data' | 'harassment' | 'crisis' | 'rights' | 'spam' | 'other'; details?: string }) => call<typeof input, { reportId: string; urgent: boolean }>('reportCommunityContent', input),
  appeal: (input: { postId: string; reason: string }) => call<typeof input, { appealId: string; status: 'received' }>('appealCommunityModeration', input),
}
