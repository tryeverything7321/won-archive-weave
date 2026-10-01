import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { FieldPath, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { operationsSourceQuery } from './overview.js'
import { OPERATIONS_OVERDUE_MS, type OperationsQueueSource } from './overview-model.js'

test('overview aggregation and queue queries match the deployed descending indexes', () => {
  const indexes = JSON.parse(readFileSync(new URL('../../../firestore.indexes.json', import.meta.url), 'utf8')).indexes
  const sources: Array<[OperationsQueueSource, string]> = [
    ['report', 'reports'], ['appeal', 'moderationAppeals'], ['submission', 'submissionOperatorExceptions'],
  ]
  const now = 1_800_000_000_000
  for (const [source, collection] of sources) {
    assert.ok(indexes.some((index: { collectionGroup: string; queryScope: string; fields: unknown }) =>
      index.collectionGroup === collection && index.queryScope === 'COLLECTION' &&
      JSON.stringify(index.fields) === JSON.stringify([
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
        { fieldPath: '__name__', order: 'DESCENDING' },
      ])), `${collection} must have the index used by both reads`)
    for (const priority of ['all', 'overdue', ...(source === 'report' ? ['urgent' as const] : [])] as const) {
      const expected = getFirestore().collection(collection)
        .where('status', source === 'report' && priority !== 'urgent' ? 'in' : '==',
          source === 'report' ? priority === 'urgent' ? 'urgent_review' : ['received', 'urgent_review'] : source === 'appeal' ? 'received' : 'open')
        .where('createdAt', '<=', Timestamp.fromMillis(now - (priority === 'overdue' ? OPERATIONS_OVERDUE_MS : 0)))
        .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
      assert.ok(operationsSourceQuery(source, { type: source, priority }, now).isEqual(expected), `${source}/${priority} uses the deployed index direction`)
    }
  }
})
