import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore, type DocumentData, type DocumentReference } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireActorPolicy } from '../community/actor-policy.js'
import {
  archiveViewer,
  projectArchiveActivity,
  projectArchiveBundle,
  projectArchiveEvent,
  projectArchiveMaterial,
  type ArchiveActivityProjection,
  type ArchiveBundleProjection,
  type ArchiveEventProjection,
  type ArchiveMaterialProjection,
} from './access.js'
import {
  ARCHIVE_MAX_RELATIONS,
  ARCHIVE_TIME_ZONE,
  archiveCommandId,
  archiveId,
  archiveVisibility,
  boundedText,
  calendarArchiveEventId,
  dateKey,
  heldYear,
  historyArchiveEventId,
  requestId,
  uniqueArchiveCounts,
  type ArchiveViewer,
} from './model.js'

if (!getApps().length) initializeApp()

const firestore = getFirestore()

function localDateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function dateFromTimestamp(value: unknown, label: string): Date {
  if (!(value instanceof Timestamp)) throw new HttpsError('failed-precondition', `${label}을 확인하지 못했어요`)
  return value.toDate()
}

async function organizerIds(value: unknown): Promise<string[]> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 10) throw new HttpsError('invalid-argument', '주최는 10곳까지 연결할 수 있어요')
  const ids = [...new Set(value.map((item) => archiveId(item, '주최')))]
  if (!ids.length) return []
  const snapshots = await firestore.getAll(...ids.map((id) => firestore.collection('archiveOrganizers').doc(id)))
  if (snapshots.some((snapshot) => !snapshot.exists || snapshot.get('status') !== 'active')) {
    throw new HttpsError('failed-precondition', '선택한 주최 정보를 확인하지 못했어요')
  }
  return ids
}

async function organizerProjections(ids: unknown): Promise<Array<{ id: string; displayName: string }>> {
  if (!Array.isArray(ids)) return []
  const normalized = [...new Set(ids.flatMap((item) => {
    try { return [archiveId(item, '주최')] } catch { return [] }
  }))]
  if (!normalized.length) return []
  const snapshots = await firestore.getAll(...normalized.map((id) => firestore.collection('archiveOrganizers').doc(id)))
  return snapshots.flatMap((snapshot) => {
    const name = typeof snapshot.get('displayName') === 'string' ? snapshot.get('displayName').trim().slice(0, 100) : ''
    return snapshot.exists && snapshot.get('status') === 'active' && name ? [{ id: snapshot.id, displayName: name }] : []
  })
}

function calendarEventRecord(sourceCalendarEventId: string, data: DocumentData) {
  const startAt = dateFromTimestamp(data.startAt, '행사 시작 시각')
  const endAt = dateFromTimestamp(data.endAt, '행사 종료 시각')
  const timeZone = typeof data.timeZone === 'string' && data.timeZone ? data.timeZone : ARCHIVE_TIME_ZONE
  const effectiveEnd = data.allDay === true ? new Date(endAt.getTime() - 1) : endAt
  const startDateKey = localDateKey(startAt, timeZone)
  const endDateKey = localDateKey(effectiveEnd, timeZone)
  return {
    title: boundedText(data.title, '행사 제목', 160),
    datePrecision: 'day' as const,
    heldYear: Number(startDateKey.slice(0, 4)),
    startDateKey,
    endDateKey,
    region: typeof data.region === 'string' ? data.region.trim().slice(0, 80) : '',
    sourceOrganizerName: typeof data.organizerName === 'string' ? data.organizerName.trim().slice(0, 80) : '',
    visibility: data.visibility === 'member_only' ? 'member_only' as const : 'public' as const,
    status: data.eventState === 'canceled' || data.status === 'canceled' ? 'canceled' as const : 'active' as const,
    sourceCalendarEventId,
  }
}

