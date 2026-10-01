import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coordinatePreviewConversion,
  previewLeaseDecision,
} from './preview-coordination.js'

test('preview leases wait for a live owner and recover after expiry', () => {
  assert.equal(previewLeaseDecision({ ownerToken: 'owner', expiresAtMs: 2_000, nowMs: 1_999 }), 'wait')
  assert.equal(previewLeaseDecision({ ownerToken: 'owner', expiresAtMs: 2_000, nowMs: 2_000 }), 'acquire')
  assert.equal(previewLeaseDecision({ expiresAtMs: 2_000, nowMs: 1_000 }), 'acquire')
})

test('same-instance preview requests coalesce to one conversion', async () => {
  let exists = false
  let conversions = 0
  const dependencies = {
    acquire: async () => true,
    release: async () => undefined,
    cacheExists: async () => exists,
    wait: async () => undefined,
    now: () => 1_000,
  }
  const request = () => coordinatePreviewConversion({
    cachePath: 'document-previews-v1/material/hash.pdf',
    cacheExists: dependencies.cacheExists,
    dependencies,
    convertAndSave: async () => {
      conversions += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      exists = true
    },
  })
  await Promise.all(Array.from({ length: 20 }, request))
  assert.equal(conversions, 1)
})

test('a waiting instance uses the completed cache without a second conversion', async () => {
  let exists = false
  let now = 1_000
  let conversions = 0
  await coordinatePreviewConversion({
    cachePath: 'document-previews-v1/material/remote.pdf',
    cacheExists: async () => exists,
    convertAndSave: async () => { conversions += 1 },
    dependencies: {
      acquire: async () => false,
      release: async () => undefined,
      cacheExists: async () => exists,
      wait: async () => { now += 500; exists = true },
      now: () => now,
    },
  })
  assert.equal(conversions, 0)
})
