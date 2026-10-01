import assert from 'node:assert/strict'
import test from 'node:test'
import type { DocumentSnapshot } from 'firebase-admin/firestore'
import { projectArchiveCollection } from './collections.js'
import type { projectArchiveReference } from './access.js'

function snapshot(id: string, data: Record<string, unknown>): DocumentSnapshot {
  return { id, exists: true, data: () => data } as unknown as DocumentSnapshot
}

test('공개 모음도 익명 사용자에게 회원 전용 하위 제목과 개수를 노출하지 않는다', async () => {
  const collection = snapshot('collection-a', {
    title: '청년 행사 모음', description: '', visibility: 'public', status: 'active', ownerUid: 'owner-a',
    createdAt: 100, updatedAt: 200,
    items: [
      { targetType: 'event', targetId: 'public-event' },
      { targetType: 'bundle', targetId: 'member-bundle' },
    ],
  })
  const resolver = (async (reference: { targetType: string; targetId: string }) => reference.targetId === 'public-event'
    ? { targetType: 'event' as const, id: 'public-event', title: '공개 행사', href: '/archive-events/public-event' }
    : null) as typeof projectArchiveReference
  const projected = await projectArchiveCollection(collection, { uid: null, member: false, administrator: false }, resolver)
  assert.equal(projected?.itemCount, 1)
  assert.deepEqual(projected?.items.map((item) => item.title), ['공개 행사'])
  assert.equal(JSON.stringify(projected).includes('member-bundle'), false)
  assert.equal(projected?.canEdit, false)
})
