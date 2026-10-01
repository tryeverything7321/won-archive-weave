import assert from 'node:assert/strict'
import test from 'node:test'
import { platformStatus } from './platform.js'

test('platform status marks external AI as deferred', () => {
  const status = platformStatus()
  assert.equal(status.service, 'won-youth-archive')
  assert.equal(status.capabilities.externalAi, 'deferred')
})
