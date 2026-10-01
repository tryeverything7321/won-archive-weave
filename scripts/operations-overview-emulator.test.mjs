import test from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore, Timestamp } from '../functions/node_modules/firebase-admin/lib/firestore/index.js'
import { getOperationsOverview, listOperationsQueue, operationsSourceQuery } from '../functions/lib/operations/overview.js'

const enabled = process.env.GCLOUD_PROJECT === 'demo-weave-rules' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:18080'
test('overview aggregate counts and paged queue agree for open, urgent and overdue work', { skip: !enabled }, async () => {
  const db = getFirestore()
  const tag = `synthetic-overview-${Date.now()}`
  const now = Date.now()
  const samples = [
    ['reports', 'received', now - 1000],
    ['reports', 'urgent_review', now - 25 * 3600000],
    ['moderationAppeals', 'received', now - 1000],
    ['submissionOperatorExceptions', 'open', now - 25 * 3600000],
    ['reports', 'resolved', now - 1000],
    ['reports', 'received', now + 3600000],
  ]
  const refs = samples.map(([collection], index) => db.collection(collection).doc(`${tag}-${index}`))
  const auth = { uid: 'synthetic-operator', token: { role: 'administrator' } }
  try {
    await Promise.all(samples.map(([, status, time], index) => refs[index].set({ status, createdAt: Timestamp.fromMillis(time) })))
    await assert.rejects(getOperationsOverview.run({ data: {}, auth: undefined }), e => e.code === 'unauthenticated')
    await assert.rejects(getOperationsOverview.run({ data: {}, auth: { uid: 'synthetic-member', token: {} } }), e => e.code === 'permission-denied')
    const overview = await getOperationsOverview.run({ auth, data: {} })
    for (const source of ['report', 'appeal', 'submission']) {
      const count = await operationsSourceQuery(source, { type: source, priority: 'all' }, overview.asOfMs).count().get()
      assert.equal(overview.counts[source], count.data().count)
    }
    assert.equal(overview.counts.all, overview.counts.report + overview.counts.appeal + overview.counts.submission)
    assert.ok(overview.counts.urgent >= 1)
    assert.ok(overview.counts.overdue >= 2)
    const found = new Set()
    let cursor = null
    do {
      const page = await listOperationsQueue.run({ auth, data: { type: 'all', priority: 'all', limit: 2, cursor } })
      page.items.forEach(item => found.add(item.id))
      cursor = page.nextCursor
    } while (cursor)
    for (let index = 0; index < 4; index++) assert.ok(found.has(refs[index].id))
    assert.ok(!found.has(refs[4].id))
    assert.ok(!found.has(refs[5].id))
  } finally {
    await Promise.all(refs.map(ref => ref.delete()))
  }
})
