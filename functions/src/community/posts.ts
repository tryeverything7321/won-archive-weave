import { createHash } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, Timestamp, getFirestore, type DocumentReference } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  createAppeal,
  deleteContent,
  editContent,
  planCommunityModeration,
  CommunityPolicyError,
  type CommunityStatus,
  type ModeratedStatus,
  type CommunityModerationAction,
} from './policy.js'
import {
  publicCommentRecord,
  publicModerationPatch,
  publicPostRecord,
  type CommunityLoginProvider,
  type CommunityPostPurpose,
} from './public-records.js'
import { hasCurrentCommunityConsent } from '../auth/terms.js'
import { requireActorPolicy } from './actor-policy.js'
import {
  communityWriteFingerprint,
  communityWriteRequestKey,
  communityWriteThrottle,
  validateCommunityWriteRequestId,
} from './write-requests.js'

if (!getApps().length) initializeApp()

const reportCategories = ['personal_data', 'harassment', 'crisis', 'rights', 'spam', 'other'] as const
const allowedTopics = new Set(['나와 마음', '관계와 공동체', '일과 진로', '배움과 신앙', '사회와 실천'])
const allowedPurposes = new Set<CommunityPostPurpose>(['생각 나눔', '질문', '경험과 노하우', '도움 요청', '함께할 사람 찾기'])
const dailyReportLimit = 20
const dailyUrgentReportLimit = 3
const operatorQueuePageSize = 50
const maximumCommunityBlocks = 100
const minimumFirestoreTimestampSeconds = -62_135_596_800
const maximumFirestoreTimestampSeconds = 253_402_300_799

type ReportTarget = { targetType: 'post' | 'comment'; targetId: string; postId?: string }

const communityModerationActions = new Set<CommunityModerationAction>([
  'warn',
  'request_correction',
  'hold',
  'remove',
  'restore',
])

export function validateCommunityModerationRequest(value: unknown): {
  action: CommunityModerationAction
  reason: string
  requestId: string
} {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (typeof data.action !== 'string' || !communityModerationActions.has(data.action as CommunityModerationAction)) {
    throw new HttpsError('invalid-argument', '처리 상태를 확인해 주세요')
  }
  const reason = text(data.reason, '처리 사유', 300)
  const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : ''
  if (requestId.length < 8 || requestId.length > 120 || !/^[A-Za-z0-9_-]+$/.test(requestId)) {
    throw new HttpsError('invalid-argument', '요청 식별자를 확인해 주세요')
  }
  return { action: data.action as CommunityModerationAction, reason, requestId }
}

export function communityModerationCommandKey(moderatorUid: string, requestId: string): string {
  return createHash('sha256').update(`${moderatorUid}:${requestId}`).digest('hex').slice(0, 40)
}

export function canDirectlyDeleteCommunityContent(authorUid: string, actorUid: string): boolean {
  return authorUid === actorUid
}

export function validateCommunityTopic(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !allowedTopics.has(value.trim())) {
    throw new HttpsError('invalid-argument', '주제를 다시 선택해 주세요')
  }
  return value.trim()
}

export function validateCommunityPurpose(value: string): CommunityPostPurpose {
  if (!allowedPurposes.has(value as CommunityPostPurpose)) {
    throw new HttpsError('invalid-argument', '글의 성격을 다시 선택해 주세요')
  }
  return value as CommunityPostPurpose
}

export function validateCommunityPostEditInput(value: unknown): {
  body: string
  topic: string | null
  purpose: CommunityPostPurpose
} {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    body: text(data.body, '내용', 2000),
    topic: validateCommunityTopic(data.topic),
    purpose: validateCommunityPurpose(text(data.purpose, '글의 성격', 40)),
  }
}

export function communityReportKey(uid: string, target: ReportTarget): string {
  return createHash('sha256')
    .update(`${uid}:${target.targetType}:${target.postId ?? ''}:${target.targetId}`)
    .digest('hex')
    .slice(0, 40)
}

export function communityAppealKey(uid: string, postId: string): string {
  return createHash('sha256').update(`${uid}:${postId}`).digest('hex').slice(0, 40)
}

export function communityBlockKey(blockerUid: string, blockedUid: string): string {
  return createHash('sha256').update(`${blockerUid}:${blockedUid}`).digest('hex').slice(0, 40)
}

export function validateReportableCommunityStatus(value: unknown): void {
  if (value !== 'active') {
    throw new HttpsError('failed-precondition', '공개 중인 내용만 신고할 수 있어요')
  }
}

export function validateReportQuota(current: { total?: unknown; urgent?: unknown } | undefined, urgent: boolean) {
  const total = Number(current?.total ?? 0)
  const urgentCount = Number(current?.urgent ?? 0)
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(urgentCount) || total < 0 || urgentCount < 0) {
    throw new HttpsError('failed-precondition', '신고 처리 상태를 확인해 주세요')
  }
  if (total >= dailyReportLimit || (urgent && urgentCount >= dailyUrgentReportLimit)) {
    throw new HttpsError('resource-exhausted', '오늘 접수할 수 있는 신고 수를 넘었어요')
  }
  return { total: total + 1, urgent: urgentCount + (urgent ? 1 : 0) }
}

export function communityReportRecord(
  target: ReportTarget,
  category: typeof reportCategories[number],
  details: string,
  timestamp: unknown,
) {
  const urgent = category === 'personal_data' || category === 'crisis'
  return {
    ...target,
    category,
    details,
    status: urgent ? 'urgent_review' as const : 'received' as const,
    createdAt: timestamp,
  }
}

export function ownedCommunityRecordIds(
  uid: string,
  records: Array<{ id: string; ownerUid: unknown }>,
) {
  return records.filter((record) => record.ownerUid === uid).map((record) => record.id)
}

export function blockedCommunityRecordIds(
  blockedOwnerUids: Set<string>,
  records: Array<{ id: string; ownerUid: unknown }>,
) {
  return records
    .filter((record) => blockedOwnerUids.has(String(record.ownerUid ?? '')))
    .map((record) => record.id)
}

export function communityOwnershipResponse(input: {
  uid: string
  administrator: boolean
  postIds: string[]
  comments: Array<{ postId: string; commentId: string }>
  ownerUids: unknown[]
  hiddenOwnerUids: Set<string>
}) {
  const expectedOwners = input.postIds.length + input.comments.length
  if (
    input.ownerUids.length !== expectedOwners
    || input.ownerUids.some((ownerUid) => typeof ownerUid !== 'string' || !ownerUid)
  ) {
    throw new HttpsError('failed-precondition', '작성 기록의 소유자 정책을 확인하지 못했어요')
  }
  const records = input.ownerUids.map((ownerUid, index) => ({ id: String(index), ownerUid }))
  const owned = new Set(ownedCommunityRecordIds(input.uid, records))
  const hidden = new Set(blockedCommunityRecordIds(input.hiddenOwnerUids, records))
  return {
    postIds: input.administrator
      ? input.postIds
      : input.postIds.filter((_, index) => owned.has(String(index))),
    comments: input.administrator
      ? input.comments
      : input.comments.filter((_, index) => owned.has(String(input.postIds.length + index))),
    hiddenPostIds: input.postIds.filter((_, index) => hidden.has(String(index))),
    hiddenComments: input.comments.filter((_, index) => hidden.has(String(input.postIds.length + index))),
    canManageAll: input.administrator,
  }
}

