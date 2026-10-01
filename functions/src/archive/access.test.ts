import assert from 'node:assert/strict'
import test from 'node:test'
import type { DocumentSnapshot } from 'firebase-admin/firestore'
import { projectArchiveBundle } from './access.js'

function snapshot(id: string, data: Record<string, unknown>): DocumentSnapshot {
  return { id, exists: true, data: () => data } as unknown as DocumentSnapshot
}

test('자료 묶음 공개 투영은 검사 완료 파일만 포함하고 저장 경로와 해시를 숨긴다', () => {
  const bundle = snapshot('bundle-a', {
    ownerUid: 'owner-a', title: '행사 자료', description: '', visibility: 'public', status: 'active',
    rights: { redistribution: 'view_only' }, eventId: null, createdAtMs: 1_700_000_000_000, updatedAtMs: 1_700_000_001_000,
    files: {
      ready: { fileId: 'ready', clientFileId: 'client-ready', revision: 1, originalName: 'guide.pdf', displayName: '안내.pdf', order: 0, sizeBytes: 10, contentType: 'application/pdf', sha256: 'secret', storagePath: 'quarantine/secret', status: 'ready', scanStatus: 'clean', updatedAtMs: 1 },
      blocked: { fileId: 'blocked', clientFileId: 'client-blocked', revision: 1, originalName: 'blocked.pdf', displayName: '차단.pdf', order: 1, sizeBytes: 20, contentType: 'application/pdf', sha256: 'secret2', storagePath: 'quarantine/secret2', status: 'blocked', scanStatus: 'blocked', updatedAtMs: 1 },
    },
  })
  const projected = projectArchiveBundle(bundle, { uid: null, member: false, administrator: false })
  assert.equal(projected?.files.length, 1)
  assert.equal(projected?.files[0]?.fileId, 'ready')
  assert.equal(projected?.files[0]?.canDownload, false)
  const serialized = JSON.stringify(projected)
  assert.equal(serialized.includes('storagePath'), false)
  assert.equal(serialized.includes('clientFileId'), false)
  assert.equal(serialized.includes('sha256'), false)
  assert.equal(serialized.includes('차단.pdf'), false)
})
