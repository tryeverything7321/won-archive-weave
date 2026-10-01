import assert from 'node:assert/strict'
import test from 'node:test'
import { exchangeProviderCode } from './oauth.js'

test('the production Naver adapter requests only the stable app-specific identifier', async () => {
  const requests: Array<{ url: string; body?: string }> = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, body: typeof init?.body === 'string' ? init.body : init?.body?.toString() })
    if (url.includes('/token')) {
      return new Response(JSON.stringify({ access_token: 'access-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      response: {
        id: 'stable-naver-subject',
        nickname: 'must-not-be-retained',
        name: 'must-not-be-retained',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const identity = await exchangeProviderCode('naver', {
    code: 'authorization-code',
    state: 'state-value',
    redirectUri: 'https://weave.example/oauth/naver/callback',
  }, fetcher, {
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })

  assert.deepEqual(identity, { subject: 'stable-naver-subject' })
  assert.equal('displayName' in identity, false)
  assert.match(requests[0]?.body ?? '', /state=state-value/)
  assert.equal(requests[1]?.url, 'https://openapi.naver.com/v1/nid/me')
})

test('the production Kakao adapter returns the stable identifier without profile fields', async () => {
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'access-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      id: 123456,
      properties: { nickname: 'must-not-be-retained' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const identity = await exchangeProviderCode('kakao', {
    code: 'authorization-code',
    state: 'state-value',
    redirectUri: 'https://weave.example/oauth/kakao/callback',
  }, fetcher, {
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })

  assert.deepEqual(identity, { subject: '123456' })
  assert.equal('displayName' in identity, false)
})