export type CommunityOperatorQueue = 'content' | 'reports' | 'appeals'

export type CommunityQueueCursor = {
  seconds: number
  nanoseconds: number
  id: string
}

export function encodeCommunityQueueCursor(cursor: CommunityQueueCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeCommunityQueueCursor(value: unknown): CommunityQueueCursor | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 500) {
    throw new HttpsError('invalid-argument', '다음 대기 항목 위치를 확인하지 못했어요')
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (
      !Number.isSafeInteger(parsed.seconds)
      || Number(parsed.seconds) < minimumFirestoreTimestampSeconds
      || Number(parsed.seconds) > maximumFirestoreTimestampSeconds
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
    throw new HttpsError('invalid-argument', '다음 대기 항목 위치를 확인하지 못했어요')
  }
}

export function validateCommunityOperatorQueue(value: unknown): CommunityOperatorQueue {
  if (value === undefined || value === null || value === '' || value === 'content') return 'content'
  if (value === 'reports' || value === 'appeals') return value
  throw new HttpsError('invalid-argument', '운영 대기함을 다시 선택해 주세요')
}

export function validateCommunityQueueStatus(queue: CommunityOperatorQueue, value: unknown): string | null {
  if (value === undefined || value === null || value === '' || value === 'all') return null
  const allowed = queue === 'content'
    ? ['active', 'held', 'removed', 'deleted']
    : queue === 'reports'
      ? ['received', 'urgent_review', 'resolved', 'dismissed']
      : ['received', 'accepted', 'rejected']
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new HttpsError('invalid-argument', '운영 상태 필터를 다시 선택해 주세요')
  }
  return value
}

export function communityQueuePage<T>(
  documents: T[],
  cursorForItem: (item: T) => string | null = () => null,
) {
  const items = documents.slice(0, operatorQueuePageSize)
  const hasMore = documents.length > operatorQueuePageSize
  const nextCursorId = items.length ? cursorForItem(items[items.length - 1] as T) : null
  if (hasMore && !nextCursorId) {
    throw new HttpsError('failed-precondition', '운영 대기함의 다음 위치를 만들지 못했어요')
  }
  return {
    items,
    hasMore,
    nextCursorId,
  }
}

function communityTimestampMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('toMillis' in value) || typeof value.toMillis !== 'function') return null
  const result = value.toMillis()
  return Number.isFinite(result) ? Number(result) : null
}

export function communityAppealOwnerRecord(id: string, value: Record<string, unknown>) {
  const status = value.status === 'accepted' || value.status === 'rejected' ? value.status : 'received'
  const createdAtMs = communityTimestampMillis(value.createdAt)
  const resolvedAtMs = communityTimestampMillis(value.resolvedAt)
  return {
    appealId: id,
    postId: typeof value.postId === 'string' ? value.postId.slice(0, 120) : '',
    status,
    resolution: typeof value.resolution === 'string' ? value.resolution.slice(0, 500) : '',
    ...(createdAtMs !== null ? { createdAtMs } : {}),
    ...(resolvedAtMs !== null ? { resolvedAtMs } : {}),
  }
}

export function communityModerationNoticeOwnerRecord(id: string, value: Record<string, unknown>) {
  const targetType = value.targetType === 'comment' ? 'comment' as const : 'post' as const
  const action = communityModerationActions.has(value.action as CommunityModerationAction)
    ? value.action as CommunityModerationAction
    : 'warn'
  const contentStatus = value.contentStatus === 'held' || value.contentStatus === 'removed'
    ? value.contentStatus
    : 'active'
  const createdAtMs = communityTimestampMillis(value.createdAt)
  return {
    noticeId: id,
    targetType,
    postId: typeof value.postId === 'string' ? value.postId.slice(0, 120) : '',
    commentId: targetType === 'comment' && typeof value.commentId === 'string'
      ? value.commentId.slice(0, 120)
      : null,
    action,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 300) : '',
    contentStatus,
    body: typeof value.body === 'string' ? value.body.slice(0, 240) : '',
    createdAtMs: createdAtMs ?? 0,
  }
}

export type CommunityCaseAction = 'dismiss' | 'hold' | 'remove' | 'accept' | 'reject'

export function communityCaseResolutionPlan(input: {
  caseType: 'report' | 'appeal'
  action: unknown
  contentStatus: CommunityStatus
}) {
  if (input.caseType === 'report') {
    if (input.action === 'dismiss') {
      return { caseStatus: 'dismissed' as const, moderationAction: null }
    }
    if (input.action === 'hold') {
      if (input.contentStatus === 'held') {
        return { caseStatus: 'resolved' as const, moderationAction: null }
      }
      if (input.contentStatus !== 'active') {
        throw new HttpsError('failed-precondition', '현재 콘텐츠는 숨김 처리할 수 없어요')
      }
      return { caseStatus: 'resolved' as const, moderationAction: 'hold' as const }
    }
    if (input.action === 'remove') {
      if (input.contentStatus === 'removed') {
        return { caseStatus: 'resolved' as const, moderationAction: null }
      }
      if (input.contentStatus !== 'active' && input.contentStatus !== 'held') {
        throw new HttpsError('failed-precondition', '현재 콘텐츠는 운영상 삭제할 수 없어요')
      }
      return { caseStatus: 'resolved' as const, moderationAction: 'remove' as const }
    }
    throw new HttpsError('invalid-argument', '신고 처리 행동을 다시 선택해 주세요')
  }
  if (input.action === 'reject') {
    if (input.contentStatus !== 'held' && input.contentStatus !== 'removed') {
      throw new HttpsError('failed-precondition', '기존 운영 조치가 유지 중인 글만 기각할 수 있어요')
    }
    return { caseStatus: 'rejected' as const, moderationAction: null }
  }
  if (input.action === 'accept') {
    if (input.contentStatus !== 'held' && input.contentStatus !== 'removed') {
      throw new HttpsError('failed-precondition', '복원할 수 있는 글이 아니에요')
    }
    return { caseStatus: 'accepted' as const, moderationAction: 'restore' as const }
  }
  throw new HttpsError('invalid-argument', '이의 제기 처리 행동을 다시 선택해 주세요')
}

function requireMember(uid: string | undefined): string {
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  return uid
}

export function requireCommunityModerator(token: Record<string, unknown> | undefined): void {
  if (token?.role !== 'moderator' && token?.role !== 'administrator') {
    throw new HttpsError('permission-denied', '운영 권한이 필요합니다')
  }
}

function isAdministrator(token: Record<string, unknown> | undefined): boolean {
  return token?.role === 'administrator'
}

