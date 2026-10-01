import assert from 'node:assert/strict'
import test from 'node:test'
import {
  InstagramPolicyError,
  connectOfficialInstagram,
  disconnectOfficialInstagram,
  reviewSocialImport,
  syncOfficialInstagram,
  type InstagramApiResult,
  type InstagramConnection,
  type OfficialInstagramApi,
  type SocialImport,
} from './instagram-service.js'

const connection = connectOfficialInstagram({
  id: 'connection-1', ownerUid: 'owner-1', accountId: 'official-1', accountName: 'weave', tokenReference: 'vault://token-1', consentVersion: '2026-07', consentedAtMs: 500,
})

function imported(overrides: Partial<SocialImport> = {}): SocialImport {
  return {
    providerId: 'p1',
    permalink: 'https://instagram.com/p/p1',
    mediaType: 'IMAGE',
    caption: '청년 정기훈련 기록',
    thumbnailUrl: 'https://cdn.example/p1-small.jpg',
    publishedAtMs: 100,
    connectionId: connection.id,
    attribution: 'Instagram @weave',
    reviewStatus: 'pending_review',
    sourceStatus: 'active',
    visible: false,
    importedAtMs: 500,
    lastSeenAtMs: 500,
    ...overrides,
  }
}

function harness(result: InstagramApiResult, initial: SocialImport[] = []) {
  let imports = initial
  let savedConnection: InstagramConnection = connection
  let revoked = false
  let syncInput: Parameters<OfficialInstagramApi['sync']>[0] | undefined
  return {
    state: () => ({ imports, savedConnection, revoked, syncInput }),
    dependencies: {
      now: () => 1_000,
      api: {
        async sync(input: Parameters<OfficialInstagramApi['sync']>[0]) { syncInput = input; return result },
        async revoke() { revoked = true },
      },
      repository: {
        async saveConnection(value: InstagramConnection) { savedConnection = value },
        async getImports() { return imports },
        async saveImports(_connectionId: string, value: SocialImport[]) { imports = value },
      },
    },
  }
}

const post = {
  providerId: 'p1',
  permalink: 'https://instagram.com/p/p1',
  mediaType: 'IMAGE' as const,
  caption: '청년 정기훈련 기록',
  thumbnailUrl: 'https://cdn.example/p1-small.jpg',
  publishedAtMs: 100,
}

test('connect requires explicit consent and keeps only an opaque token reference', () => {
  assert.equal(connection.status, 'active')
  assert.equal(connection.tokenReference, 'vault://token-1')
  assert.throws(() => connectOfficialInstagram({ ...connection, consentVersion: '' }), (error: InstagramPolicyError) => error.code === 'consent_required')
})

test('new imports preserve source metadata but remain private pending review', async () => {
  const flow = harness({ kind: 'ok', accountId: 'official-1', accountName: 'weave', media: [post] })
  const result = await syncOfficialInstagram(connection, flow.dependencies)
  const candidate = flow.state().imports[0]
  assert.equal(result.imported, 1)
  assert.equal(candidate?.caption, post.caption)
  assert.equal(candidate?.thumbnailUrl, post.thumbnailUrl)
  assert.equal(candidate?.permalink, post.permalink)
  assert.equal(candidate?.publishedAtMs, post.publishedAtMs)
  assert.equal(candidate?.reviewStatus, 'pending_review')
  assert.equal(candidate?.visible, false)
})

test('sync deduplicates provider IDs within one response', async () => {
  const flow = harness({
    kind: 'ok',
    accountId: 'official-1',
    accountName: 'weave',
    media: [post, { ...post, caption: '중복 응답' }],
  })
  const result = await syncOfficialInstagram(connection, flow.dependencies)
  assert.equal(result.imported, 1)
  assert.equal(flow.state().imports.length, 1)
  assert.equal(flow.state().imports[0]?.caption, post.caption)
})

test('review approval is explicit and survives a later source refresh', async () => {
  const approved = reviewSocialImport(imported(), { decision: 'approve', reviewerUid: 'moderator-1', nowMs: 700 })
  assert.equal(approved.visible, true)
  const flow = harness({ kind: 'ok', accountId: 'official-1', accountName: 'weave', media: [{ ...post, caption: '수정된 캡션' }] }, [approved])
  await syncOfficialInstagram(connection, flow.dependencies)
  assert.equal(flow.state().imports[0]?.reviewStatus, 'approved')
  assert.equal(flow.state().imports[0]?.visible, true)
  assert.equal(flow.state().imports[0]?.caption, '수정된 캡션')
})

test('deleted and missing originals are hidden without losing review history', async () => {
  const approved = reviewSocialImport(imported(), { decision: 'approve', reviewerUid: 'moderator-1', nowMs: 700 })
  const missing = imported({ providerId: 'missing', reviewStatus: 'approved', visible: true, reviewerUid: 'moderator-1', reviewedAtMs: 700 })
  const flow = harness({ kind: 'ok', accountId: 'official-1', accountName: 'weave', media: [{ ...post, deleted: true }], snapshotComplete: true }, [approved, missing])
  const result = await syncOfficialInstagram(connection, flow.dependencies)
  assert.equal(result.hidden, 2)
  assert.equal(flow.state().imports.find((item) => item.providerId === 'p1')?.sourceStatus, 'deleted')
  assert.equal(flow.state().imports.find((item) => item.providerId === 'missing')?.sourceStatus, 'missing')
  assert.ok(flow.state().imports.every((item) => item.reviewStatus === 'approved' && !item.visible))
})

