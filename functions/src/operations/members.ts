import { randomUUID } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type UserRecord } from 'firebase-admin/auth'
import {
  FieldPath,
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentData,
  type DocumentSnapshot,
  type Query,
} from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { currentCommunityRulesVersion, currentTermsVersion } from '../auth/terms.js'
import {
  activityPositionAfter,
  emptyActivityCursor,
  exactActivityCounts,
  memberAccessAllowed,
  membershipProjection,
  mergeActivityPage,
  safeReason,
  summarizeMemberPopulation,
  totalRecordedActivity,
  type ActivityCursorState,
  type ActivityKind,
  type MemberActivityCounts,
  type MemberActivityItem,
  type MemberProvider,
  type MembershipCompletion,
  type TimelineKind,
} from './members-model.js'

if (!getApps().length) initializeApp()

const REGION = 'asia-northeast3'
const MEMBER_PAGE_LIMIT = 20
const TIMELINE_PAGE_LIMIT = 30
const AUTH_POPULATION_LIMIT = 1000
const ACTIVITY_QUERY_LIMIT = TIMELINE_PAGE_LIMIT + 1
const ACTIVITY_JOIN_LIMIT = 5000

type CallableAuth = { uid?: string; token?: Record<string, unknown> }
type ActivityFilter = 'any' | 'present' | 'none'

type MemberFilters = {
  search: string
  createdFromMs: number | null
  createdToMs: number | null
  provider: MemberProvider | 'all'
  completion: MembershipCompletion | 'all'
  activity: ActivityFilter
}

type MemberSource = {
  uid: string
  createdAtMs: number | null
  account: DocumentData | undefined
  projection: ReturnType<typeof membershipProjection>
}

type MemberMetrics = {
  counts: MemberActivityCounts
  lastRecordedActivityAt: number | null
  complete: boolean
}

function requireMemberReader(auth: CallableAuth | undefined, privateRead = false): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  if (!memberAccessAllowed(auth.token, privateRead)) {
    throw new HttpsError('permission-denied', privateRead
      ? '회원 제한 정보 조회 권한이 필요합니다'
      : '회원 현황 조회 권한이 필요합니다')
  }
  return auth.uid
}

function boundedText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function numberLimit(value: unknown, maximum: number): number {
  const parsed = Number(value ?? maximum)
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : maximum
}

function dateBoundary(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', '조회 기간을 확인해 주세요')
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new HttpsError('invalid-argument', '조회 기간을 확인해 주세요')
  return parsed
}

function parseFilters(data: unknown): MemberFilters {
  const value = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const provider = value.provider === 'naver' || value.provider === 'kakao' || value.provider === 'unknown'
    ? value.provider
    : 'all'
  const completion = value.completion === 'complete' || value.completion === 'incomplete' || value.completion === 'unknown'
    ? value.completion
    : 'all'
  const activity: ActivityFilter = value.activity === 'present' || value.activity === 'none' ? value.activity : 'any'
  const createdFromMs = dateBoundary(value.createdFrom)
  const createdToMs = dateBoundary(value.createdTo)
  if (createdFromMs !== null && createdToMs !== null && createdFromMs >= createdToMs) {
    throw new HttpsError('invalid-argument', '조회 시작일과 종료일을 확인해 주세요')
  }
  return {
    search: boundedText(value.search, 80).toLocaleLowerCase('ko-KR'),
    createdFromMs,
    createdToMs,
    provider,
    completion,
    activity,
  }
}

function authCreatedAt(user: UserRecord): number | null {
  const parsed = Date.parse(user.metadata.creationTime)
  return Number.isFinite(parsed) ? parsed : null
}

async function allAuthUsers(): Promise<UserRecord[]> {
  const result = await getAuth().listUsers(AUTH_POPULATION_LIMIT)
  if (result.pageToken) {
    throw new HttpsError(
      'resource-exhausted',
      `회원 집계 범위가 ${AUTH_POPULATION_LIMIT.toLocaleString('ko-KR')}명을 넘었습니다. 집계 저장소를 준비한 뒤 다시 조회해 주세요`,
    )
  }
  return result.users
}