function requireAdministrator(token: Record<string, unknown> | undefined): void {
  if (!isAdministrator(token)) {
    throw new HttpsError('permission-denied', '관리자 권한이 필요합니다')
  }
}

function hasCommunityModerationGuidance(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const action = (value as Record<string, unknown>).action
  return action === 'warn' || action === 'request_correction'
}

function text(value: unknown, label: string, max: number): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.length < 2 || result.length > max) throw new HttpsError('invalid-argument', `${label}을 확인해 주세요`)
  return result
}

async function communityIdentityFor(uid: string): Promise<{ pseudonym: string; provider: CommunityLoginProvider }> {
  const snapshot = await getFirestore().collection('users').doc(uid).get()
  const pseudonym = snapshot.get('pseudonym')
  const provider = snapshot.get('provider')
  if (snapshot.get('connected') !== true || !hasCurrentCommunityConsent(snapshot.data() ?? {})) {
    throw new HttpsError('failed-precondition', '최신 이용약관과 커뮤니티 규칙에 먼저 동의해 주세요')
  }
  if (typeof pseudonym !== 'string' || !pseudonym) throw new HttpsError('failed-precondition', '별명을 먼저 정해 주세요')
  if (provider !== 'kakao' && provider !== 'naver') throw new HttpsError('failed-precondition', '로그인 정보를 다시 확인해 주세요')
  return { pseudonym, provider }
}

export const createCommunityPost = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const body = text(request.data?.body, '내용', 2000)
  const topic = validateCommunityTopic(request.data?.topic)
  const purpose = validateCommunityPurpose(text(request.data?.purpose, '글의 성격', 40))
  const requestId = validateCommunityWriteRequestId(request.data?.requestId)
  const identity = await communityIdentityFor(uid)
  const firestore = getFirestore()
  const requestKey = communityWriteRequestKey(uid, 'post', requestId)
  const fingerprint = communityWriteFingerprint({ body, topic, purpose })
  const requestRef = firestore.collection('communityWriteRequests').doc(requestKey)
  const rateRef = firestore.collection('communityWriteRateLimits').doc(uid)
  const ref = firestore.collection('communityPosts').doc(requestKey)
  const postId = await firestore.runTransaction(async (transaction) => {
    const [storedRequest, rate] = await Promise.all([transaction.get(requestRef), transaction.get(rateRef)])
    if (storedRequest.exists) {
      if (storedRequest.get('fingerprint') !== fingerprint || storedRequest.get('kind') !== 'post') {
        throw new HttpsError('already-exists', '같은 요청 번호로 다른 글을 등록할 수 없어요')
      }
      return String(storedRequest.get('recordId') ?? ref.id)
    }
    const nowMs = Date.now()
    const throttle = communityWriteThrottle({ kind: 'post', previousAtMs: rate.get('postAtMs'), nowMs })
    if (!throttle.allowed) {
      throw new HttpsError('resource-exhausted', `${throttle.retryAfterSeconds}초 뒤에 다시 등록해 주세요`, throttle)
    }
    transaction.set(ref, publicPostRecord({ body, topic, purpose, ...identity, timestamp: FieldValue.serverTimestamp() }))
    transaction.set(firestore.collection('communityPostOwners').doc(ref.id), { ownerUid: uid, createdAt: FieldValue.serverTimestamp() })
    transaction.set(rateRef, { postAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    transaction.create(requestRef, {
      kind: 'post', requestId, fingerprint, recordId: ref.id, ownerUid: uid, createdAt: FieldValue.serverTimestamp(),
    })
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: 'community.post_created',
      postId: ref.id,
      purpose,
      uid,
      at: FieldValue.serverTimestamp(),
    })
    return ref.id
  })
  return { postId }
})

export const createCommunityComment = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const postId = text(request.data?.postId, '글', 120)
  const body = text(request.data?.body, '댓글', 800)
  const requestId = validateCommunityWriteRequestId(request.data?.requestId)
  const identity = await communityIdentityFor(uid)
  const firestore = getFirestore()
  const requestKey = communityWriteRequestKey(uid, 'comment', requestId)
  const fingerprint = communityWriteFingerprint({ postId, body })
  const requestRef = firestore.collection('communityWriteRequests').doc(requestKey)
  const rateRef = firestore.collection('communityWriteRateLimits').doc(uid)
  const postRef = firestore.collection('communityPosts').doc(postId)
  const postOwnerRef = firestore.collection('communityPostOwners').doc(postId)
  const commentRef = postRef.collection('comments').doc(requestKey)
  const ownerRef = firestore.collection('communityCommentOwners').doc(`${postId}_${commentRef.id}`)
  const commentId = await firestore.runTransaction(async (transaction) => {
    const [storedRequest, rate, post, postOwner] = await Promise.all([
      transaction.get(requestRef), transaction.get(rateRef), transaction.get(postRef), transaction.get(postOwnerRef),
    ])
    if (storedRequest.exists) {
      if (storedRequest.get('fingerprint') !== fingerprint || storedRequest.get('kind') !== 'comment') {
        throw new HttpsError('already-exists', '같은 요청 번호로 다른 댓글을 등록할 수 없어요')
      }
      return String(storedRequest.get('recordId') ?? commentRef.id)
    }
    if (!post.exists || !postOwner.exists || post.get('status') !== 'active') throw new HttpsError('failed-precondition', '댓글을 남길 수 없는 글입니다')
    const postOwnerUid = String(postOwner.get('ownerUid') ?? '')
    if (postOwnerUid && postOwnerUid !== uid) {
      const [outgoingBlock, incomingBlock] = await Promise.all([
        transaction.get(firestore.collection('communityBlocks').doc(communityBlockKey(uid, postOwnerUid))),
        transaction.get(firestore.collection('communityBlocks').doc(communityBlockKey(postOwnerUid, uid))),
      ])
      if (outgoingBlock.exists || incomingBlock.exists) {
        throw new HttpsError('failed-precondition', '서로 숨긴 이용자의 글에는 댓글을 남길 수 없어요')
      }
    }
    const nowMs = Date.now()
    const throttle = communityWriteThrottle({ kind: 'comment', previousAtMs: rate.get('commentAtMs'), nowMs })
    if (!throttle.allowed) {
      throw new HttpsError('resource-exhausted', `${throttle.retryAfterSeconds}초 뒤에 다시 등록해 주세요`, throttle)
    }
    transaction.set(commentRef, publicCommentRecord({ body, ...identity, timestamp: FieldValue.serverTimestamp() }))
    transaction.set(ownerRef, { ownerUid: uid, postId, commentId: commentRef.id, createdAt: FieldValue.serverTimestamp() })
    transaction.update(postRef, { commentCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() })
    transaction.set(rateRef, { commentAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    transaction.create(requestRef, {
      kind: 'comment', requestId, fingerprint, recordId: commentRef.id, postId, ownerUid: uid, createdAt: FieldValue.serverTimestamp(),
    })
    return commentRef.id
  })
  return { commentId }
})