async function ensureInputRecord(data: Record<string, unknown>, uid: string) {
  const sourceId = typeof data.sourceCalendarEventId === 'string' && data.sourceCalendarEventId.trim()
    ? archiveId(data.sourceCalendarEventId, '행사 일정')
    : null
  const organizers = await organizerIds(data.organizerIds)
  if (sourceId) {
    const source = await firestore.collection('calendarEvents').doc(sourceId).get()
    if (!source.exists || source.get('status') !== 'published') throw new HttpsError('not-found', '연결할 행사 일정을 찾지 못했어요')
    const visibility = source.get('visibility')
    if (visibility !== 'public' && visibility !== 'member_only') throw new HttpsError('failed-precondition', '행사 공개 범위를 확인하지 못했어요')
    const privateSource = await firestore.collection('calendarEventSubmissions').doc(sourceId).get()
    const ownerUid = typeof privateSource.get('ownerUid') === 'string' ? privateSource.get('ownerUid') : null
    return {
      archiveEventId: calendarArchiveEventId(sourceId),
      record: { ...calendarEventRecord(sourceId, source.data() ?? {}), organizerIds: organizers, ownerUid },
      organizerIdsProvided: Array.isArray(data.organizerIds),
    }
  }

  const precision = data.datePrecision === 'year' ? 'year' : data.datePrecision === 'day' ? 'day' : null
  if (!precision) throw new HttpsError('invalid-argument', '날짜 정밀도를 확인해 주세요')
  const year = heldYear(data.heldYear)
  const startDateKey = precision === 'day' ? dateKey(data.startDateKey, '행사 시작일') : undefined
  const endDateKey = precision === 'day' ? dateKey(data.endDateKey ?? data.startDateKey, '행사 종료일') : undefined
  if (startDateKey && Number(startDateKey.slice(0, 4)) !== year) {
    throw new HttpsError('invalid-argument', '개최 연도는 행사 시작 연도와 같아야 해요')
  }
  if (startDateKey && endDateKey && endDateKey < startDateKey) throw new HttpsError('invalid-argument', '행사 종료일을 확인해 주세요')
  const commandId = requestId(data.requestId)
    return {
      archiveEventId: historyArchiveEventId(uid, commandId),
    record: {
      title: boundedText(data.title, '행사 제목', 160),
      datePrecision: precision,
      heldYear: year,
      ...(startDateKey ? { startDateKey } : {}),
      ...(endDateKey ? { endDateKey } : {}),
      region: boundedText(data.region, '지역', 80, { optional: true }),
      visibility: archiveVisibility(data.visibility),
      status: 'active' as const,
      organizerIds: organizers,
        ownerUid: uid,
      sourceCalendarEventId: null,
    },
    organizerIdsProvided: true,
  }
}

async function eventProjection(reference: DocumentReference, viewer: ArchiveViewer): Promise<ArchiveEventProjection | null> {
  const snapshot = await reference.get()
  const organizers = snapshot.exists ? await organizerProjections(snapshot.get('organizerIds')) : []
  const sourceId = snapshot.get('sourceCalendarEventId')
  const source = typeof sourceId === 'string' ? await firestore.collection('calendarEvents').doc(sourceId).get() : undefined
  return projectArchiveEvent(snapshot, viewer, organizers, source)
}