async function documentsByUid(collectionName: string, uids: string[]): Promise<Map<string, DocumentData | undefined>> {
  const firestore = getFirestore()
  const result = new Map<string, DocumentData | undefined>()
  for (let index = 0; index < uids.length; index += 200) {
    const chunk = uids.slice(index, index + 200)
    const snapshots = await firestore.getAll(...chunk.map((uid) => firestore.collection(collectionName).doc(uid)))
    snapshots.forEach((snapshot, offset) => result.set(chunk[offset], snapshot.exists ? snapshot.data() : undefined))
  }
  return result
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(values.length)
  let cursor = 0
  async function run() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      result[index] = await worker(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => run()))
  return result
}

async function activityMetrics(uids: string[], fromMs: number | null = null, toMs: number | null = null): Promise<Map<string, MemberMetrics>> {
  const firestore = getFirestore()
  const collections: Record<ActivityKind, string> = {
    post: 'communityPostOwners',
    comment: 'communityCommentOwners',
    submission: 'submissions',
    event: 'calendarEventSubmissions',
  }
  const result = new Map<string, MemberMetrics>(uids.map((uid) => [uid, {
    counts: exactActivityCounts({ post: 0, comment: 0, submission: 0, event: 0 }),
    lastRecordedActivityAt: null,
    complete: true,
  }]))
  const work: Array<{ kind: ActivityKind; collectionName: string; uids: string[] }> = []
  for (const [kind, collectionName] of Object.entries(collections) as Array<[ActivityKind, string]>) {
    for (let index = 0; index < uids.length; index += 30) {
      work.push({ kind, collectionName, uids: uids.slice(index, index + 30) })
    }
  }
  await mapConcurrent(work, 6, async ({ kind, collectionName, uids: chunk }) => {
    try {
      let query: Query = firestore.collection(collectionName).where('ownerUid', 'in', chunk)
      if (fromMs !== null) query = query.where('createdAt', '>=', Timestamp.fromMillis(fromMs))
      if (toMs !== null) query = query.where('createdAt', '<', Timestamp.fromMillis(toMs))
      const snapshot = await query.select('ownerUid', 'createdAt').limit(ACTIVITY_JOIN_LIMIT + 1).get()
      if (snapshot.size > ACTIVITY_JOIN_LIMIT) {
        for (const uid of chunk) {
          const metric = result.get(uid)!
          metric.counts[kind] = null
          metric.complete = false
        }
        return
      }
      for (const document of snapshot.docs) {
        const ownerUid = document.get('ownerUid')
        const metric = typeof ownerUid === 'string' ? result.get(ownerUid) : undefined
        if (!metric) {
          for (const uid of chunk) result.get(uid)!.complete = false
          continue
        }
        metric.counts[kind] = (metric.counts[kind] ?? 0) + 1
        const createdAt = document.get('createdAt')
        if (createdAt instanceof Timestamp) {
          const time = createdAt.toMillis()
          if (metric.lastRecordedActivityAt === null || time > metric.lastRecordedActivityAt) {
            metric.lastRecordedActivityAt = time
          }
        } else {
          metric.complete = false
        }
      }
    } catch {
      for (const uid of chunk) {
        const metric = result.get(uid)!
        metric.counts[kind] = null
        metric.complete = false
      }
    }
  })
  return result
}

function baseMemberSources(users: UserRecord[], accounts: Map<string, DocumentData | undefined>): MemberSource[] {
  return users.map((user) => {
    const account = accounts.get(user.uid)
    return {
      uid: user.uid,
      createdAtMs: authCreatedAt(user),
      account,
      projection: membershipProjection(account, currentTermsVersion, currentCommunityRulesVersion),
    }
  }).sort((left, right) => (right.createdAtMs ?? -1) - (left.createdAtMs ?? -1) || left.uid.localeCompare(right.uid))
}