export const reportCommunityContent = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const targetType = request.data?.targetType === 'comment' ? 'comment' : request.data?.targetType === 'post' ? 'post' : null
  const targetId = text(request.data?.targetId, '신고 대상', 120)
  const category = request.data?.category
  if (!targetType || !reportCategories.includes(category)) throw new HttpsError('invalid-argument', '신고 유형을 선택해 주세요')
  const details = typeof request.data?.details === 'string' ? request.data.details.trim().slice(0, 500) : ''
  const firestore = getFirestore()
  const urgent = category === 'personal_data' || category === 'crisis'
  const postId = targetType === 'comment' ? text(request.data?.postId, '댓글이 속한 글', 120) : undefined
  const target: ReportTarget = { targetType, targetId, ...(postId ? { postId } : {}) }
  const reportRef = firestore.collection('reports').doc(communityReportKey(uid, target))
  const ownerRef = targetType === 'post'
    ? firestore.collection('communityPostOwners').doc(targetId)
    : firestore.collection('communityCommentOwners').doc(`${postId}_${targetId}`)
  const contentRef = targetType === 'post'
    ? firestore.collection('communityPosts').doc(targetId)
    : firestore.collection('communityPosts').doc(String(postId)).collection('comments').doc(targetId)
  const dayKey = new Date().toISOString().slice(0, 10)
  const rateRef = firestore.collection('communityReportRateLimits').doc(`${uid}_${dayKey}`)
  await firestore.runTransaction(async (transaction) => {
    const [existingReport, owner, content, rate] = await Promise.all([
      transaction.get(reportRef), transaction.get(ownerRef), transaction.get(contentRef), transaction.get(rateRef),
    ])
    if (existingReport.exists) throw new HttpsError('already-exists', '이미 신고한 내용이에요')
    if (!owner.exists || !content.exists) throw new HttpsError('not-found', '신고할 내용을 찾지 못했어요')
    validateReportableCommunityStatus(content.get('status'))
    if (owner.get('ownerUid') === uid) throw new HttpsError('failed-precondition', '내가 작성한 내용은 신고할 수 없어요')
    const nextRate = validateReportQuota(rate.data(), urgent)
    transaction.create(reportRef, communityReportRecord(target, category, details, FieldValue.serverTimestamp()))
    transaction.set(firestore.collection('communityReportOwners').doc(reportRef.id), { reporterUid: uid, createdAt: FieldValue.serverTimestamp() })
    transaction.set(rateRef, { ...nextRate, dayKey, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
  return { reportId: reportRef.id, urgent }
})

export const getCommunityOwnership = onCall({ region: 'asia-northeast3' }, async (request) => {
  const uid = requireMember(request.auth?.uid)
  const administrator = isAdministrator(request.auth?.token)
  const postIds: unknown[] = Array.isArray(request.data?.postIds) ? request.data.postIds : []
  const comments: unknown[] = Array.isArray(request.data?.comments) ? request.data.comments : []
  if (postIds.length > 50 || comments.length > 50) throw new HttpsError('invalid-argument', '한 번에 확인할 수 있는 작성 기록을 넘었어요')
  const cleanPostIds: string[] = postIds.map((value: unknown) => text(value, '글', 120))
  const cleanComments: Array<{ postId: string; commentId: string }> = comments.map((value: unknown) => ({
    postId: text(typeof value === 'object' && value ? (value as Record<string, unknown>).postId : undefined, '글', 120),
    commentId: text(typeof value === 'object' && value ? (value as Record<string, unknown>).commentId : undefined, '댓글', 120),
  }))
  const firestore = getFirestore()
  const [outgoingBlocks, incomingBlocks] = await Promise.all([
    firestore.collection('communityBlocks').where('blockerUid', '==', uid).limit(maximumCommunityBlocks).get(),
    firestore.collection('communityBlocks').where('blockedUid', '==', uid).limit(maximumCommunityBlocks).get(),
  ])
  const hiddenOwnerUids = new Set([
    ...outgoingBlocks.docs.map((document) => String(document.get('blockedUid') ?? '')),
    ...incomingBlocks.docs.map((document) => String(document.get('blockerUid') ?? '')),
  ])
  const references = [
    ...cleanPostIds.map((id: string) => firestore.collection('communityPostOwners').doc(id)),
    ...cleanComments.map(({ postId, commentId }: { postId: string; commentId: string }) => firestore.collection('communityCommentOwners').doc(`${postId}_${commentId}`)),
  ]
  if (!references.length) return { postIds: [], comments: [], hiddenPostIds: [], hiddenComments: [], canManageAll: administrator }
  const snapshots = await firestore.getAll(...references)
  return communityOwnershipResponse({
    uid,
    administrator,
    postIds: cleanPostIds,
    comments: cleanComments,
    ownerUids: snapshots.map((snapshot) => snapshot.exists ? snapshot.get('ownerUid') : undefined),
    hiddenOwnerUids,
  })
})

export const blockCommunityAuthor = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const targetType = request.data?.targetType === 'comment' ? 'comment' : request.data?.targetType === 'post' ? 'post' : null
  const targetId = text(request.data?.targetId, '숨길 대상', 120)
  const postId = targetType === 'comment' ? text(request.data?.postId, '댓글이 속한 글', 120) : targetId
  if (!targetType) throw new HttpsError('invalid-argument', '숨길 대상을 다시 선택해 주세요')
  const firestore = getFirestore()
  const contentRef = targetType === 'comment'
    ? firestore.collection('communityPosts').doc(postId).collection('comments').doc(targetId)
    : firestore.collection('communityPosts').doc(targetId)
  const ownerRef = targetType === 'comment'
    ? firestore.collection('communityCommentOwners').doc(`${postId}_${targetId}`)
    : firestore.collection('communityPostOwners').doc(targetId)
  const countRef = firestore.collection('communityBlockCounts').doc(uid)
  let blockId = ''
  await firestore.runTransaction(async (transaction) => {
    const [content, owner, count] = await Promise.all([
      transaction.get(contentRef),
      transaction.get(ownerRef),
      transaction.get(countRef),
    ])
    if (!content.exists || !owner.exists) throw new HttpsError('not-found', '숨길 이용자의 내용을 찾지 못했어요')
    const blockedUid = String(owner.get('ownerUid') ?? '')
    if (!blockedUid || blockedUid === uid) throw new HttpsError('failed-precondition', '내 계정은 숨길 수 없어요')
    blockId = communityBlockKey(uid, blockedUid)
    const blockRef = firestore.collection('communityBlocks').doc(blockId)
    const existing = await transaction.get(blockRef)
    if (existing.exists) throw new HttpsError('already-exists', '이미 숨긴 이용자예요')
    const storedTotal = Number(count.get('total') ?? 0)
    const total = Number.isSafeInteger(storedTotal) && storedTotal >= 0 ? storedTotal : 0
    if (!Number.isSafeInteger(total) || total < 0 || total >= maximumCommunityBlocks) {
      throw new HttpsError('resource-exhausted', '숨길 수 있는 이용자 수를 넘었어요')
    }
    transaction.create(blockRef, {
      blockerUid: uid,
      blockedUid,
      pseudonym: String(content.get('pseudonym') ?? '숨긴 이용자'),
      provider: content.get('provider') === 'kakao' || content.get('provider') === 'naver' ? content.get('provider') : null,
      createdAt: FieldValue.serverTimestamp(),
    })
    transaction.set(countRef, { total: total + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: 'community.author_blocked', blockId, uid, at: FieldValue.serverTimestamp(),
    })
  })
  return { blockId }
})