export const ensureArchiveEventContext = onCall({ region: 'asia-northeast3' }, async (request) => {
  const actor = await requireActorPolicy(request.auth, { allowRoles: ['administrator'] })
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {}
  const commandId = requestId(data.requestId)
  const input = await ensureInputRecord(data, actor.uid)
  const eventRef = firestore.collection('archiveEvents').doc(input.archiveEventId)
  const auditRef = firestore.collection('auditEvents').doc(archiveCommandId(actor.uid, commandId, 'archive.event_ensured'))
  const repeated = await firestore.runTransaction(async (transaction) => {
    const [existing, command] = await Promise.all([transaction.get(eventRef), transaction.get(auditRef)])
    if (command.exists) return true
    if (existing.exists) {
      if (existing.get('sourceCalendarEventId') && existing.get('sourceCalendarEventId') !== input.record.sourceCalendarEventId) {
        throw new HttpsError('already-exists', '행사 연결 식별자가 다른 원본에 사용됐어요')
      }
      if (!input.record.sourceCalendarEventId) return true
      if (input.organizerIdsProvided && actor.roleException !== 'administrator') {
        const current = Array.isArray(existing.get('organizerIds')) ? [...new Set(existing.get('organizerIds') as unknown[])].sort() : []
        const requested = [...input.record.organizerIds].sort()
        if (JSON.stringify(current) !== JSON.stringify(requested)) {
          throw new HttpsError('permission-denied', '기존 행사의 주최 연결은 관리자가 수정할 수 있어요')
        }
      }
      const authoritativeCalendarFields: Record<string, unknown> = { ...input.record }
      const nextOrganizerIds = input.record.organizerIds
      delete authoritativeCalendarFields.organizerIds
      transaction.update(eventRef, {
        ...authoritativeCalendarFields,
        ...(input.organizerIdsProvided && actor.roleException === 'administrator' ? { organizerIds: nextOrganizerIds } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(auditRef, {
        type: 'archive.event_refreshed', archiveEventId: input.archiveEventId,
        sourceCalendarEventId: input.record.sourceCalendarEventId, actorUid: actor.uid, at: FieldValue.serverTimestamp(),
      })
      return false
    }
    transaction.create(eventRef, {
      ...input.record,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(auditRef, {
      type: 'archive.event_ensured',
      archiveEventId: input.archiveEventId,
      sourceCalendarEventId: input.record.sourceCalendarEventId ?? null,
      actorUid: actor.uid,
      at: FieldValue.serverTimestamp(),
    })
    return false
  })
  const viewer = await archiveViewer(request.auth)
  const event = await eventProjection(eventRef, viewer)
  if (!event) throw new HttpsError('failed-precondition', '행사 연결을 다시 확인해 주세요')
  return { archiveEventId: input.archiveEventId, event, repeated }
})

export async function eventArchiveOverview(archiveEventId: string, viewer: ArchiveViewer) {
  const eventRef = firestore.collection('archiveEvents').doc(archiveEventId)
  const event = await eventProjection(eventRef, viewer)
  const empty = {
    archiveEvent: null,
    bundles: [] as ArchiveBundleProjection[],
    materials: [] as ArchiveMaterialProjection[],
    activities: [] as ArchiveActivityProjection[],
    counts: { bundleCount: 0, materialCount: 0, activityCount: 0, fileCount: 0, downloadableFileCount: 0, pendingFileCount: 0 },
    asOfMs: Date.now(),
    timeZone: ARCHIVE_TIME_ZONE,
    completeness: 'complete' as const,
  }
  if (!event) return empty
  const relations = await firestore.collection('archiveRelations')
    .where('archiveEventId', '==', archiveEventId)
    .where('status', '==', 'active')
    .limit(ARCHIVE_MAX_RELATIONS + 1)
    .get()
  if (relations.size > ARCHIVE_MAX_RELATIONS) throw new HttpsError('resource-exhausted', '연결 항목이 많아 범위를 나누어 확인해 주세요')
  const grouped = {
    bundle: relations.docs.filter((item) => item.get('targetType') === 'bundle'),
    material: relations.docs.filter((item) => item.get('targetType') === 'material'),
    activity: relations.docs.filter((item) => item.get('targetType') === 'activity'),
  }
  const [bundleSnapshots, materialSnapshots, activitySnapshots] = await Promise.all([
    grouped.bundle.length ? firestore.getAll(...grouped.bundle.map((item) => firestore.collection('materialBundles').doc(String(item.get('targetId'))))) : [],
    grouped.material.length ? firestore.getAll(...grouped.material.map((item) => firestore.collection('materials').doc(String(item.get('targetId'))))) : [],
    grouped.activity.length ? firestore.getAll(...grouped.activity.map((item) => firestore.collection('activities').doc(String(item.get('targetId'))))) : [],
  ])
  const bundles = bundleSnapshots.map((snapshot) => projectArchiveBundle(snapshot, viewer, [archiveEventId])).filter((item): item is ArchiveBundleProjection => item !== null)
  const materials = materialSnapshots.map((snapshot) => projectArchiveMaterial(snapshot, viewer)).filter((item): item is ArchiveMaterialProjection => item !== null)
  const activities = activitySnapshots.map((snapshot) => projectArchiveActivity(snapshot, viewer)).filter((item): item is ArchiveActivityProjection => item !== null)
  const counts = uniqueArchiveCounts({
    bundleIds: bundles.map((item) => item.bundleId),
    materialIds: materials.map((item) => item.id),
    activityIds: activities.map((item) => item.id),
    files: [
      ...bundles.flatMap((bundle) => bundle.files.map((file) => ({ bundleId: bundle.bundleId, fileId: file.fileId, status: file.status, canDownload: file.canDownload }))),
      ...materials.filter((material) => material.hasOriginalFile).map((material) => ({ bundleId: `legacy:${material.id}`, fileId: 'original', status: 'ready', canDownload: material.canDownload })),
    ],
  })
  return {
    archiveEvent: event,
    bundles,
    materials,
    activities,
    counts: {
      bundleCount: counts.bundleCount,
      materialCount: counts.materialCount,
      activityCount: counts.activityCount,
      fileCount: counts.fileCount,
      downloadableFileCount: counts.downloadableFileCount,
      pendingFileCount: counts.pendingFileCount,
    },
    asOfMs: Date.now(),
    timeZone: ARCHIVE_TIME_ZONE,
    completeness: 'complete' as const,
  }
}

export const getEventArchiveOverview = onCall({ region: 'asia-northeast3' }, async (request) => {
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {}
  const archiveEventId = typeof data.archiveEventId === 'string' && data.archiveEventId
    ? archiveId(data.archiveEventId, '행사')
    : typeof data.sourceCalendarEventId === 'string' && data.sourceCalendarEventId
      ? calendarArchiveEventId(archiveId(data.sourceCalendarEventId, '행사 일정'))
      : null
  if (!archiveEventId) throw new HttpsError('invalid-argument', '행사를 확인해 주세요')
  const viewer = await archiveViewer(request.auth)
  return eventArchiveOverview(archiveEventId, viewer)
})
