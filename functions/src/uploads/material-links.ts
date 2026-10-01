import { createHash } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type DocumentData } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireActorPolicy, type ActorRole } from '../community/actor-policy.js'

if (!getApps().length) initializeApp()

const MAX_LINKED_MATERIALS = 30
const recordIdPattern = /^[A-Za-z0-9_-]{1,120}$/
const requestIdPattern = /^[A-Za-z0-9_-]{8,120}$/

export function validateActivityMaterialLinks(value: unknown): {
  activityId: string
  materialIds: string[]
  requestId: string
} {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const activityId = typeof data.activityId === 'string' ? data.activityId.trim() : ''
  const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : ''
  if (!recordIdPattern.test(activityId)) throw new HttpsError('invalid-argument', '연결할 활동 기록을 확인해 주세요')
  if (!requestIdPattern.test(requestId)) throw new HttpsError('invalid-argument', '요청 식별자를 확인해 주세요')
  if (!Array.isArray(data.materialIds)) throw new HttpsError('invalid-argument', '연결할 자료 목록을 확인해 주세요')
  const materialIds: string[] = []
  for (const value of data.materialIds) {
    const materialId = typeof value === 'string' ? value.trim() : ''
    if (!recordIdPattern.test(materialId)) throw new HttpsError('invalid-argument', '연결할 자료를 확인해 주세요')
    if (!materialIds.includes(materialId)) materialIds.push(materialId)
    if (materialIds.length > MAX_LINKED_MATERIALS) {
      throw new HttpsError('invalid-argument', `자료는 ${MAX_LINKED_MATERIALS}개까지 연결할 수 있어요`)
    }
  }
  return { activityId, materialIds, requestId }
}

export function activityMaterialLinkCommandKey(uid: string, requestId: string): string {
  return createHash('sha256').update(`activity-material-links:${uid}:${requestId}`).digest('hex').slice(0, 40)
}

export function assertActivityMaterialLinkOwner(
  activity: DocumentData,
  privateSubmission: DocumentData | undefined,
  actorUid: string,
  actorRole: ActorRole | null,
): void {
  if (activity.status !== 'published') throw new HttpsError('failed-precondition', '공개 중인 활동 기록만 자료를 연결할 수 있어요')
  if (!privateSubmission || privateSubmission.ownerUid !== actorUid && actorRole !== 'administrator') {
    throw new HttpsError('permission-denied', '내 활동 기록의 자료만 바꿀 수 있어요')
  }
}

export function assertLinkableMaterial(material: DocumentData, signedIn: boolean): void {
  if (material.status !== 'published' || (material.visibility !== 'public' && material.visibility !== 'member_only')) {
    throw new HttpsError('failed-precondition', '현재 공개된 자료만 연결할 수 있어요')
  }
  if (material.visibility === 'member_only' && !signedIn) {
    throw new HttpsError('permission-denied', '회원 전용 자료를 읽을 권한이 필요해요')
  }
}

export function activityMaterialIds(activity: DocumentData): string[] {
  const values = [
    ...(Array.isArray(activity.linkedMaterialIds) ? activity.linkedMaterialIds : []),
    activity.materialId,
  ]
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || !recordIdPattern.test(value) || result.includes(value)) continue
    result.push(value)
    if (result.length === MAX_LINKED_MATERIALS) break
  }
  return result
}

export function assertTotalMaterialLinkLimit(linkedMaterialIds: string[], legacyMaterialId: unknown): void {
  const total = new Set([
    ...linkedMaterialIds,
    ...(typeof legacyMaterialId === 'string' && recordIdPattern.test(legacyMaterialId) ? [legacyMaterialId] : []),
  ])
  if (total.size > MAX_LINKED_MATERIALS) {
    throw new HttpsError('invalid-argument', `기존 기본 자료를 포함해 ${MAX_LINKED_MATERIALS}개까지 연결할 수 있어요`)
  }
}

export function boundedMaterialLinkImpact(
  linkedSchemaActivityIds: string[],
  legacySchemaActivityIds: string[],
): { linkedActivityCount: number; hasMore: boolean } {
  const ids = new Set([...linkedSchemaActivityIds, ...legacySchemaActivityIds])
  return { linkedActivityCount: Math.min(ids.size, 100), hasMore: ids.size > 100 }
}

function requestedRecordId(value: unknown, field: 'activityId' | 'materialId'): string {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const id = typeof data[field] === 'string' ? data[field].trim() : ''
  if (!recordIdPattern.test(id)) throw new HttpsError('invalid-argument', field === 'activityId' ? '활동 기록을 확인해 주세요' : '자료를 확인해 주세요')
  return id
}