export const unblockCommunityAuthor = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const blockId = text(request.data?.blockId, '숨김 기록', 120)
  const firestore = getFirestore()
  const blockRef = firestore.collection('communityBlocks').doc(blockId)
  const countRef = firestore.collection('communityBlockCounts').doc(uid)
  await firestore.runTransaction(async (transaction) => {
    const [block, count] = await Promise.all([transaction.get(blockRef), transaction.get(countRef)])
    if (!block.exists || block.get('blockerUid') !== uid) throw new HttpsError('not-found', '숨김 기록을 찾지 못했어요')
    const total = Number(count.get('total') ?? 0)
    transaction.delete(blockRef)
    transaction.set(countRef, { total: Math.max(0, total - 1), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: 'community.author_unblocked', blockId, uid, at: FieldValue.serverTimestamp(),
    })
  })
  return { status: 'unblocked' }
})

export const listCommunityPostsForAdmin = onCall({ region: 'asia-northeast3' }, async (request) => {
  requireMember(request.auth?.uid)
  requireAdministrator(request.auth?.token)
  const firestore = getFirestore()
  const queue = validateCommunityOperatorQueue(request.data?.queue)
  const status = validateCommunityQueueStatus(queue, request.data?.status)
  const collectionName = queue === 'content'
    ? 'communityPosts'
    : queue === 'reports'
      ? 'reports'
      : 'moderationAppeals'
  const collection = firestore.collection(collectionName)
  const cursor = decodeCommunityQueueCursor(request.data?.cursorId)
  let query = status
    ? collection.where('status', '==', status)
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(operatorQueuePageSize + 1)
    : collection.orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(operatorQueuePageSize + 1)
  if (cursor) {
    query = query.startAfter(new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id)
  }
  const snapshot = await query.get()
  const page = communityQueuePage(snapshot.docs, (document) => {
    const createdAt = document.get('createdAt')
    return createdAt instanceof Timestamp
      ? encodeCommunityQueueCursor({
        seconds: createdAt.seconds,
        nanoseconds: createdAt.nanoseconds,
        id: document.id,
      })
      : null
  })
  const documents = page.items
  if (queue === 'reports') {
    return {
      queue,
      cases: documents.map((document) => {
        const data = document.data()
        return {
          id: document.id,
          caseType: 'report',
          status: String(data.status ?? 'received'),
          targetType: data.targetType === 'comment' ? 'comment' : 'post',
          targetId: String(data.targetId ?? ''),
          postId: typeof data.postId === 'string' ? data.postId : null,
          category: String(data.category ?? 'other'),
          details: String(data.details ?? ''),
          createdAtMs: typeof data.createdAt?.toMillis === 'function' ? Number(data.createdAt.toMillis()) : 0,
          resolution: typeof data.resolution === 'string' ? data.resolution : '',
        }
      }),
      posts: [],
      hasMore: page.hasMore,
      nextCursorId: page.nextCursorId,
    }
  }
  if (queue === 'appeals') {
    return {
      queue,
      cases: documents.map((document) => {
        const data = document.data()
        return {
          id: document.id,
          caseType: 'appeal',
          status: String(data.status ?? 'received'),
          targetType: 'post',
          targetId: String(data.postId ?? ''),
          postId: String(data.postId ?? ''),
          category: 'appeal',
          details: String(data.reason ?? ''),
          createdAtMs: typeof data.createdAt?.toMillis === 'function' ? Number(data.createdAt.toMillis()) : 0,
          resolution: typeof data.resolution === 'string' ? data.resolution : '',
        }
      }),
      posts: [],
      hasMore: page.hasMore,
      nextCursorId: page.nextCursorId,
    }
  }
  return {
    queue,
    cases: [],
    posts: documents.map((document) => {
      const data = document.data()
      return {
        id: document.id,
        body: String(data.body ?? ''),
        topic: typeof data.topic === 'string' ? data.topic : null,
        purpose: typeof data.purpose === 'string' ? data.purpose : '생각 나눔',
        pseudonym: String(data.pseudonym ?? ''),
        provider: data.provider === 'kakao' || data.provider === 'naver' ? data.provider : null,
        status: String(data.status ?? 'active'),
        commentCount: Number(data.commentCount ?? 0),
        createdAtMs: typeof data.createdAt?.toMillis === 'function' ? Number(data.createdAt.toMillis()) : 0,
        updatedAtMs: typeof data.updatedAt?.toMillis === 'function' ? Number(data.updatedAt.toMillis()) : 0,
        moderationReason: typeof data.moderationReason === 'string' ? data.moderationReason : '',
      }
    }),
    hasMore: page.hasMore,
    nextCursorId: page.nextCursorId,
  }
})

export const listMyCommunityCases = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const firestore = getFirestore()
  const [postOwners, reportOwners, appealOwners, blocks, moderationNotices] = await Promise.all([
    firestore.collection('communityPostOwners').where('ownerUid', '==', uid).limit(50).get(),
    firestore.collection('communityReportOwners').where('reporterUid', '==', uid).limit(50).get(),
    firestore.collection('communityAppealOwners').where('ownerUid', '==', uid).limit(50).get(),
    firestore.collection('communityBlocks').where('blockerUid', '==', uid).limit(maximumCommunityBlocks).get(),
    firestore.collection('communityModerationNotices')
      .where('ownerUid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get(),
  ])
  const postIds = postOwners.docs.map((document) => document.id)
  const reportIds = reportOwners.docs.map((document) => document.id)
  const appealIds = appealOwners.docs.map((document) => document.id)
  const [posts, reports, appeals] = await Promise.all([
    postIds.length
      ? firestore.getAll(...postIds.map((id) => firestore.collection('communityPosts').doc(id)))
      : Promise.resolve([]),
    reportIds.length
      ? firestore.getAll(...reportIds.map((id) => firestore.collection('reports').doc(id)))
      : Promise.resolve([]),
    appealIds.length
      ? firestore.getAll(...appealIds.map((id) => firestore.collection('moderationAppeals').doc(id)))
      : Promise.resolve([]),
  ])
  const appealedPostIds = new Set(appeals.filter((item) => item.exists).map((item) => String(item.get('postId'))))
  return {
    moderationNotices: moderationNotices.docs
      .map((item) => communityModerationNoticeOwnerRecord(item.id, item.data()))
      .sort((left, right) => right.createdAtMs - left.createdAtMs),
    moderatedPosts: posts
      .filter((item) => item.exists && (item.get('status') === 'held' || item.get('status') === 'removed'))
      .map((item) => ({
        postId: item.id,
        status: item.get('status'),
        body: String(item.get('body') ?? '').slice(0, 240),
        reason: String(item.get('moderationReason') ?? '운영 정책에 따라 공개 상태를 확인하고 있어요.'),
        appealed: appealedPostIds.has(item.id),
      })),
    reports: reports
      .filter((item) => item.exists)
      .map((item) => ({
        reportId: item.id,
        targetType: item.get('targetType') === 'comment' ? 'comment' : 'post',
        status: String(item.get('status') ?? 'received'),
        category: String(item.get('category') ?? 'other'),
        resolution: String(item.get('resolution') ?? ''),
      })),
    appeals: appeals
      .filter((item) => item.exists)
      .map((item) => communityAppealOwnerRecord(item.id, item.data() ?? {})),
    blockedAuthors: blocks.docs.map((item) => ({
      blockId: item.id,
      pseudonym: String(item.get('pseudonym') ?? '숨긴 이용자'),
      provider: item.get('provider') === 'kakao' || item.get('provider') === 'naver' ? item.get('provider') : null,
    })),
  }
})

