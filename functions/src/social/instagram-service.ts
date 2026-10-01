export type InstagramConnectionStatus = 'active' | 'expired' | 'private' | 'disconnected' | 'rate_limited'

export type InstagramConnection = {
  id: string
  ownerUid: string
  accountId: string
  accountName: string
  tokenReference: string
  consentVersion: string
  consentedAtMs: number
  status: InstagramConnectionStatus
  disconnectedAtMs?: number
  lastSyncAttemptAtMs?: number
  lastSuccessfulSyncAtMs?: number
  nextSyncAtMs?: number
  syncCursor?: string
  syncCycleSeenProviderIds?: string[]
}

export type InstagramMedia = {
  providerId: string
  permalink: string
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  caption?: string
  mediaUrl?: string
  thumbnailUrl?: string
  publishedAtMs: number
  deleted?: boolean
}

export type SocialImportReviewStatus = 'pending_review' | 'approved' | 'rejected'
export type SocialImportSourceStatus = 'active' | 'deleted' | 'missing' | 'private' | 'disconnected'

export type SocialImport = InstagramMedia & {
  connectionId: string
  attribution: string
  reviewStatus: SocialImportReviewStatus
  sourceStatus: SocialImportSourceStatus
  visible: boolean
  importedAtMs: number
  lastSeenAtMs: number
  reviewedAtMs?: number
  reviewerUid?: string
}

export type InstagramApiResult =
  | { kind: 'ok'; accountId: string; accountName: string; media: InstagramMedia[]; nextCursor?: string; snapshotComplete?: boolean }
  | { kind: 'expired' }
  | { kind: 'private' }
  | { kind: 'rate_limited'; retryAtMs: number }

export interface OfficialInstagramApi {
  sync(input: { tokenReference: string; accountId: string; cursor?: string }): Promise<InstagramApiResult>
  revoke(input: { tokenReference: string }): Promise<void>
}

export interface InstagramRepository {
  saveConnection(connection: InstagramConnection): Promise<void>
  getImports(connectionId: string): Promise<SocialImport[]>
  saveImports(connectionId: string, imports: SocialImport[]): Promise<void>
}

export class InstagramPolicyError extends Error {
  constructor(public readonly code: 'consent_required' | 'not_owner' | 'inactive_connection' | 'provider_mismatch' | 'inactive_source') {
    super(code)
  }
}

export function connectOfficialInstagram(input: {
  id: string
  ownerUid: string
  accountId: string
  accountName: string
  tokenReference: string
  consentVersion: string
  consentedAtMs: number
}): InstagramConnection {
  if (!input.consentVersion.trim() || !input.tokenReference.trim() || !input.accountId.trim()) throw new InstagramPolicyError('consent_required')
  return { ...input, status: 'active' }
}

function reviewStatus(item: Partial<SocialImport> | undefined): SocialImportReviewStatus {
  return item?.reviewStatus === 'approved' || item?.reviewStatus === 'rejected'
    ? item.reviewStatus
    : 'pending_review'
}

function hideImports(
  imports: SocialImport[],
  sourceStatus: Exclude<SocialImportSourceStatus, 'active' | 'deleted' | 'missing'>,
  now: number,
): SocialImport[] {
  return imports.map((item) => ({ ...item, sourceStatus, visible: false, lastSeenAtMs: now }))
}

function uniqueMedia(media: InstagramMedia[]): InstagramMedia[] {
  const byProviderId = new Map<string, InstagramMedia>()
  for (const item of media) {
    if (!byProviderId.has(item.providerId)) byProviderId.set(item.providerId, item)
  }
  return [...byProviderId.values()]
}

export function reviewSocialImport(
  item: SocialImport,
  input: { decision: 'approve' | 'reject' | 'reset'; reviewerUid: string; nowMs: number },
): SocialImport {
  if (input.decision === 'approve' && item.sourceStatus !== 'active') {
    throw new InstagramPolicyError('inactive_source')
  }
  const reviewStatus: SocialImportReviewStatus = input.decision === 'approve'
    ? 'approved'
    : input.decision === 'reject'
      ? 'rejected'
      : 'pending_review'
  const reviewed = {
    ...item,
    reviewStatus,
    visible: reviewStatus === 'approved' && item.sourceStatus === 'active',
    ...(input.decision === 'reset' ? {} : { reviewedAtMs: input.nowMs, reviewerUid: input.reviewerUid }),
  }
  if (input.decision === 'reset') {
    delete reviewed.reviewedAtMs
    delete reviewed.reviewerUid
  }
  return reviewed
}

