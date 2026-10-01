import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireActorPolicy } from '../community/actor-policy.js'
import {
  archiveCommandId,
  archiveId,
  archiveRelationId,
  canManageArchiveRelation,
  canReadArchiveRecord,
  relationTargetType,
  requestId,
  type ArchiveRelationTargetType,
} from './model.js'

if (!getApps().length) initializeApp()

const firestore = getFirestore()

function targetReference(type: ArchiveRelationTargetType, id: string): DocumentReference {
  if (type === 'bundle') return firestore.collection('materialBundles').doc(id)
  if (type === 'material') return firestore.collection('materials').doc(id)
  return firestore.collection('activities').doc(id)
}

async function targetOwnership(transaction: Transaction, type: ArchiveRelationTargetType, id: string, requireLinkable: boolean) {
  const target = await transaction.get(targetReference(type, id))
  if (!target.exists) {
    if (requireLinkable) throw new HttpsError('not-found', '연결할 원본을 찾지 못했어요')
    return { target, ownerUid: undefined }
  }
  if (type === 'bundle') {
    if (requireLinkable && target.get('status') === 'withdrawn') throw new HttpsError('failed-precondition', '철회한 자료 묶음은 연결할 수 없어요')
    return { target, ownerUid: target.get('ownerUid') }
  }
  if (requireLinkable && target.get('status') !== 'published') throw new HttpsError('failed-precondition', '공개 중인 원본만 행사에 연결할 수 있어요')
  const submission = await transaction.get(firestore.collection('submissions').doc(id))
  return { target, ownerUid: submission.get('ownerUid') }
}

function inputData(value: unknown) {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const archiveEventId = archiveId(data.archiveEventId, '행사')
  const targetType = relationTargetType(data.targetType)
  const targetId = archiveId(data.targetId, '연결 대상')
  return { commandId: requestId(data.requestId), archiveEventId, targetType, targetId, relationId: archiveRelationId(archiveEventId, targetType, targetId) }
}

async function changeArchiveRelation(
  request: { auth?: { uid: string; token: Record<string, unknown> }; data?: unknown },
  action: 'link' | 'unlink',
) {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const input = inputData(request.data)
  const administrator = actor.roleException === 'administrator'
  const eventRef = firestore.collection('archiveEvents').doc(input.archiveEventId)
  const relationRef = firestore.collection('archiveRelations').doc(input.relationId)
  const auditRef = firestore.collection('auditEvents').doc(archiveCommandId(actor.uid, input.commandId, `archive.relation_${action}`))
  const repeated = await firestore.runTransaction(async (transaction) => {
    const [event, relation, existingCommand] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(relationRef),
      transaction.get(auditRef),
    ])
    if (existingCommand.exists) return true
    if (!event.exists || event.get('status') === 'withdrawn') throw new HttpsError('not-found', '연결할 행사를 찾지 못했어요')
    const sourceId = event.get('sourceCalendarEventId')
    const source = typeof sourceId === 'string' ? await transaction.get(firestore.collection('calendarEvents').doc(sourceId)) : null
    const privateSource = typeof sourceId === 'string' ? await transaction.get(firestore.collection('calendarEventSubmissions').doc(sourceId)) : null
    if (source && (!source.exists || source.get('status') !== 'published')) throw new HttpsError('not-found', '연결할 행사를 찾지 못했어요')
    const eventOwnerUid = privateSource ? privateSource.get('ownerUid') : event.get('ownerUid')
    const target = await targetOwnership(transaction, input.targetType, input.targetId, action === 'link')
    const canReadEvent = canReadArchiveRecord({ visibility: source ? source.get('visibility') : event.get('visibility'), status: event.get('status'), ownerUid: eventOwnerUid }, { uid: actor.uid, member: true, administrator })
    if (!canReadEvent) throw new HttpsError('permission-denied', '이 행사에는 연결할 수 없어요')
    const canManage = canManageArchiveRelation({
      actorUid: actor.uid,
      administrator,
      relationOwnerUid: relation.get('createdByUid'),
      eventOwnerUid,
      targetOwnerUid: target.ownerUid,
    })
    if (!canManage) throw new HttpsError('permission-denied', '본인이 올린 원본만 행사에 연결할 수 있어요')
    if (action === 'link') {
      transaction.set(relationRef, {
        archiveEventId: input.archiveEventId,
        targetType: input.targetType,
        targetId: input.targetId,
        status: 'active',
        createdByUid: relation.exists ? relation.get('createdByUid') : actor.uid,
        createdAt: relation.exists ? relation.get('createdAt') : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } else if (relation.exists && relation.get('status') === 'active') {
      transaction.update(relationRef, { status: 'unlinked', updatedAt: FieldValue.serverTimestamp(), unlinkedByUid: actor.uid })
    }
    transaction.create(auditRef, {
      type: action === 'link' ? 'archive.relation_linked' : 'archive.relation_unlinked',
      relationId: input.relationId,
      archiveEventId: input.archiveEventId,
      targetType: input.targetType,
      targetId: input.targetId,
      actorUid: actor.uid,
      at: FieldValue.serverTimestamp(),
    })
    return false
  })
  return { relationId: input.relationId, status: action === 'link' ? 'linked' as const : 'unlinked' as const, repeated }
}

export const linkArchiveRelation = onCall({ region: 'asia-northeast3' }, (request) => changeArchiveRelation(request, 'link'))
export const unlinkArchiveRelation = onCall({ region: 'asia-northeast3' }, (request) => changeArchiveRelation(request, 'unlink'))