export const resolveCommunityCase = onCall({ region: 'asia-northeast3' }, async (request) => {
  const administratorUid = requireMember(request.auth?.uid)
  requireAdministrator(request.auth?.token)
  const caseType = request.data?.caseType
  if (caseType !== 'report' && caseType !== 'appeal') {
    throw new HttpsError('invalid-argument', '처리할 운영 항목을 다시 선택해 주세요')
  }
  const caseId = text(request.data?.caseId, '운영 항목', 120)
  const action = request.data?.action as CommunityCaseAction
  const resolution = text(request.data?.resolution, '처리 안내', 500)
  const requestId = validateCommunityWriteRequestId(request.data?.requestId)
  const firestore = getFirestore()
  const collection = caseType === 'report' ? 'reports' : 'moderationAppeals'
  const ref = firestore.collection(collection).doc(caseId)
  const commandId = createHash('sha256').update(`community-case:${administratorUid}:${requestId}`).digest('hex').slice(0, 40)
  const commandRef = firestore.collection('communityCaseCommands').doc(commandId)
  const fingerprint = communityWriteFingerprint({ caseType, caseId, action, resolution })
  const status = await firestore.runTransaction(async (transaction) => {
    const [caseSnapshot, command] = await Promise.all([transaction.get(ref), transaction.get(commandRef)])
    if (command.exists) {
      if (command.get('fingerprint') !== fingerprint) {
        throw new HttpsError('already-exists', '같은 요청 번호로 다른 운영 조치를 적용할 수 없어요')
      }
      return String(command.get('status') ?? '')
    }
    if (!caseSnapshot.exists) throw new HttpsError('not-found', '운영 항목을 찾지 못했어요')
    const current = caseSnapshot.get('status')
    if (current !== 'received' && current !== 'urgent_review') {
      throw new HttpsError('failed-precondition', '이미 처리된 운영 항목입니다')
    }
    const targetType = caseType === 'report' && caseSnapshot.get('targetType') === 'comment' ? 'comment' : 'post'
    const targetId = caseType === 'report'
      ? String(caseSnapshot.get('targetId') ?? '')
      : String(caseSnapshot.get('postId') ?? '')
    const postId = targetType === 'comment' ? String(caseSnapshot.get('postId') ?? '') : targetId
    if (!targetId || !postId) throw new HttpsError('failed-precondition', '운영 대상 연결 정보가 없어요')
    const contentRef = targetType === 'comment'
      ? firestore.collection('communityPosts').doc(postId).collection('comments').doc(targetId)
      : firestore.collection('communityPosts').doc(targetId)
    const ownerRef = targetType === 'comment'
      ? firestore.collection('communityCommentOwners').doc(`${postId}_${targetId}`)
      : firestore.collection('communityPostOwners').doc(targetId)
    const [contentSnapshot, ownerSnapshot] = await Promise.all([
      transaction.get(contentRef),
      transaction.get(ownerRef),
    ])
    if (!contentSnapshot.exists || !ownerSnapshot.exists) {
      throw new HttpsError('not-found', '운영할 콘텐츠를 찾지 못했어요')
    }
    const previousStatus = contentSnapshot.get('status') as CommunityStatus
    const plan = communityCaseResolutionPlan({ caseType, action, contentStatus: previousStatus })
    let nextStatus = previousStatus
    if (plan.moderationAction) {
      let moderationPlan: ReturnType<typeof planCommunityModeration>
      try {
        moderationPlan = planCommunityModeration({
          status: previousStatus,
          action: plan.moderationAction,
          authorUid: String(ownerSnapshot.get('ownerUid')),
          moderatorUid: administratorUid,
          administrator: true,
          hasPriorGuidance: hasCommunityModerationGuidance(ownerSnapshot.get('moderationGuidance')),
        })
        nextStatus = moderationPlan.status
      } catch (error) {
        if (error instanceof CommunityPolicyError && error.code === 'notice_required') {
          throw new HttpsError('failed-precondition', '먼저 작성자에게 경고 또는 수정 요청을 보내 주세요')
        }
        throw new HttpsError('failed-precondition', '현재 콘텐츠 상태에서는 이 조치를 적용할 수 없어요')
      }
      transaction.update(contentRef, publicModerationPatch({
        status: nextStatus as ModeratedStatus,
        reason: resolution,
        timestamp: FieldValue.serverTimestamp(),
      }))
      if (moderationPlan.consumesGuidance) {
        transaction.update(ownerRef, { moderationGuidance: FieldValue.delete() })
      }
      const noticeId = createHash('sha256')
        .update(`${caseType}:${caseId}:${plan.moderationAction}`)
        .digest('hex')
        .slice(0, 40)
      transaction.create(firestore.collection('communityModerationNotices').doc(noticeId), {
        ownerUid: String(ownerSnapshot.get('ownerUid') ?? ''),
        targetType,
        postId,
        ...(targetType === 'comment' ? { commentId: targetId } : {}),
        action: plan.moderationAction,
        reason: resolution,
        contentStatus: nextStatus,
        body: String(contentSnapshot.get('body') ?? '').slice(0, 240),
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    transaction.update(ref, {
      status: plan.caseStatus,
      action,
      resolution,
      resolvedBy: administratorUid,
      resolvedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: `community.${caseType}_resolved`,
      caseId,
      action,
      targetType,
      targetId,
      previousStatus,
      nextStatus,
      reason: resolution,
      uid: administratorUid,
      at: FieldValue.serverTimestamp(),
    })
    const resultStatus = caseType === 'report'
      ? action === 'dismiss' ? 'dismissed' : 'resolved'
      : action === 'accept' ? 'accepted' : 'rejected'
    transaction.create(commandRef, {
      requestId, fingerprint, caseType, caseId, action, status: resultStatus,
      administratorUid, createdAt: FieldValue.serverTimestamp(),
    })
    return resultStatus
  })
  return { status }
})

async function applyCommunityModeration(input: {
  moderatorUid: string
  administrator: boolean
  targetType: 'post' | 'comment'
  postId: string
  commentId?: string
  action: CommunityModerationAction
  reason: string
  requestId: string
  auditType: string
  contentRef: DocumentReference
  ownerRef: DocumentReference
}) {
  const firestore = getFirestore()
  const commandId = communityModerationCommandKey(input.moderatorUid, input.requestId)
  const commandRef = firestore.collection('auditEvents').doc(commandId)
  const noticeRef = firestore.collection('communityModerationNotices').doc(commandId)
  return firestore.runTransaction(async (transaction) => {
    const [content, owner, existingCommand] = await Promise.all([
      transaction.get(input.contentRef),
      transaction.get(input.ownerRef),
      transaction.get(commandRef),
    ])
    if (!content.exists || !owner.exists) throw new HttpsError('not-found', '운영할 콘텐츠를 찾지 못했어요')
    if (existingCommand.exists) {
      const sameCommand = existingCommand.get('commandType') === 'community.moderation_command'
        && existingCommand.get('postId') === input.postId
        && (existingCommand.get('commentId') ?? null) === (input.commentId ?? null)
        && existingCommand.get('action') === input.action
        && existingCommand.get('reason') === input.reason
      const previousStatus = existingCommand.get('nextStatus')
      if (!sameCommand || (previousStatus !== 'active' && previousStatus !== 'held' && previousStatus !== 'removed')) {
        throw new HttpsError('already-exists', '같은 요청 식별자가 다른 운영 조치에 사용됐어요')
      }
      return { status: previousStatus as ModeratedStatus, action: input.action, repeated: true }
    }

    const previousStatus = content.get('status') as CommunityStatus
    let plan: ReturnType<typeof planCommunityModeration>
    try {
      plan = planCommunityModeration({
        status: previousStatus,
        action: input.action,
        authorUid: String(owner.get('ownerUid') ?? ''),
        moderatorUid: input.moderatorUid,
        administrator: input.administrator,
        hasPriorGuidance: hasCommunityModerationGuidance(owner.get('moderationGuidance')),
      })
    } catch (error) {
      if (error instanceof CommunityPolicyError && error.code === 'notice_required') {
        throw new HttpsError('failed-precondition', '먼저 작성자에게 경고 또는 수정 요청을 보내 주세요')
      }
      throw new HttpsError('failed-precondition', '현재 상태에서 처리할 수 없어요')
    }

    const timestamp = FieldValue.serverTimestamp()
    if (plan.changesVisibility) {
      transaction.update(input.contentRef, publicModerationPatch({
        status: plan.status,
        reason: input.reason,
        timestamp,
      }))
    }
    if (input.action === 'warn' || input.action === 'request_correction') {
      transaction.update(input.ownerRef, {
        moderationGuidance: {
          action: input.action,
          reason: input.reason,
          requestId: input.requestId,
          createdAt: timestamp,
        },
      })
    } else if (plan.consumesGuidance) {
      transaction.update(input.ownerRef, { moderationGuidance: FieldValue.delete() })
    }
    transaction.create(noticeRef, {
      ownerUid: String(owner.get('ownerUid') ?? ''),
      targetType: input.targetType,
      postId: input.postId,
      ...(input.commentId ? { commentId: input.commentId } : {}),
      action: input.action,
      reason: input.reason,
      contentStatus: plan.status,
      body: String(content.get('body') ?? '').slice(0, 240),
      createdAt: timestamp,
    })
    transaction.create(commandRef, {
      type: input.auditType,
      commandType: 'community.moderation_command',
      targetType: input.targetType,
      postId: input.postId,
      ...(input.commentId ? { commentId: input.commentId } : {}),
      action: input.action,
      reason: input.reason,
      requestId: input.requestId,
      previousStatus,
      nextStatus: plan.status,
      uid: input.moderatorUid,
      at: timestamp,
    })
    return { status: plan.status, action: input.action, repeated: false }
  })
}

export const moderateCommunityPost = onCall({ region: 'asia-northeast3' }, async (request) => {
  const moderatorUid = requireMember(request.auth?.uid)
  requireCommunityModerator(request.auth?.token)
  const postId = text(request.data?.postId, '글', 120)
  const requested = request.data?.action
  if (requested !== 'held' && requested !== 'removed' && requested !== 'active') throw new HttpsError('invalid-argument', '처리 상태를 확인해 주세요')
  const { action, reason, requestId } = validateCommunityModerationRequest({
    ...request.data,
    action: requested === 'held' ? 'hold' : requested === 'removed' ? 'remove' : 'restore',
  })
  const firestore = getFirestore()
  const postRef = firestore.collection('communityPosts').doc(postId)
  const result = await applyCommunityModeration({
    moderatorUid,
    administrator: isAdministrator(request.auth?.token),
    targetType: 'post',
    postId,
    action,
    reason,
    requestId,
    auditType: 'community.post_moderated',
    contentRef: postRef,
    ownerRef: firestore.collection('communityPostOwners').doc(postId),
  })
  return result
})

export const editCommunityPost = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const administrator = isAdministrator(request.auth?.token)
  const postId = text(request.data?.postId, '글', 120)
  const { body, topic, purpose } = validateCommunityPostEditInput(request.data)
  const firestore = getFirestore()
  const ref = firestore.collection('communityPosts').doc(postId)
  const ownerRef = firestore.collection('communityPostOwners').doc(postId)
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, ownerSnapshot] = await Promise.all([transaction.get(ref), transaction.get(ownerRef)])
    if (!snapshot.exists || !ownerSnapshot.exists) throw new HttpsError('not-found', '글을 찾지 못했어요')
    try {
      const next = editContent({ authorUid: String(ownerSnapshot.get('ownerUid')), actorUid: uid, status: snapshot.get('status') as CommunityStatus, administrator }, body)
      transaction.update(ref, { body: next.body, topic, purpose, updatedAt: FieldValue.serverTimestamp() })
      transaction.set(firestore.collection('auditEvents').doc(), { type: 'community.post_edited', postId, topic, purpose, uid, actorRole: administrator ? 'administrator' : 'author', at: FieldValue.serverTimestamp() })
    } catch {
      throw new HttpsError('permission-denied', '수정할 수 없는 글입니다')
    }
  })
  return { status: 'active' }
})

