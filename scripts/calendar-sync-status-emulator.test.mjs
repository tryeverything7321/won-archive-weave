import test from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore, Timestamp } from '../functions/node_modules/firebase-admin/lib/firestore/index.js'
import { syncGooglePublicCalendarSource } from '../functions/lib/calendar/external-calendar-functions.js'
const enabled = process.env.GCLOUD_PROJECT === 'demo-weave-rules' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:18080'
test('failed calendar fetch preserves last success; stale failure does not overwrite a newer success', { skip: !enabled }, async () => {
  const ref = getFirestore().collection('calendarSources').doc('synthetic-sync-status-' + Date.now())
  const oldFetch = globalThis.fetch
  const before = Timestamp.fromMillis(1000)
  const request = { auth: { uid: 'synthetic-admin', token: { role: 'administrator' } }, data: { sourceId: ref.id } }
  try {
    await ref.set({ status: 'active', sourceType: 'google_public_ics', feedUrl: 'https://calendar.google.com/calendar/ical/synthetic/public/basic.ics', connectionRevision: 'one', lastSyncAt: before, lastSyncCount: 7, lastSyncStatus: 'succeeded' })
    globalThis.fetch = async () => { throw new Error('synthetic network failure') }
    await assert.rejects(syncGooglePublicCalendarSource.run(request))
    let value = (await ref.get()).data()
    assert.equal(value.lastSyncStatus, 'failed')
    assert.equal(value.lastSyncAt.toMillis(), 1000)
    assert.equal(value.lastSyncCount, 7)
    assert.ok(value.lastSyncFailedAt)
    globalThis.fetch = async () => {
      await ref.update({ lastSyncAt: Timestamp.fromMillis(2000), lastSyncStatus: 'succeeded' })
      throw new Error('stale attempt failure')
    }
    await assert.rejects(syncGooglePublicCalendarSource.run(request))
    value = (await ref.get()).data()
    assert.equal(value.lastSyncStatus, 'succeeded')
    assert.equal(value.lastSyncAt.toMillis(), 2000)
  } finally { globalThis.fetch = oldFetch; await ref.delete() }
})
