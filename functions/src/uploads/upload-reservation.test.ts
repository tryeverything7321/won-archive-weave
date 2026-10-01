import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
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
import {
  cleanupExpiredUploadReservations,
  prepareSubmissionUploads,
  recordUploadedReservationObject,
} from './upload-selection.js'

const reservationFile = { name: '회의록.txt', size: 24, contentType: 'text/plain', sha256: 'a'.repeat(64) }

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

test('Firestore reservations are replay-safe and account capacity is committed exactly once', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  const firestore = getFirestore()
  const uid = `upload-${randomUUID()}`
  const submissionId = `submission-${randomUUID()}`
  await firestore.collection('users').doc(uid).set({
    connected: true, termsVersion: '2026-07-20', communityRulesVersion: '2026-07-20',
  })
  await firestore.collection('submissions').doc(submissionId).set({ ownerUid: uid, sourceMode: 'upload', status: 'draft' })
  const data = {
    submissionId, requestId: `upload_${randomUUID()}`,
    files: [{ ...reservationFile, name: '예약.txt' }],
  }
  const auth = { uid, token: {} }
  const [first, replay] = await Promise.all([
    prepareSubmissionUploads.run({ auth, data } as never),
    prepareSubmissionUploads.run({ auth, data } as never),
  ])
  assert.equal(first.reservationId, replay.reservationId)
  const usageBefore = await firestore.collection('uploadReservationUsage').doc(uid).get()
  assert.equal(usageBefore.get('activeCount'), 1)
  assert.equal(usageBefore.get('activeBytes'), reservationFile.size)
  const accepted = {
    ownerUid: uid, submissionId, targetName: first.files[0]?.targetName ?? '', size: reservationFile.size,
    contentType: reservationFile.contentType, reservationId: first.reservationId,
    requestId: data.requestId, sha256: reservationFile.sha256,
  }
  assert.equal(await recordUploadedReservationObject(accepted), true)
  assert.equal(await recordUploadedReservationObject(accepted), true)
  const usageAfter = await firestore.collection('uploadReservationUsage').doc(uid).get()
  assert.equal(usageAfter.get('activeCount'), 0)
  assert.equal(usageAfter.get('committedBytes'), reservationFile.size)
  await assert.rejects(
    prepareSubmissionUploads.run({ auth, data: { ...data, files: [{ ...data.files[0], sha256: 'b'.repeat(64) }] } } as never),
    (error: { code?: string }) => error.code === 'already-exists',
  )
})

test('expired reservations delete selected orphan paths and release active quota', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST,
}, async () => {
  const firestore = getFirestore()
  const uid = `expired-${randomUUID()}`
  const submissionId = `submission-${randomUUID()}`
  const reservationId = randomUUID().replaceAll('-', '')
  const targetName = 'u123456789012345678901234--orphan.txt'
  const path = `quarantined/${uid}/${submissionId}/${targetName}`
  await firestore.collection('uploadReservationUsage').doc(uid).set({ activeCount: 1, activeBytes: 4, committedBytes: 0 })
  await firestore.collection('uploadReservations').doc(reservationId).set({
    ownerUid: uid, submissionId, requestId: `upload_${randomUUID()}`, fingerprint: 'fingerprint',
    status: 'active', totalBytes: 4, expiresAtMs: Date.now() - 1_000,
    cleanupDueAt: Timestamp.fromMillis(Date.now() - 1_000),
    files: {
      [targetName]: {
        name: 'orphan.txt', targetName, size: 4, contentType: 'text/plain', sha256: 'a'.repeat(64), reconciled: false,
      },
    },
  })
  const fileRef = getStorage().bucket().file(path)
  await fileRef.save(Buffer.from('test'), { resumable: false, metadata: { contentType: 'text/plain' } })
  await cleanupExpiredUploadReservations.run({} as never)
  assert.equal((await fileRef.exists())[0], false)
  assert.equal((await firestore.collection('uploadReservations').doc(reservationId).get()).get('status'), 'expired')
  const usage = await firestore.collection('uploadReservationUsage').doc(uid).get()
  assert.equal(usage.get('activeCount'), 0)
  assert.equal(usage.get('activeBytes'), 0)
})