export const deleteCommunityPost = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const postId = text(request.data?.postId, '글', 120)
  const firestore = getFirestore()
  const ref = firestore.collection('communityPosts').doc(postId)
  const ownerRef = firestore.collection('communityPostOwners').doc(postId)
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, ownerSnapshot] = await Promise.all([transaction.get(ref), transaction.get(ownerRef)])
    if (!snapshot.exists || !ownerSnapshot.exists) throw new HttpsError('not-found', '글을 찾지 못했어요')
    const authorUid = String(ownerSnapshot.get('ownerUid') ?? '')
    if (!canDirectlyDeleteCommunityContent(authorUid, uid)) {
      throw new HttpsError('permission-denied', '다른 이용자의 글은 사유가 있는 운영 조치로 처리해 주세요')
    }
    try {
      const status = deleteContent({ authorUid, actorUid: uid, status: snapshot.get('status') as CommunityStatus })
      transaction.update(ref, { status, body: '', deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.set(firestore.collection('auditEvents').doc(), { type: 'community.post_deleted', postId, uid, actorRole: 'author', at: FieldValue.serverTimestamp() })
    } catch {
      throw new HttpsError('permission-denied', '삭제할 수 없는 글입니다')
    }
  })
  return { status: 'deleted' }
})

export const moderateCommunityContent = onCall({ region: 'asia-northeast3' }, async (request) => {
  const moderatorUid = requireMember(request.auth?.uid)
  requireCommunityModerator(request.auth?.token)
  const postId = text(request.data?.postId, '글', 120)
  const { action, reason, requestId } = validateCommunityModerationRequest(request.data)
  const firestore = getFirestore()
  const ref = firestore.collection('communityPosts').doc(postId)
  return applyCommunityModeration({
    moderatorUid,
    administrator: isAdministrator(request.auth?.token),
    targetType: 'post',
    postId,
    action,
    reason,
    requestId,
    auditType: `community.${action}`,
    contentRef: ref,
    ownerRef: firestore.collection('communityPostOwners').doc(postId),
  })
})

