import assert from 'node:assert/strict'
import test from 'node:test'
import {
  expireUploadReservationCapacity,
  fulfillUploadReservationCapacity,
  maximumAccountUploadBytes,
  maximumConcurrentUploadReservations,
  maximumReservedUploadBytes,
  normalizedUploadReservationUsage,
  reserveUploadCapacity,
  uploadReservationIsActive,
} from './upload-reservation.js'

test('upload reservations enforce concurrent, active byte and cumulative account limits', () => {
  const empty = normalizedUploadReservationUsage(undefined, 1_000)
  assert.deepEqual(reserveUploadCapacity({ usage: empty, requestedBytes: 20 }), {
    activeCount: 1, activeBytes: 20, committedBytes: 0, windowStartedAtMs: 1_000,
  })
  assert.throws(() => reserveUploadCapacity({
    usage: { activeCount: maximumConcurrentUploadReservations, activeBytes: 3, committedBytes: 0, windowStartedAtMs: 1_000 },
    requestedBytes: 1,
  }), /too_many/)
  assert.throws(() => reserveUploadCapacity({
    usage: { activeCount: 1, activeBytes: maximumReservedUploadBytes, committedBytes: 0, windowStartedAtMs: 1_000 },
    requestedBytes: 1,
  }), /reserved_upload_bytes/)
  assert.throws(() => reserveUploadCapacity({
    usage: { activeCount: 0, activeBytes: 0, committedBytes: maximumAccountUploadBytes, windowStartedAtMs: 1_000 },
    requestedBytes: 1,
  }), /account_upload_bytes/)
})

test('replacement, fulfillment and expiry update quota once without loosening limits', () => {
  const replaced = reserveUploadCapacity({
    usage: { activeCount: 2, activeBytes: 30, committedBytes: 40, windowStartedAtMs: 1_000 },
    requestedBytes: 12,
    replacingBytes: 10,
  })
  assert.deepEqual(replaced, { activeCount: 2, activeBytes: 32, committedBytes: 40, windowStartedAtMs: 1_000 })
  assert.deepEqual(fulfillUploadReservationCapacity(replaced, 12), {
    activeCount: 1, activeBytes: 20, committedBytes: 52, windowStartedAtMs: 1_000,
  })
  assert.deepEqual(expireUploadReservationCapacity(replaced, 12), {
    activeCount: 1, activeBytes: 20, committedBytes: 40, windowStartedAtMs: 1_000,
  })
})

test('the cumulative account byte limit resets after its fixed 24 hour window', () => {
  assert.deepEqual(normalizedUploadReservationUsage({
    activeCount: 1, activeBytes: 20, committedBytes: 400, windowStartedAtMs: 1_000,
  }, 1_000 + 24 * 60 * 60 * 1_000), {
    activeCount: 1, activeBytes: 20, committedBytes: 0,
    windowStartedAtMs: 1_000 + 24 * 60 * 60 * 1_000,
  })
})

test('reservation activity requires active status and a future expiry', () => {
  assert.equal(uploadReservationIsActive({ status: 'active', expiresAtMs: 2_000, nowMs: 1_999 }), true)
  assert.equal(uploadReservationIsActive({ status: 'active', expiresAtMs: 2_000, nowMs: 2_000 }), false)
  assert.equal(uploadReservationIsActive({ status: 'fulfilled', expiresAtMs: 3_000, nowMs: 2_000 }), false)
})
