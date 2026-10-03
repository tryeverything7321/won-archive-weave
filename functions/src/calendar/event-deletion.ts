import { randomUUID } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireActorPolicy } from '../community/actor-policy.js'
if (!getApps().length) initializeApp()
const db = getFirestore()
function idOf(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 200 || value.includes('/')) throw new HttpsError('invalid-argument', '행사를 확인해 주세요')
  return value
}
export const getCalendarEventManagement = onCall({ region: 'asia-northeast3' }, async request => {
  const administrator = request.auth?.token.role === 'administrator'
  const { uid } = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const id = idOf(request.data?.eventId)
  const [event, manual, imported] = await db.getAll(db.doc(`calendarEvents/${id}`), db.doc(`calendarEventSubmissions/${id}`), db.doc(`calendarImportCandidates/${id}`))
  let owner = manual.get('ownerUid') === uid || imported.get('ownerUid') === uid
  const sourceId = imported.get('sourceId')
  if (!owner && typeof sourceId === 'string' && sourceId && !sourceId.includes('/')) owner = (await db.doc(`calendarSources/${sourceId}`).get()).get('ownerUid') === uid
  return { canDelete: event.exists && event.get('status') === 'published' && (administrator || owner), requiresReason: administrator && !owner }
})
export const deleteCalendarEvent = onCall({ region: 'asia-northeast3' }, async request => {
  const administrator = request.auth?.token.role === 'administrator'
  const { uid } = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const id = idOf(request.data?.eventId)
  const reason = typeof request.data?.reason === 'string' ? request.data.reason.trim() : ''
  return db.runTransaction(async tx => {
    const refs = [db.doc(`calendarEvents/${id}`), db.doc(`calendarEventSubmissions/${id}`), db.doc(`calendarImportCandidates/${id}`)]
    const [event, manual, imported] = await Promise.all(refs.map(ref => tx.get(ref)))
    let owner = manual.get('ownerUid') === uid || imported.get('ownerUid') === uid
    const sourceId = imported.get('sourceId')
    if (!owner && typeof sourceId === 'string' && sourceId && !sourceId.includes('/')) owner = (await tx.get(db.doc(`calendarSources/${sourceId}`))).get('ownerUid') === uid
    if (!administrator && !owner) throw new HttpsError('permission-denied', '등록한 사람과 관리자만 삭제할 수 있어요')
    if (!event.exists) throw new HttpsError('not-found', '행사를 찾을 수 없어요')
    if (administrator && !owner && (reason.length < 2 || reason.length > 300)) throw new HttpsError('invalid-argument', '삭제 사유를 2~300자로 적어 주세요')
    if (event.get('deletedFromListings') === true) return { deleted: true, repeated: true }
    if (manual.get('status') === 'publishing') throw new HttpsError('failed-precondition', '행사 저장이 끝난 뒤 다시 삭제해 주세요')
    const at = FieldValue.serverTimestamp(), requestId = randomUUID()
    const notice = { action: 'remove', reason: reason || '작성자가 행사를 삭제했어요', requestId, createdAt: at }
    tx.update(refs[0], { status: 'unpublished', deletedFromListings: true, updatedAt: at })
    if (manual.exists) tx.update(refs[1], { status: 'unpublished', updatedAt: at, ...(administrator && !owner ? { operatorModeration: notice, moderationNotice: notice } : {}) })
    // Rejected imports keep their stable identity, so synchronization cannot recreate them.
    if (imported.exists) tx.update(refs[2], { status: 'rejected', deletedFromListings: true, reviewNote: notice.reason, updatedAt: at })
    tx.create(db.collection('auditEvents').doc(requestId), { type: 'calendar_event.deleted', targetId: id, uid, reason: notice.reason, at })
    return { deleted: true, repeated: false }
  })
})
