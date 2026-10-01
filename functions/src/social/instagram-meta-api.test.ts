import assert from 'node:assert/strict'
import test from 'node:test'
import { MetaInstagramGraphApi, MetaInstagramTransportError, validateMetaInstagramSettings } from './instagram-meta-api.js'

const settings = {
  appId: '1234567890',
  appSecret: 'test-app-secret',
  accessToken: 'test-access-token',
  accountId: '17841400000000000',
  apiVersion: 'v24.0',
}

test('configuration requires every runtime value and a fixed API version and account ID', () => {
  assert.equal(validateMetaInstagramSettings(settings).accountId, settings.accountId)
  assert.throws(() => validateMetaInstagramSettings({ ...settings, accessToken: '' }), (error: MetaInstagramTransportError) => error.code === 'not_configured')
  assert.throws(() => validateMetaInstagramSettings({ ...settings, apiVersion: 'latest' }), (error: MetaInstagramTransportError) => error.code === 'invalid_configuration')
})

test('identity request keeps the token out of the URL', async () => {
  let requestUrl = ''
  let authorization = ''
  const api = new MetaInstagramGraphApi(settings, async (input, init) => {
    requestUrl = input.toString()
    authorization = new Headers(init?.headers).get('authorization') ?? ''
    return Response.json({ id: settings.accountId, username: 'won_buddhism_youth' })
  })
  const identity = await api.identify()
  assert.equal(identity.accountName, 'won_buddhism_youth')
  assert.equal(new URL(requestUrl).searchParams.has('access_token'), false)
  assert.equal(authorization, `Bearer ${settings.accessToken}`)
  assert.ok(new URL(requestUrl).searchParams.has('appsecret_proof'))
})

test('media sync validates source rows and persists the next cursor', async () => {
  const requests: string[] = []
  const api = new MetaInstagramGraphApi(settings, async (input) => {
    const url = input.toString()
    requests.push(url)
    if (url.includes('/media?')) {
      return Response.json({
        data: [
          {
            id: '18000000000000001',
            caption: '청년 정기훈련',
            media_type: 'IMAGE',
            media_url: 'https://scontent.example/image.jpg',
            permalink: 'https://www.instagram.com/p/example/',
            thumbnail_url: 'https://scontent.example/thumb.jpg',
            timestamp: '2026-07-22T01:02:03+0000',
          },
          { id: 'invalid', media_type: 'IMAGE', permalink: 'https://evil.example/post', timestamp: 'invalid' },
        ],
        paging: { cursors: { after: 'cursor-2' }, next: 'https://graph.facebook.com/next' },
      })
    }
    return Response.json({ id: settings.accountId, username: 'won_buddhism_youth' })
  })
  const result = await api.sync({ tokenReference: 'secret://META_INSTAGRAM_ACCESS_TOKEN', accountId: settings.accountId, cursor: 'cursor-1' })
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.media.length, 1)
  assert.equal(result.nextCursor, 'cursor-2')
  assert.equal(result.snapshotComplete, false)
  assert.equal(new URL(requests[0] ?? '').searchParams.get('after'), 'cursor-1')
})

test('the final page is marked as a complete snapshot', async () => {
  const api = new MetaInstagramGraphApi(settings, async (input) => input.toString().includes('/media?')
    ? Response.json({ data: [] })
    : Response.json({ id: settings.accountId, username: 'won_buddhism_youth' }))
  const result = await api.sync({ tokenReference: 'secret://META_INSTAGRAM_ACCESS_TOKEN', accountId: settings.accountId })
  assert.equal(result.kind === 'ok' && result.snapshotComplete, true)
  const finalCursorPage = await api.sync({ tokenReference: 'secret://META_INSTAGRAM_ACCESS_TOKEN', accountId: settings.accountId, cursor: 'cursor-1' })
  assert.equal(finalCursorPage.kind === 'ok' && finalCursorPage.snapshotComplete, true)
})

test('provider failures map to expiry, privacy and retry states without response details', async () => {
  const expired = new MetaInstagramGraphApi(settings, async () => Response.json({ error: { code: 190, message: 'secret provider detail' } }, { status: 401 }))
  assert.equal((await expired.sync({ tokenReference: 'secret://META_INSTAGRAM_ACCESS_TOKEN', accountId: settings.accountId })).kind, 'expired')
  const privateApi = new MetaInstagramGraphApi(settings, async () => Response.json({ error: { code: 10 } }, { status: 403 }))
  assert.equal((await privateApi.sync({ tokenReference: 'secret://META_INSTAGRAM_ACCESS_TOKEN', accountId: settings.accountId })).kind, 'private')
  const limited = new MetaInstagramGraphApi(settings, async () => Response.json({ error: { code: 4 } }, { status: 429, headers: { 'retry-after': '60' } }), () => 1_000)
  const limitedResult = await limited.sync({ tokenReference: 'secret://META_INSTAGRAM_ACCESS_TOKEN', accountId: settings.accountId })
  assert.deepEqual(limitedResult, { kind: 'rate_limited', retryAtMs: 61_000 })
})

test('revocation accepts an already-expired token but rejects other failures', async () => {
  const expired = new MetaInstagramGraphApi(settings, async () => Response.json({ error: { code: 190 } }, { status: 400 }))
  await expired.revoke({ tokenReference: 'secret://META_INSTAGRAM_ACCESS_TOKEN' })
  const unavailable = new MetaInstagramGraphApi(settings, async () => Response.json({ error: { code: 1 } }, { status: 500 }))
  await assert.rejects(unavailable.revoke({ tokenReference: 'secret://META_INSTAGRAM_ACCESS_TOKEN' }), (error: MetaInstagramTransportError) => error.code === 'provider_unavailable')
})