function sourceMatches(source: MemberSource, filters: MemberFilters, operatorUid: string | null): boolean {
  if (operatorUid && source.uid !== operatorUid) return false
  if (filters.search && !operatorUid && !source.projection.pseudonym?.toLocaleLowerCase('ko-KR').includes(filters.search)) return false
  if (filters.provider !== 'all' && source.projection.provider !== filters.provider) return false
  if (filters.completion !== 'all' && source.projection.completion !== filters.completion) return false
  if (filters.createdFromMs !== null && (source.createdAtMs === null || source.createdAtMs < filters.createdFromMs)) return false
  if (filters.createdToMs !== null && (source.createdAtMs === null || source.createdAtMs >= filters.createdToMs)) return false
  return true
}

async function resolveHandle(memberId: string): Promise<{ uid: string; memberId: string } | null> {
  const snapshot = await getFirestore().collection('adminMemberHandles').where('memberId', '==', memberId).limit(1).get()
  const document = snapshot.docs[0]
  return document ? { uid: document.id, memberId } : null
}

async function ensureHandle(uid: string): Promise<string> {
  const reference = getFirestore().collection('adminMemberHandles').doc(uid)
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const existing = snapshot.get('memberId')
    if (typeof existing === 'string' && existing) return existing
    const memberId = `wm_${randomUUID().replaceAll('-', '')}`
    transaction.create(reference, { memberId, createdAt: FieldValue.serverTimestamp() })
    return memberId
  })
}

async function auditMemberRead(type: string, operatorUid: string, details: Record<string, unknown>): Promise<void> {
  await getFirestore().collection('auditEvents').add({
    type,
    operatorUid,
    ...details,
    at: FieldValue.serverTimestamp(),
  })
}

function reasonFrom(data: unknown): string {
  const reason = safeReason(data && typeof data === 'object' ? (data as Record<string, unknown>).reason : undefined)
  if (!reason) throw new HttpsError('invalid-argument', '조회 사유를 2~200자로 입력해 주세요')
  return reason
}

function memberIdFrom(data: unknown): string {
  const memberId = boundedText(data && typeof data === 'object' ? (data as Record<string, unknown>).memberId : undefined, 80)
  if (!/^wm_[a-f0-9]{32}$/u.test(memberId)) throw new HttpsError('invalid-argument', '회원 식별값을 확인해 주세요')
  return memberId
}

async function sourceForMemberId(memberId: string): Promise<MemberSource> {
  const handle = await resolveHandle(memberId)
  if (!handle) throw new HttpsError('not-found', '회원을 찾을 수 없습니다')
  let user: UserRecord
  try {
    user = await getAuth().getUser(handle.uid)
  } catch {
    throw new HttpsError('not-found', '회원을 찾을 수 없습니다')
  }
  const accounts = await documentsByUid('users', [handle.uid])
  return baseMemberSources([user], accounts)[0]
}

function serializeMember(source: MemberSource, memberId: string, metrics: MemberMetrics) {
  return {
    memberId,
    pseudonym: source.projection.pseudonym,
    accountCreatedAt: source.createdAtMs === null ? null : new Date(source.createdAtMs).toISOString(),
    provider: source.projection.provider,
    completion: source.projection.completion,
    steps: source.projection.steps,
    lastRecordedActivityAt: metrics.lastRecordedActivityAt === null
      ? null
      : new Date(metrics.lastRecordedActivityAt).toISOString(),
    activityCounts: metrics.counts,
    activityCountsComplete: metrics.complete,
  }
}