export const getActivityMaterialLinks = onCall({ region: 'asia-northeast3' }, async (request) => {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const activityId = requestedRecordId(request.data, 'activityId')
  const firestore = getFirestore()
  const [snapshot, privateSubmission] = await firestore.getAll(
    firestore.collection('activities').doc(activityId),
    firestore.collection('submissions').doc(activityId),
  )
  if (!snapshot.exists || !privateSubmission.exists) throw new HttpsError('not-found', '활동 기록을 찾지 못했어요')
  const activity = snapshot.data() ?? {}
  assertActivityMaterialLinkOwner(activity, privateSubmission.data(), actor.uid, actor.roleException)
  return { activityId, materialIds: activityMaterialIds(activity) }
})

export const getMaterialLinkImpact = onCall({ region: 'asia-northeast3' }, async (request) => {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const materialId = requestedRecordId(request.data, 'materialId')
  const firestore = getFirestore()
  const [material, privateSubmission] = await firestore.getAll(
    firestore.collection('materials').doc(materialId),
    firestore.collection('submissions').doc(materialId),
  )
  if (!material.exists || !privateSubmission.exists) throw new HttpsError('not-found', '자료를 찾지 못했어요')
  if (actor.roleException !== 'administrator' && privateSubmission.get('ownerUid') !== actor.uid) {
    throw new HttpsError('permission-denied', '내 자료의 연결 현황만 확인할 수 있어요')
  }
  const [linked, legacy] = await Promise.all([
    firestore.collection('activities').where('linkedMaterialIds', 'array-contains', materialId).limit(101).get(),
    firestore.collection('activities').where('materialId', '==', materialId).limit(101).get(),
  ])
  return {
    materialId,
    ...boundedMaterialLinkImpact(linked.docs.map((doc) => doc.id), legacy.docs.map((doc) => doc.id)),
  }
})

export const setActivityMaterialLinks = onCall({ region: 'asia-northeast3' }, async (request) => {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const command = validateActivityMaterialLinks(request.data)
  const firestore = getFirestore()
  const activityRef = firestore.collection('activities').doc(command.activityId)
  const privateSubmissionRef = firestore.collection('submissions').doc(command.activityId)
  const materialRefs = command.materialIds.map((materialId) => firestore.collection('materials').doc(materialId))
  const commandRef = firestore.collection('auditEvents').doc(activityMaterialLinkCommandKey(actor.uid, command.requestId))

  return firestore.runTransaction(async (transaction) => {
    const [activitySnapshot, privateSubmission, existingCommand, ...materialSnapshots] = await Promise.all([
      transaction.get(activityRef),
      transaction.get(privateSubmissionRef),
      transaction.get(commandRef),
      ...materialRefs.map((reference) => transaction.get(reference)),
    ])
    if (!activitySnapshot.exists || !privateSubmission.exists) throw new HttpsError('not-found', '활동 기록을 찾지 못했어요')
    assertActivityMaterialLinkOwner(activitySnapshot.data() ?? {}, privateSubmission.data(), actor.uid, actor.roleException)
    if (existingCommand.exists) {
      const storedIds = existingCommand.get('materialIds')
      const same = existingCommand.get('type') === 'activity.material_links_set'
        && existingCommand.get('activityId') === command.activityId
        && Array.isArray(storedIds)
        && storedIds.length === command.materialIds.length
        && storedIds.every((value, index) => value === command.materialIds[index])
      if (!same) throw new HttpsError('already-exists', '같은 요청 식별자가 다른 자료 연결에 사용됐어요')
      return { activityId: command.activityId, linkedMaterialIds: command.materialIds, repeated: true }
    }
    assertTotalMaterialLinkLimit(command.materialIds, activitySnapshot.get('materialId'))
    materialSnapshots.forEach((snapshot) => {
      if (!snapshot.exists) throw new HttpsError('not-found', '연결할 자료를 찾지 못했어요')
      assertLinkableMaterial(snapshot.data() ?? {}, true)
    })
    const timestamp = FieldValue.serverTimestamp()
    transaction.update(activityRef, { linkedMaterialIds: command.materialIds, updatedAt: timestamp })
    transaction.create(commandRef, {
      type: 'activity.material_links_set',
      activityId: command.activityId,
      materialIds: command.materialIds,
      requestId: command.requestId,
      uid: actor.uid,
      at: timestamp,
    })
    return { activityId: command.activityId, linkedMaterialIds: command.materialIds, repeated: false }
  })
})
