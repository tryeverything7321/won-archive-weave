import assert from 'node:assert/strict'
import test from 'node:test'
import { instagramConfigured } from './instagram-functions.js'

test('runtime configuration reports false unless every named setting is present', () => {
  assert.equal(instagramConfigured({}), false)
  assert.equal(instagramConfigured({
    appId: 'app-id',
    appSecret: 'app-secret',
    accessToken: 'access-token',
    accountId: 'account-id',
    apiVersion: 'v24.0',
  }), true)
  assert.equal(instagramConfigured({
    appId: 'app-id',
    appSecret: 'app-secret',
    accessToken: '',
    accountId: 'account-id',
    apiVersion: 'v24.0',
  }), false)
})