export const listAdminMembers = onCall({ region: REGION }, async (request) => {
  const operatorUid = requireMemberReader(request.auth)
  const filters = parseFilters(request.data)
  const limit = numberLimit(request.data?.limit, MEMBER_PAGE_LIMIT)
  const rawCursor = boundedText(request.data?.cursor, 80)
  const exactOperatorMatch = filters.search && /^wm_[a-f0-9]{32}$/u.test(filters.search)
    ? await resolveHandle(filters.search)
    : null
  const users = await allAuthUsers()
  const accounts = await documentsByUid('users', users.map(({ uid }) => uid))
  let sources = baseMemberSources(users, accounts).filter((source) => sourceMatches(source, filters, exactOperatorMatch?.uid ?? null))
  const metrics = await activityMetrics(sources.map(({ uid }) => uid))
  const periodMetrics = filters.createdFromMs !== null || filters.createdToMs !== null
    ? await activityMetrics(sources.map(({ uid }) => uid), filters.createdFromMs, filters.createdToMs)
    : metrics
  const pairs = sources.map((source) => ({
    source,
    metrics: metrics.get(source.uid)!,
    periodMetrics: periodMetrics.get(source.uid)!,
  })).filter(({ metrics: item }) => {
    const total = totalRecordedActivity(item.counts)
    if (filters.activity === 'any') return true
    if (total === null) throw new HttpsError('unavailable', '활동 여부 집계를 완료하지 못했습니다. 잠시 뒤 다시 시도해 주세요')
    return filters.activity === 'present' ? total > 0 : total === 0
  })
  sources = pairs.map(({ source }) => source)

  let start = 0
  if (rawCursor) {
    const cursorHandle = await resolveHandle(rawCursor)
    const index = cursorHandle ? sources.findIndex(({ uid }) => uid === cursorHandle.uid) : -1
    if (index < 0) throw new HttpsError('failed-precondition', '목록이 변경되었습니다. 첫 페이지부터 다시 확인해 주세요')
    start = index + 1
  }
  const pagePairs = pairs.slice(start, start + limit)
  const items = await Promise.all(pagePairs.map(async ({ source, metrics: item }) => (
    serializeMember(source, await ensureHandle(source.uid), item)
  )))
  const nextCursor = start + limit < pairs.length && items.length
    ? items[items.length - 1].memberId
    : null
  const aggregate = summarizeMemberPopulation(pairs.map(({ source, metrics: item, periodMetrics: period }) => ({
    createdAtMs: source.createdAtMs,
    completion: source.projection.completion,
    counts: item.counts,
    periodCounts: period.counts,
    complete: item.complete && period.complete,
  })), Date.now())
  await auditMemberRead('members.list_viewed', operatorUid, {
    resultCount: items.length,
    populationCount: pairs.length,
    filters: {
      provider: filters.provider,
      completion: filters.completion,
      activity: filters.activity,
      hasSearch: Boolean(filters.search),
      hasCreatedFrom: filters.createdFromMs !== null,
      hasCreatedTo: filters.createdToMs !== null,
    },
  })
  return {
    items,
    nextCursor,
    summary: {
      ...aggregate,
      timeZone: 'Asia/Seoul',
      period: {
        from: filters.createdFromMs === null ? null : new Date(filters.createdFromMs).toISOString(),
        to: filters.createdToMs === null ? null : new Date(filters.createdToMs).toISOString(),
      },
      refreshedAt: new Date().toISOString(),
      basis: 'Firebase Auth 계정 생성 시각과 서버에 기록된 작성·등록 활동',
    },
  }
})

export const getAdminMemberOverview = onCall({ region: REGION }, async (request) => {
  const operatorUid = requireMemberReader(request.auth)
  const memberId = memberIdFrom(request.data)
  const reason = reasonFrom(request.data)
  const source = await sourceForMemberId(memberId)
  const metrics = (await activityMetrics([source.uid])).get(source.uid)!
  await auditMemberRead('members.overview_viewed', operatorUid, { memberId, reason })
  return { member: serializeMember(source, memberId, metrics) }
})

function encodeActivityCursor(state: ActivityCursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeActivityCursor(value: unknown): ActivityCursorState {
  if (value === undefined || value === null || value === '') return emptyActivityCursor()
  if (typeof value !== 'string' || value.length > 1200) throw new HttpsError('invalid-argument', '활동 목록 위치를 확인해 주세요')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    const state = emptyActivityCursor()
    for (const kind of Object.keys(state) as TimelineKind[]) {
      const position = parsed[kind]
      if (position === null) continue
      if (!position || typeof position !== 'object') throw new Error('invalid cursor')
      const occurredAtMs = Number((position as Record<string, unknown>).occurredAtMs)
      const id = (position as Record<string, unknown>).id
      if (!Number.isSafeInteger(occurredAtMs) || typeof id !== 'string' || !id || id.length > 300) throw new Error('invalid cursor')
      state[kind] = { occurredAtMs, id }
    }
    return state
  } catch {
    throw new HttpsError('invalid-argument', '활동 목록 위치를 확인해 주세요')
  }
}