export async function syncOfficialInstagram(
  connection: InstagramConnection,
  dependencies: { api: OfficialInstagramApi; repository: InstagramRepository; now: () => number },
): Promise<{ connection: InstagramConnection; imported: number; updated: number; hidden: number }> {
  if (connection.status === 'disconnected') throw new InstagramPolicyError('inactive_connection')
  const now = dependencies.now()
  const response = await dependencies.api.sync({
    tokenReference: connection.tokenReference,
    accountId: connection.accountId,
    ...(connection.syncCursor ? { cursor: connection.syncCursor } : {}),
  })
  if (response.kind !== 'ok') {
    const status: InstagramConnectionStatus = response.kind === 'expired' ? 'expired' : response.kind === 'private' ? 'private' : 'rate_limited'
    const updated: InstagramConnection = {
      ...connection,
      status,
      lastSyncAttemptAtMs: now,
      ...(response.kind === 'rate_limited' ? { nextSyncAtMs: response.retryAtMs } : {}),
    }
    if (response.kind !== 'rate_limited') delete updated.nextSyncAtMs
    await dependencies.repository.saveConnection(updated)
    if (response.kind === 'private') {
      const hidden = hideImports(await dependencies.repository.getImports(connection.id), 'private', now)
      await dependencies.repository.saveImports(connection.id, hidden)
      return { connection: updated, imported: 0, updated: 0, hidden: hidden.length }
    }
    return { connection: updated, imported: 0, updated: 0, hidden: 0 }
  }
  if (response.accountId !== connection.accountId) throw new InstagramPolicyError('provider_mismatch')

  const existing = await dependencies.repository.getImports(connection.id)
  const existingById = new Map(existing.map((item) => [item.providerId, item]))
  const media = uniqueMedia(response.media)
  const cycleSeen = new Set(connection.syncCursor ? connection.syncCycleSeenProviderIds ?? [] : [])
  for (const item of media) cycleSeen.add(item.providerId)
  const canCompleteSnapshot = response.snapshotComplete && cycleSeen.size <= 400
  let imported = 0
  let updatedCount = 0
  const merged: SocialImport[] = media.map((item) => {
    const previous = existingById.get(item.providerId)
    if (previous) updatedCount += 1
    else imported += 1
    const sourceStatus: SocialImportSourceStatus = item.deleted ? 'deleted' : 'active'
    const nextReviewStatus = reviewStatus(previous)
    return {
      ...previous,
      ...item,
      connectionId: connection.id,
      attribution: `Instagram @${response.accountName}`,
      reviewStatus: nextReviewStatus,
      sourceStatus,
      visible: nextReviewStatus === 'approved' && sourceStatus === 'active',
      importedAtMs: previous?.importedAtMs ?? now,
      lastSeenAtMs: now,
    }
  })
  for (const item of existing) {
    if (!media.some((mediaItem) => mediaItem.providerId === item.providerId)) {
      merged.push(canCompleteSnapshot && !cycleSeen.has(item.providerId)
        ? { ...item, sourceStatus: 'missing', visible: false, lastSeenAtMs: now }
        : item)
    }
  }
  const updated: InstagramConnection = {
    ...connection,
    accountName: response.accountName,
    status: 'active' as const,
    lastSyncAttemptAtMs: now,
    lastSuccessfulSyncAtMs: now,
    ...(response.nextCursor ? { syncCursor: response.nextCursor } : {}),
    ...(response.nextCursor && cycleSeen.size <= 400 ? { syncCycleSeenProviderIds: [...cycleSeen] } : {}),
  }
  delete updated.nextSyncAtMs
  if (!response.nextCursor) delete updated.syncCursor
  if (!response.nextCursor || cycleSeen.size > 400) delete updated.syncCycleSeenProviderIds
  await dependencies.repository.saveImports(connection.id, merged)
  await dependencies.repository.saveConnection(updated)
  return {
    connection: updated,
    imported,
    updated: updatedCount,
    hidden: merged.filter((item) => item.sourceStatus !== 'active').length,
  }
}

export async function disconnectOfficialInstagram(
  connection: InstagramConnection,
  actorUid: string,
  dependencies: { api: OfficialInstagramApi; repository: InstagramRepository; now: () => number },
): Promise<InstagramConnection> {
  if (connection.ownerUid !== actorUid) throw new InstagramPolicyError('not_owner')
  await dependencies.api.revoke({ tokenReference: connection.tokenReference })
  const now = dependencies.now()
  const imports = hideImports(await dependencies.repository.getImports(connection.id), 'disconnected', now)
  const disconnected: InstagramConnection = {
    ...connection,
    status: 'disconnected' as const,
    disconnectedAtMs: now,
    lastSyncAttemptAtMs: now,
    tokenReference: '',
  }
  delete disconnected.nextSyncAtMs
  delete disconnected.syncCursor
  delete disconnected.syncCycleSeenProviderIds
  await dependencies.repository.saveImports(connection.id, imports)
  await dependencies.repository.saveConnection(disconnected)
  return disconnected
}
