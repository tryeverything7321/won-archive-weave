import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { Timestamp } from 'firebase-admin/firestore'
import {
  cleanupExpiredUploadReservations,
  normalizeUploadSelection,
  prepareSubmissionUploads,
  recordUploadedReservationObject,
  selectedUploadNames,
  uploadSelectionFingerprint,
} from './upload-selection.js'

const file = { name: '회의록.txt', size: 24, contentType: 'text/plain', sha256: 'a'.repeat(64) }
test('upload selection uses bounded flat unique paths and stable descriptor fingerprints', () => {
  const value = normalizeUploadSelection({ requestId: 'upload-request-001', files: [file] })
  assert.match(value.files[0].targetName, /^u[a-f0-9]{24}--회의록\.txt$/)
  assert.deepEqual(selectedUploadNames(value), [value.files[0].targetName])
  assert.equal(uploadSelectionFingerprint(value), uploadSelectionFingerprint(normalizeUploadSelection({ requestId: value.requestId, files: [file] })))
  assert.notEqual(uploadSelectionFingerprint(value), uploadSelectionFingerprint(normalizeUploadSelection({ requestId: value.requestId, files: [{ ...file, sha256: 'b'.repeat(64) }] })))
})

test('expired upload reservations remove only their selected orphan paths and release active quota', {
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
    ownerUid: uid,
    submissionId,
    requestId: `upload_${randomUUID()}`,
    fingerprint: 'fingerprint',
    status: 'active',
    totalBytes: 4,
    expiresAtMs: Date.now() - 1_000,
    cleanupDueAt: Timestamp.fromMillis(Date.now() - 1_000),
    files: {
      [targetName]: {
        name: 'orphan.txt', targetName, size: 4, contentType: 'text/plain', sha256: 'a'.repeat(64), reconciled: false,
      },
    },
  })
  const fileRef = getStorage().bucket().file(path)
  await fileRef.save(Buffer.from('test'), { resumable: false, metadata: { contentType: 'text/plain' } })
  assert.equal((await fileRef.exists())[0], true)

  await cleanupExpiredUploadReservations.run({} as never)

  assert.equal((await fileRef.exists())[0], false)
  assert.equal((await firestore.collection('uploadReservations').doc(reservationId).get()).get('status'), 'expired')
  const usage = await firestore.collection('uploadReservationUsage').doc(uid).get()
  assert.equal(usage.get('activeCount'), 0)
  assert.equal(usage.get('activeBytes'), 0)
})
test('upload selection rejects traversal, unknown descriptors, oversized files and malformed stored state', () => {
  for (const patch of [{ name: '../x.txt' }, { size: 0 }, { size: '24' }, { size: 21 * 1024 * 1024 }, { sha256: 'fake' }]) {
    assert.throws(() => normalizeUploadSelection({ requestId: 'upload-request-001', files: [{ ...file, ...patch }] }))
  }
  assert.throws(() => normalizeUploadSelection({ requestId: 'upload-request-001', files: [] }))
  assert.throws(() => normalizeUploadSelection({ requestId: 'upload-request-001', files: [file, file, file] }))
  assert.equal(selectedUploadNames(undefined), undefined)
  assert.throws(() => selectedUploadNames({ requestId: 'invalid', files: [] }))
})

test('Firestore reservations are replay-safe and account capacity is committed exactly once', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  const firestore = getFirestore()
  const uid = `upload-${randomUUID()}`
  const submissionId = `submission-${randomUUID()}`
  await firestore.collection('users').doc(uid).set({
    connected: true,
    termsVersion: '2026-07-20',
    communityRulesVersion: '2026-07-20',
  })
  await firestore.collection('submissions').doc(submissionId).set({
    ownerUid: uid, sourceMode: 'upload', status: 'draft',
  })
  const data = {
    submissionId,
    requestId: `upload_${randomUUID()}`,
    files: [{ ...file, name: '예약.txt' }],
  }
  const auth = { uid, token: {} }
  const [first, replay] = await Promise.all([
    prepareSubmissionUploads.run({ auth, data } as never),
    prepareSubmissionUploads.run({ auth, data } as never),
  ])
  assert.equal(first.reservationId, replay.reservationId)
  assert.equal(first.files[0]?.targetName, replay.files[0]?.targetName)
  const usageBefore = await firestore.collection('uploadReservationUsage').doc(uid).get()
  assert.equal(usageBefore.get('activeCount'), 1)
  assert.equal(usageBefore.get('activeBytes'), file.size)

  const targetName = first.files[0]?.targetName ?? ''
  const accepted = {
    ownerUid: uid,
    submissionId,
    targetName,
    size: file.size,
    contentType: file.contentType,
    reservationId: first.reservationId,
    requestId: data.requestId,
    sha256: file.sha256,
  }
  assert.equal(await recordUploadedReservationObject(accepted), true)
  assert.equal(await recordUploadedReservationObject(accepted), true)
  const usageAfter = await firestore.collection('uploadReservationUsage').doc(uid).get()
  assert.equal(usageAfter.get('activeCount'), 0)
  assert.equal(usageAfter.get('activeBytes'), 0)
  assert.equal(usageAfter.get('committedBytes'), file.size)
  assert.equal((await firestore.collection('uploadReservations').doc(first.reservationId).get()).get('status'), 'fulfilled')

  await assert.rejects(
    prepareSubmissionUploads.run({ auth, data: { ...data, files: [{ ...data.files[0], sha256: 'b'.repeat(64) }] } } as never),
    (error: { code?: string }) => error.code === 'already-exists',
  )
})