async function ownedDocuments(
  collectionName: string,
  uid: string,
  position: ActivityCursorState[TimelineKind],
): Promise<DocumentSnapshot[]> {
  let query = getFirestore().collection(collectionName)
    .where('ownerUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
  if (position) query = query.startAfter(Timestamp.fromMillis(position.occurredAtMs), position.id)
  const snapshot = await query.limit(ACTIVITY_QUERY_LIMIT).get()
  return snapshot.docs
}

function documentTime(document: DocumentSnapshot): number | null {
  const value = document.get('createdAt')
  return value instanceof Timestamp ? value.toMillis() : null
}

function titleText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const result = value.replace(/\s+/gu, ' ').trim()
  return result ? result.slice(0, 100) : fallback
}

async function timelineSources(source: MemberSource, cursor: ActivityCursorState): Promise<Record<TimelineKind, MemberActivityItem[]>> {
  const firestore = getFirestore()
  const [postOwners, commentOwners, submissions, events] = await Promise.all([
    ownedDocuments('communityPostOwners', source.uid, cursor.post),
    ownedDocuments('communityCommentOwners', source.uid, cursor.comment),
    ownedDocuments('submissions', source.uid, cursor.submission),
    ownedDocuments('calendarEventSubmissions', source.uid, cursor.event),
  ])
  const postDocuments = postOwners.length
    ? await firestore.getAll(...postOwners.map((owner) => firestore.collection('communityPosts').doc(owner.id)))
    : []
  const commentDocuments = await Promise.all(commentOwners.map(async (owner) => {
    const postId = owner.get('postId')
    const commentId = owner.get('commentId')
    if (typeof postId !== 'string' || typeof commentId !== 'string') return { post: null, comment: null }
    const [post, comment] = await firestore.getAll(
      firestore.collection('communityPosts').doc(postId),
      firestore.collection('communityPosts').doc(postId).collection('comments').doc(commentId),
    )
    return { post, comment }
  }))
  const publishedSubmissionDocuments = await Promise.all(submissions.map(async (submission) => {
    if (submission.get('status') !== 'published') return null
    const kind = submission.get('kind')
    const publicCollection = kind === '활동 기록' || kind === '활동 레시피' ? 'activities' : 'materials'
    const publicSnapshot = await firestore.collection(publicCollection).doc(submission.id).get()
    return publicSnapshot.exists ? publicCollection : null
  }))
  const publicEvents = events.length
    ? await firestore.getAll(...events.map((event) => firestore.collection('calendarEvents').doc(event.id)))
    : []

  const posts = postOwners.flatMap((owner, index) => {
    const occurredAtMs = documentTime(owner)
    if (occurredAtMs === null) return []
    const current = postDocuments[index]
    const active = current?.exists && current.get('status') === 'active'
    return [{
      id: owner.id,
      kind: 'post' as const,
      occurredAtMs,
      title: active ? titleText(current.get('body'), '커뮤니티 글') : '삭제되었거나 공개가 중단된 글',
      status: current?.exists ? String(current.get('status') ?? '상태 확인 불가') : '삭제됨',
      href: active ? '/community' : null,
    }]
  })
  const comments = commentOwners.flatMap((owner, index) => {
    const occurredAtMs = documentTime(owner)
    if (occurredAtMs === null) return []
    const current = commentDocuments[index]
    const active = current.comment?.exists && current.comment.get('status') === 'active'
      && current.post?.exists && current.post.get('status') === 'active'
    return [{
      id: owner.id,
      kind: 'comment' as const,
      occurredAtMs,
      title: active ? titleText(current.comment!.get('body'), '커뮤니티 댓글') : '삭제되었거나 공개가 중단된 댓글',
      status: current.comment?.exists ? String(current.comment.get('status') ?? '상태 확인 불가') : '삭제됨',
      href: active ? '/community' : null,
    }]
  })
  const submissionItems = submissions.flatMap((document, index) => {
    const occurredAtMs = documentTime(document)
    if (occurredAtMs === null) return []
    const publicCollection = publishedSubmissionDocuments[index]
    return [{
      id: document.id,
      kind: 'submission' as const,
      occurredAtMs,
      title: titleText(document.get('title'), '제목 없는 자료'),
      status: String(document.get('status') ?? '상태 확인 불가'),
      href: publicCollection === 'activities'
        ? `/activities/${encodeURIComponent(document.id)}`
        : publicCollection === 'materials'
          ? `/materials/${encodeURIComponent(document.id)}`
          : null,
    }]
  })
  const eventItems = events.flatMap((document, index) => {
    const occurredAtMs = documentTime(document)
    if (occurredAtMs === null) return []
    return [{
      id: document.id,
      kind: 'event' as const,
      occurredAtMs,
      title: titleText(document.get('title'), '제목 없는 행사'),
      status: String(document.get('status') ?? '상태 확인 불가'),
      href: publicEvents[index]?.exists ? `/events/${encodeURIComponent(document.id)}` : null,
    }]
  })
  const account = source.createdAtMs !== null && cursor.account === null
    ? [{
        id: 'account-created',
        kind: 'account' as const,
        occurredAtMs: source.createdAtMs,
        title: '위브 계정 생성',
        status: 'Firebase Auth 기록',
        href: null,
      }]
    : []
  return { account, post: posts, comment: comments, submission: submissionItems, event: eventItems }
}