test('a partial cursor page does not hide records that were not in that page', async () => {
  const older = imported({ providerId: 'older', reviewStatus: 'approved', visible: true })
  const flow = harness({ kind: 'ok', accountId: 'official-1', accountName: 'weave', media: [post], nextCursor: 'next-page' }, [older])
  await syncOfficialInstagram(connection, flow.dependencies)
  const preserved = flow.state().imports.find((item) => item.providerId === 'older')
  assert.equal(preserved?.sourceStatus, 'active')
  assert.equal(preserved?.visible, true)
})

test('a multi-page cycle hides missing records only after its final page', async () => {
  const older = imported({ providerId: 'older', reviewStatus: 'approved', visible: true })
  const firstPage = harness({ kind: 'ok', accountId: 'official-1', accountName: 'weave', media: [post], nextCursor: 'next-page' }, [older])
  const firstResult = await syncOfficialInstagram(connection, firstPage.dependencies)
  assert.deepEqual(firstResult.connection.syncCycleSeenProviderIds, ['p1'])
  assert.equal(firstPage.state().imports.find((item) => item.providerId === 'older')?.visible, true)

  const secondPost = { ...post, providerId: 'p2', permalink: 'https://instagram.com/p/p2' }
  const secondPage = harness({ kind: 'ok', accountId: 'official-1', accountName: 'weave', media: [secondPost], snapshotComplete: true }, firstPage.state().imports)
  const finalResult = await syncOfficialInstagram(firstResult.connection, secondPage.dependencies)
  assert.equal(finalResult.connection.syncCursor, undefined)
  assert.equal(finalResult.connection.syncCycleSeenProviderIds, undefined)
  assert.equal(secondPage.state().imports.find((item) => item.providerId === 'older')?.sourceStatus, 'missing')
  assert.equal(secondPage.state().imports.find((item) => item.providerId === 'p1')?.sourceStatus, 'active')
})

test('a private source hides every imported record', async () => {
  const flow = harness({ kind: 'private' }, [imported({ reviewStatus: 'approved', visible: true })])
  const result = await syncOfficialInstagram(connection, flow.dependencies)
  assert.equal(result.hidden, 1)
  assert.equal(flow.state().imports[0]?.sourceStatus, 'private')
  assert.equal(flow.state().imports[0]?.visible, false)
})

test('expiry and rate limits persist attempt state without advancing the cursor', async () => {
  const cursorConnection = { ...connection, syncCursor: 'cursor-1' }
  const expired = harness({ kind: 'expired' })
  const expiredResult = await syncOfficialInstagram(cursorConnection, expired.dependencies)
  assert.equal(expiredResult.connection.status, 'expired')
  assert.equal(expiredResult.connection.syncCursor, 'cursor-1')
  const limited = harness({ kind: 'rate_limited', retryAtMs: 9_000 })
  const limitedResult = await syncOfficialInstagram(cursorConnection, limited.dependencies)
  assert.equal(limited.state().syncInput?.cursor, 'cursor-1')
  assert.equal(limitedResult.connection.status, 'rate_limited')
  assert.equal(limitedResult.connection.nextSyncAtMs, 9_000)
  assert.equal(limitedResult.connection.syncCursor, 'cursor-1')
})

test('successful sync stores the next cursor and rejects a different provider account', async () => {
  const flow = harness({ kind: 'ok', accountId: 'official-1', accountName: 'weave', media: [post], nextCursor: 'cursor-2' })
  const result = await syncOfficialInstagram(connection, flow.dependencies)
  assert.equal(result.connection.syncCursor, 'cursor-2')
  assert.equal(result.connection.lastSuccessfulSyncAtMs, 1_000)
  const mismatch = harness({ kind: 'ok', accountId: 'other-account', accountName: 'other', media: [] })
  await assert.rejects(syncOfficialInstagram(connection, mismatch.dependencies), (error: InstagramPolicyError) => error.code === 'provider_mismatch')
})

test('inactive source cannot be approved', () => {
  assert.throws(
    () => reviewSocialImport(imported({ sourceStatus: 'deleted' }), { decision: 'approve', reviewerUid: 'moderator-1', nowMs: 700 }),
    (error: InstagramPolicyError) => error.code === 'inactive_source',
  )
})

test('disconnect is owner-only, revokes access, clears scheduling and hides imports', async () => {
  const active = { ...connection, syncCursor: 'cursor-1', nextSyncAtMs: 2_000 }
  const flow = harness({ kind: 'ok', accountId: 'official-1', accountName: 'weave', media: [] }, [imported({ reviewStatus: 'approved', visible: true })])
  await assert.rejects(disconnectOfficialInstagram(active, 'someone-else', flow.dependencies), (error: InstagramPolicyError) => error.code === 'not_owner')
  const result = await disconnectOfficialInstagram(active, 'owner-1', flow.dependencies)
  assert.equal(result.status, 'disconnected')
  assert.equal(result.tokenReference, '')
  assert.equal(result.syncCursor, undefined)
  assert.equal(result.nextSyncAtMs, undefined)
  assert.equal(flow.state().revoked, true)
  assert.equal(flow.state().imports[0]?.sourceStatus, 'disconnected')
  assert.equal(flow.state().imports[0]?.visible, false)
})
