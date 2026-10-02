import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type DocumentSnapshot, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { archiveViewer, projectArchiveActivity, projectArchiveBundle, projectArchiveEvent, projectArchiveMaterial } from './access.js'
import {
  ARCHIVE_SCAN_LIMIT,
  ARCHIVE_TIME_ZONE,
  archiveId,
  archivePageSize,
  boundedText,
  decodeArchiveCursor,
  encodeArchiveCursor,
  heldYear,
  isAfterArchiveCursor,
  uniqueArchiveCounts,
  type ArchiveRelationTargetType,
} from './model.js'

if (!getApps().length) initializeApp()

const firestore = getFirestore()

export type DiscoveryFilters = {
  organizerId: string | null
  heldYear: number | null
  uploadYear: number | null
  region: string | null
  format: string | null
}

export type DiscoveryItem = {
  targetType: 'event' | ArchiveRelationTargetType
  id: string
  title: string
  href: string
  sortMs: number
  heldYear: number | null
  uploadYear: number | null
  region: string
  format: string | null
  formats: string[]
  organizerIds: string[]
  linkedEventIds: string[]
  canLink: boolean
}

async function completeCollection(name: string): Promise<QueryDocumentSnapshot[]> {
  const snapshot = await firestore.collection(name).limit(ARCHIVE_SCAN_LIMIT + 1).get()
  if (snapshot.size > ARCHIVE_SCAN_LIMIT) throw new HttpsError('resource-exhausted', '전체 집계를 안전하게 계산할 수 없어 검색 범위를 나누어야 해요')
  return snapshot.docs
}

function filtersFrom(value: unknown): DiscoveryFilters {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    organizerId: data.organizerId === undefined || data.organizerId === '' ? null : archiveId(data.organizerId, '주최'),
    heldYear: data.heldYear === undefined || data.heldYear === '' ? null : heldYear(data.heldYear),
    uploadYear: data.uploadYear === undefined || data.uploadYear === '' ? null : heldYear(data.uploadYear),
    region: data.region === undefined || data.region === '' ? null : boundedText(data.region, '지역', 80),
    format: data.format === undefined || data.format === '' ? null : boundedText(data.format, '형식', 20).toUpperCase(),
  }
}

function eventSortMs(year: number, dateKey?: string): number {
  const parsed = Date.parse(`${dateKey ?? `${year}-01-01`}T00:00:00+09:00`)
  return Number.isFinite(parsed) ? parsed : Date.UTC(year, 0, 1)
}

export function archiveDiscoveryItemMatches(item: DiscoveryItem, filters: DiscoveryFilters, eventItems: Map<string, DiscoveryItem>, allItems: DiscoveryItem[]): boolean {
  const linkedEvents = item.targetType === 'event'
    ? [item]
    : item.linkedEventIds.flatMap((id) => eventItems.get(id) ?? [])
  const linkedTargets = item.targetType === 'event'
    ? allItems.filter((candidate) => candidate.targetType !== 'event' && candidate.linkedEventIds.includes(item.id))
    : [item]
  if (filters.organizerId && !linkedEvents.some((event) => event.organizerIds.includes(filters.organizerId!))) return false
  if (filters.heldYear && !linkedEvents.some((event) => event.heldYear === filters.heldYear)) return false
  if (filters.region && !linkedEvents.some((event) => event.region === filters.region)) return false
  if (filters.uploadYear) {
    if (!linkedTargets.some((candidate) => candidate.uploadYear === filters.uploadYear)) return false
  }
  if (filters.format) {
    if (!linkedTargets.some((candidate) => candidate.formats.includes(filters.format!))) return false
  }
  return true
}

function organizerMap(docs: QueryDocumentSnapshot[]) {
  return new Map(docs.flatMap((doc) => {
    const displayName = typeof doc.get('displayName') === 'string' ? doc.get('displayName').trim().slice(0, 100) : ''
    return doc.get('status') === 'active' && displayName ? [[doc.id, displayName] as const] : []
  }))
}