export const appealCommunityModeration = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const postId = text(request.data?.postId, '글', 120)
  const reason = text(request.data?.reason, '이의 제기 사유', 1000)
  const firestore = getFirestore()
  const postRef = firestore.collection('communityPosts').doc(postId)
  const ownerRef = firestore.collection('communityPostOwners').doc(postId)
  const appealRef = firestore.collection('moderationAppeals').doc(communityAppealKey(uid, postId))
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, ownerSnapshot, existingAppeal] = await Promise.all([
      transaction.get(postRef), transaction.get(ownerRef), transaction.get(appealRef),
    ])
    if (!snapshot.exists) throw new HttpsError('not-found', '글을 찾지 못했어요')
    if (existingAppeal.exists) throw new HttpsError('already-exists', '이미 이 글의 이의 제기를 접수했어요')
    try {
      const appeal = createAppeal({ authorUid: String(ownerSnapshot.get('ownerUid')), actorUid: uid, status: snapshot.get('status') as CommunityStatus, reason })
      transaction.create(appealRef, { postId, ...appeal, createdAt: FieldValue.serverTimestamp() })
      transaction.set(firestore.collection('communityAppealOwners').doc(appealRef.id), { ownerUid: uid, createdAt: FieldValue.serverTimestamp() })
      transaction.set(firestore.collection('auditEvents').doc(), { type: 'community.appeal_created', postId, appealId: appealRef.id, uid, at: FieldValue.serverTimestamp() })
    } catch {
      throw new HttpsError('failed-precondition', '이의 제기를 접수할 수 없는 상태입니다')
    }
  })
  return { appealId: appealRef.id, status: 'received' }
})

export const editCommunityComment = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const administrator = isAdministrator(request.auth?.token)
  const postId = text(request.data?.postId, '글', 120)
  const commentId = text(request.data?.commentId, '댓글', 120)
  const body = text(request.data?.body, '댓글', 800)
  const firestore = getFirestore()
  const ref = firestore.collection('communityPosts').doc(postId).collection('comments').doc(commentId)
  const ownerRef = firestore.collection('communityCommentOwners').doc(`${postId}_${commentId}`)
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, ownerSnapshot] = await Promise.all([transaction.get(ref), transaction.get(ownerRef)])
    if (!snapshot.exists || !ownerSnapshot.exists) throw new HttpsError('not-found', '댓글을 찾지 못했어요')
    try {
      const next = editContent({ authorUid: String(ownerSnapshot.get('ownerUid')), actorUid: uid, status: snapshot.get('status') as CommunityStatus, administrator }, body)
      transaction.update(ref, { body: next.body, updatedAt: FieldValue.serverTimestamp() })
      transaction.set(firestore.collection('auditEvents').doc(), { type: 'community.comment_edited', postId, commentId, uid, actorRole: administrator ? 'administrator' : 'author', at: FieldValue.serverTimestamp() })
    } catch {
      throw new HttpsError('permission-denied', '수정할 수 없는 댓글입니다')
    }
  })
  return { status: 'active' }
})

export const deleteCommunityComment = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const postId = text(request.data?.postId, '글', 120)
  const commentId = text(request.data?.commentId, '댓글', 120)
  const firestore = getFirestore()
  const postRef = firestore.collection('communityPosts').doc(postId)
  const ref = postRef.collection('comments').doc(commentId)
  const ownerRef = firestore.collection('communityCommentOwners').doc(`${postId}_${commentId}`)
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, ownerSnapshot] = await Promise.all([transaction.get(ref), transaction.get(ownerRef)])
    if (!snapshot.exists || !ownerSnapshot.exists) throw new HttpsError('not-found', '댓글을 찾지 못했어요')
    const authorUid = String(ownerSnapshot.get('ownerUid') ?? '')
    if (!canDirectlyDeleteCommunityContent(authorUid, uid)) {
      throw new HttpsError('permission-denied', '다른 이용자의 댓글은 사유가 있는 운영 조치로 처리해 주세요')
    }
    try {
      const status = deleteContent({ authorUid, actorUid: uid, status: snapshot.get('status') as CommunityStatus })
      transaction.update(ref, { status, body: '', deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      transaction.update(postRef, { commentCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() })
      transaction.set(firestore.collection('auditEvents').doc(), { type: 'community.comment_deleted', postId, commentId, uid, actorRole: 'author', at: FieldValue.serverTimestamp() })
    } catch {
      throw new HttpsError('permission-denied', '삭제할 수 없는 댓글입니다')
    }
  })
  return { status: 'deleted' }
})

export const moderateCommunityComment = onCall({ region: 'asia-northeast3' }, async (request) => {
  const moderatorUid = requireMember(request.auth?.uid)
  requireCommunityModerator(request.auth?.token)
  const postId = text(request.data?.postId, '글', 120)
  const commentId = text(request.data?.commentId, '댓글', 120)
  const { action, reason, requestId } = validateCommunityModerationRequest(request.data)
  const firestore = getFirestore()
  const ref = firestore.collection('communityPosts').doc(postId).collection('comments').doc(commentId)
  return applyCommunityModeration({
    moderatorUid,
    administrator: isAdministrator(request.auth?.token),
    targetType: 'comment',
    postId,
    commentId,
    action,
    reason,
    requestId,
    auditType: `community.comment_${action}`,
    contentRef: ref,
    ownerRef: firestore.collection('communityCommentOwners').doc(`${postId}_${commentId}`),
  })
})
