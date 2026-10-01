import assert from 'node:assert/strict'
import test from 'node:test'
import {
  archiveRelationId,
  calendarArchiveEventId,
  canManageArchiveRelation,
  canReadArchiveRecord,
  dateKey,
  historyArchiveEventId,
  normalizeArchiveReferences,
  uniqueArchiveCounts,
} from './model.js'

test('행사 정본 ID는 일정 ID 또는 요청 ID로 안정적이며 제목을 사용하지 않는다', () => {
  assert.equal(calendarArchiveEventId('draft-123'), 'calendar:draft-123')
  assert.equal(historyArchiveEventId('member-a', 'request_12345678'), historyArchiveEventId('member-a', 'request_12345678'))
  assert.notEqual(historyArchiveEventId('member-a', 'request_12345678'), historyArchiveEventId('member-a', 'request_87654321'))
  assert.equal(archiveRelationId('calendar:draft-123', 'bundle', 'bundle-a'), archiveRelationId('calendar:draft-123', 'bundle', 'bundle-a'))
})

test('연도만 행사에는 임의 날짜가 필요 없고 정확 날짜는 실재 날짜만 허용한다', () => {
  assert.equal(dateKey('2025-12-31', '시작일'), '2025-12-31')
  assert.throws(() => dateKey('2025-02-29', '시작일'), /시작일/)
})

test('공개 상위는 회원 전용과 철회 하위의 권한을 넓히지 않는다', () => {
  const publicViewer = { uid: null, member: false, administrator: false }
  const memberViewer = { uid: 'member-a', member: true, administrator: false }
  assert.equal(canReadArchiveRecord({ visibility: 'public', status: 'active' }, publicViewer), true)
  assert.equal(canReadArchiveRecord({ visibility: 'member_only', status: 'active' }, publicViewer), false)
  assert.equal(canReadArchiveRecord({ visibility: 'member_only', status: 'active' }, memberViewer), true)
  assert.equal(canReadArchiveRecord({ visibility: 'public', status: 'withdrawn', ownerUid: 'member-a' }, memberViewer), false)
})

test('행사와 조직 참조는 조직 관리 권한을 만들지 않고 관계 당사자만 연결을 관리한다', () => {
  assert.equal(canManageArchiveRelation({ actorUid: 'member-a', administrator: false, relationOwnerUid: 'member-b', eventOwnerUid: 'member-c', targetOwnerUid: 'member-a' }), true)
  assert.equal(canManageArchiveRelation({ actorUid: 'member-a', administrator: false, relationOwnerUid: 'member-b', eventOwnerUid: 'member-c', targetOwnerUid: 'member-d' }), false)
  assert.equal(canManageArchiveRelation({ actorUid: 'admin', administrator: true }), true)
})

test('자료 모음 참조는 순서를 보존하고 같은 원본 중복을 거부한다', () => {
  assert.deepEqual(normalizeArchiveReferences([
    { targetType: 'event', targetId: 'event-a' },
    { targetType: 'bundle', targetId: 'bundle-a' },
  ]).map((item) => item.targetType), ['event', 'bundle'])
  assert.throws(() => normalizeArchiveReferences([
    { targetType: 'bundle', targetId: 'bundle-a' },
    { targetType: 'bundle', targetId: 'bundle-a' },
  ]), /두 번/)
})

test('고유 집계는 여러 행사와 모음에 연결된 같은 원본과 파일을 한 번만 센다', () => {
  assert.deepEqual(uniqueArchiveCounts({
    eventIds: ['event-a', 'event-a'],
    bundleIds: ['bundle-a', 'bundle-a'],
    materialIds: ['material-a', 'material-b'],
    activityIds: ['activity-a', 'activity-b'],
    files: [
      ...Array.from({ length: 6 }, (_, index) => ({ bundleId: 'bundle-a', fileId: `file-${index + 1}`, status: index === 5 ? 'scanning' : 'ready', canDownload: index < 5 })),
      { bundleId: 'bundle-a', fileId: 'file-1', status: 'ready', canDownload: true },
      { bundleId: 'bundle-a', fileId: 'withdrawn-file', status: 'withdrawn', canDownload: false },
    ],
  }), {
    eventCount: 1,
    bundleCount: 1,
    materialCount: 2,
    activityCount: 2,
    fileCount: 6,
    downloadableFileCount: 5,
    pendingFileCount: 1,
  })
})