export const listAdminMemberActivity = onCall({ region: REGION }, async (request) => {
  const operatorUid = requireMemberReader(request.auth)
  const memberId = memberIdFrom(request.data)
  const reason = reasonFrom(request.data)
  const limit = numberLimit(request.data?.limit, TIMELINE_PAGE_LIMIT)
  const cursor = decodeActivityCursor(request.data?.cursor)
  const source = await sourceForMemberId(memberId)
  const sources = await timelineSources(source, cursor)
  for (const [kind, items] of Object.entries(sources) as Array<[TimelineKind, MemberActivityItem[]]>) {
    sources[kind] = items.filter((item) => activityPositionAfter(item, cursor[kind]))
  }
  const page = mergeActivityPage(sources, cursor, limit)
  await auditMemberRead('members.activity_viewed', operatorUid, {
    memberId,
    reason,
    resultCount: page.items.length,
  })
  return {
    items: page.items.map((item) => ({
      ...item,
      occurredAt: new Date(item.occurredAtMs).toISOString(),
    })),
    nextCursor: page.hasMore ? encodeActivityCursor(page.positions) : null,
    collectionScope: '기존 서버 기록의 생성 사건과 현재 상태',
    notCollected: ['마지막 접속', '유입 경로', '페이지 열람', '체류', '클릭', '다운로드 완료'],
  }
})

export const getAdminMemberPrivateDetails = onCall({ region: REGION }, async (request) => {
  const operatorUid = requireMemberReader(request.auth, true)
  const memberId = memberIdFrom(request.data)
  const reason = reasonFrom(request.data)
  const handle = await resolveHandle(memberId)
  if (!handle) throw new HttpsError('not-found', '회원을 찾을 수 없습니다')
  const snapshot = await getFirestore().collection('memberProfiles').doc(handle.uid).get()
  const field = (name: string) => {
    const value = snapshot.get(name)
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  await auditMemberRead('members.private_viewed', operatorUid, { memberId, reason })
  return {
    details: {
      realName: field('realName'),
      organization: field('organization'),
      email: field('email'),
      phone: field('phone'),
      verification: 'member_supplied_unverified',
    },
  }
})