function relationMap(docs: QueryDocumentSnapshot[]) {
  const byTarget = new Map<string, Set<string>>()
  for (const doc of docs) {
    if (doc.get('status') !== 'active') continue
    const eventId = typeof doc.get('archiveEventId') === 'string' ? doc.get('archiveEventId') : ''
    const targetType = doc.get('targetType')
    const targetId = typeof doc.get('targetId') === 'string' ? doc.get('targetId') : ''
    if (!eventId || !targetId || (targetType !== 'bundle' && targetType !== 'material' && targetType !== 'activity')) continue
    const key = `${targetType}:${targetId}`
    const values = byTarget.get(key) ?? new Set<string>()
    values.add(eventId)
    byTarget.set(key, values)
  }
  return byTarget
}

function safeOwner(snapshot: DocumentSnapshot | undefined): string | null {
  return snapshot?.exists && typeof snapshot.get('ownerUid') === 'string' ? snapshot.get('ownerUid') : null
}

export const searchArchiveDiscovery = onCall({ region: 'asia-northeast3' }, async (request) => {
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {}
  const filters = filtersFrom(data)
  const limit = archivePageSize(data.limit)
  const cursor = decodeArchiveCursor(data.cursor)
  const viewer = await archiveViewer(request.auth)
  const [eventDocs, relationDocs, bundleDocs, materialDocs, activityDocs, organizerDocs] = await Promise.all([
    completeCollection('archiveEvents'),
    completeCollection('archiveRelations'),
    completeCollection('materialBundles'),
    completeCollection('materials'),
    completeCollection('activities'),
    completeCollection('archiveOrganizers'),
  ])
  const sourceIds = [...new Set(eventDocs.flatMap((doc) => typeof doc.get('sourceCalendarEventId') === 'string' ? [doc.get('sourceCalendarEventId') as string] : []))]
  const sources = new Map<string, DocumentSnapshot>()
  for (let offset = 0; offset < sourceIds.length; offset += 100) {
    const docs = await firestore.getAll(...sourceIds.slice(offset, offset + 100).map((id) => firestore.collection('calendarEvents').doc(id)))
    docs.forEach((doc) => sources.set(doc.id, doc))
  }
  const organizerNames = organizerMap(organizerDocs)
  const eventItems = new Map<string, DiscoveryItem>()
  for (const doc of eventDocs) {
    const organizerIds = Array.isArray(doc.get('organizerIds'))
      ? [...new Set((doc.get('organizerIds') as unknown[]).flatMap((id) => typeof id === 'string' && organizerNames.has(id) ? [id] : []))]
      : []
    const event = projectArchiveEvent(doc, viewer, organizerIds.map((id) => ({ id, displayName: organizerNames.get(id)! })), sources.get(doc.get('sourceCalendarEventId')))
    if (!event) continue
    eventItems.set(event.id, {
      targetType: 'event', id: event.id, title: event.title, href: `/archive-events/${encodeURIComponent(event.id)}`,
      sortMs: eventSortMs(event.heldYear, event.startDateKey), heldYear: event.heldYear, uploadYear: null,
      region: event.region, format: null, formats: [], organizerIds, linkedEventIds: [event.id], canLink: false,
    })
  }
  const relations = relationMap(relationDocs)
  const legacyIds = [...new Set([...materialDocs, ...activityDocs].map((doc) => doc.id))]
  const submissions = legacyIds.length
    ? await firestore.getAll(...legacyIds.map((id) => firestore.collection('submissions').doc(id)))
    : []
  const submissionOwners = new Map(submissions.map((doc) => [doc.id, safeOwner(doc)]))
  const items: DiscoveryItem[] = [...eventItems.values()]
  const readableBundles: NonNullable<ReturnType<typeof projectArchiveBundle>>[] = []
  for (const doc of bundleDocs) {
    const linkedEventIds = [...(relations.get(`bundle:${doc.id}`) ?? [])].filter((id) => eventItems.has(id)).sort()
    const bundle = projectArchiveBundle(doc, viewer, linkedEventIds)
    if (!bundle) continue
    readableBundles.push(bundle)
    const formats = [...new Set(bundle.files.map((file) => file.format))]
    items.push({
      targetType: 'bundle', id: bundle.bundleId, title: bundle.title, href: `/bundles/${encodeURIComponent(bundle.bundleId)}`,
      sortMs: bundle.createdAtMs ?? bundle.updatedAtMs ?? 0, heldYear: null, uploadYear: bundle.uploadYear,
      region: '', format: formats.length === 1 ? formats[0]! : formats.length > 1 ? 'MIXED' : null, formats,
      organizerIds: [], linkedEventIds, canLink: viewer.administrator || (viewer.uid !== null && doc.get('ownerUid') === viewer.uid),
    })
  }
  const readableMaterials: NonNullable<ReturnType<typeof projectArchiveMaterial>>[] = []
  for (const doc of materialDocs) {
    const material = projectArchiveMaterial(doc, viewer)
    if (!material) continue
    readableMaterials.push(material)
    items.push({
      targetType: 'material', id: material.id, title: material.title, href: `/materials/${encodeURIComponent(material.id)}`,
      sortMs: material.uploadedAtMs ?? 0, heldYear: null, uploadYear: material.uploadYear, region: '', format: material.format, formats: [material.format],
      organizerIds: [], linkedEventIds: [...(relations.get(`material:${material.id}`) ?? [])].filter((id) => eventItems.has(id)).sort(),
      canLink: viewer.administrator || (viewer.uid !== null && submissionOwners.get(material.id) === viewer.uid),
    })
  }
  const readableActivities = []
  for (const doc of activityDocs) {
    const activity = projectArchiveActivity(doc, viewer)
    if (!activity) continue
    readableActivities.push(activity)
    items.push({
      targetType: 'activity', id: activity.id, title: activity.title, href: `/activities/${encodeURIComponent(activity.id)}`,
      sortMs: activity.updatedAtMs ?? 0, heldYear: null, uploadYear: activity.uploadYear, region: '', format: null, formats: [],
      organizerIds: [], linkedEventIds: [...(relations.get(`activity:${activity.id}`) ?? [])].filter((id) => eventItems.has(id)).sort(),
      canLink: viewer.administrator || (viewer.uid !== null && submissionOwners.get(activity.id) === viewer.uid),
    })
  }
  const resourcesOnly = data.scope === 'resources'
  const keyword = typeof data.keyword === 'string' ? data.keyword.trim().slice(0, 160).toLocaleLowerCase('ko-KR') : ''
  const filtered = items.filter((item) => (!resourcesOnly || item.targetType === 'material' || item.targetType === 'bundle')
    && (!keyword || item.title.toLocaleLowerCase('ko-KR').includes(keyword))
    && archiveDiscoveryItemMatches(item, filters, eventItems, items)).sort((left, right) => {
    return right.sortMs - left.sortMs || right.targetType.localeCompare(left.targetType) || right.id.localeCompare(left.id)
  })
  const after = filtered.filter((item) => isAfterArchiveCursor({ sortMs: item.sortMs, kind: item.targetType, id: item.id }, cursor))
  const page = after.slice(0, limit)
  const hasMore = after.length > limit
  const last = page.at(-1)
  const filteredIds = new Set(filtered.map((item) => `${item.targetType}:${item.id}`))
  const countedBundles = readableBundles.filter((item) => filteredIds.has(`bundle:${item.bundleId}`))
  const countedMaterials = readableMaterials.filter((item) => filteredIds.has(`material:${item.id}`))
  const countedActivities = readableActivities.filter((item) => filteredIds.has(`activity:${item.id}`))
  const counts = uniqueArchiveCounts({
    eventIds: [...eventItems.keys()].filter((id) => filteredIds.has(`event:${id}`)),
    bundleIds: countedBundles.map((item) => item.bundleId),
    materialIds: countedMaterials.map((item) => item.id),
    activityIds: countedActivities.map((item) => item.id),
    files: [
      ...countedBundles.flatMap((bundle) => bundle.files.map((file) => ({ bundleId: bundle.bundleId, fileId: file.fileId, status: file.status, canDownload: file.canDownload }))),
      ...countedMaterials.filter((material) => material.hasOriginalFile).map((material) => ({ bundleId: `legacy:${material.id}`, fileId: 'original', status: 'ready', canDownload: material.canDownload })),
    ],
  })
  const organizers = [...organizerNames].filter(([id]) => [...eventItems.values()].some((event) => event.organizerIds.includes(id)))
    .map(([id, displayName]) => ({ id, displayName })).sort((left, right) => left.displayName.localeCompare(right.displayName, 'ko') || left.id.localeCompare(right.id))
  return {
    items: page.map((item) => {
      const bundle = readableBundles.find(value => value.bundleId === item.id);
      const source = item.targetType === 'bundle' ? bundleDocs.find(doc => doc.id === item.id) : materialDocs.find(doc => doc.id === item.id);
      const raw = source?.data() ?? {};
      const rights = raw.rights && typeof raw.rights === 'object' ? raw.rights : {};
      const organizers = [...new Set(item.linkedEventIds.flatMap(id => eventItems.get(id)?.organizerIds ?? []))].flatMap(id => organizerNames.get(id) ?? []);
      return ({
      targetType: item.targetType,
      id: item.id,
      title: item.title,
      href: item.href,
      heldYear: item.heldYear,
      uploadYear: item.uploadYear,
      region: item.region,
      format: item.format,
      canLink: item.canLink,
      uploadedAtMs: item.targetType === 'bundle' ? bundle?.createdAtMs ?? null : item.sortMs || null,
      organizerLabel: organizers.join(' · ') || (typeof rights.source === 'string' ? rights.source.trim().slice(0,160) : typeof raw.source === 'string' ? raw.source.trim().slice(0,160) : ''),
      canEdit: viewer.uid !== null && (item.targetType !== 'material' ? raw.ownerUid === viewer.uid : submissionOwners.get(item.id) === viewer.uid),
      ...(item.targetType === 'bundle' ? {files: bundle?.files.map(file => ({fileId:file.fileId, displayName:file.displayName, originalName:file.originalName, format:file.format, sizeBytes:file.sizeBytes,status:file.status})).filter(file => file.status !== 'withdrawn') ?? []} : {}),
      fileCount: item.targetType === 'bundle' ? readableBundles.find(bundle => bundle.bundleId === item.id)?.files.length ?? 0 : item.targetType === 'material' && readableMaterials.find(material => material.id === item.id)?.hasOriginalFile ? 1 : 0,
    });}),
    facets: {
      organizers,
      heldYears: [...new Set([...eventItems.values()].flatMap((item) => item.heldYear === null ? [] : [item.heldYear]))].sort((a, b) => b - a),
      uploadYears: [...new Set(items.flatMap((item) => item.uploadYear === null ? [] : [item.uploadYear]))].sort((a, b) => b - a),
      regions: [...new Set([...eventItems.values()].map((item) => item.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
      formats: [...new Set(items.flatMap((item) => item.formats))].sort(),
    },
    counts,
    totalCount: filtered.length,
    hasMore,
    nextCursor: hasMore && last ? encodeArchiveCursor({ sortMs: last.sortMs, kind: last.targetType, id: last.id }) : null,
    asOfMs: Date.now(), timeZone: ARCHIVE_TIME_ZONE, completeness: 'complete' as const, errors: [] as string[],
    coverage: { readableEvents: eventItems.size, readableBundles: readableBundles.length, readableMaterials: readableMaterials.length, readableActivities: readableActivities.length, safetyLimitPerSource: ARCHIVE_SCAN_LIMIT },
  }
})
