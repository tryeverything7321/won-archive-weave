import { getFirestore, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore'
import { hasCurrentCommunityConsent } from '../auth/terms.js'
import { canReadMaterialBundle, canReadMaterialBundleFile, type MaterialBundleFile, type MaterialBundleRecord } from '../bundles/contracts.js'
import { archiveId, canReadArchiveRecord, type ArchiveCollectionTargetType, type ArchiveViewer } from './model.js'

export type ArchiveBundleFileProjection = {
  fileId: string
  displayName: string
  originalName: string
  sizeBytes: number
  order: number
  status: 'upload_pending' | 'scanning' | 'ready' | 'blocked' | 'error' | 'withdrawn'
  scanStatus: 'pending' | 'clean' | 'blocked' | 'error'
  format: string
  canPreview: boolean
  canDownload: boolean
}

export type ArchiveBundleProjection = {
  bundleId: string
  title: string
  description?: string
  visibility: 'public' | 'member_only' | 'hold'
  status: 'draft' | 'active'
  createdAtMs: number | null
  updatedAtMs: number | null
  uploadYear: number | null
  eventIds: string[]
  files: ArchiveBundleFileProjection[]
}

export type ArchiveMaterialProjection = {
  id: string
  title: string
  visibility: 'public' | 'member_only'
  format: string
  uploadedAtMs: number | null
  uploadYear: number | null
  hasOriginalFile: boolean
  canDownload: boolean
}

export type ArchiveActivityProjection = {
  id: string
  title: string
  visibility: 'public' | 'member_only'
  updatedAtMs: number | null
  uploadYear: number | null
}

export type ArchiveEventProjection = {
  id: string
  title: string
  datePrecision: 'year' | 'day'
  heldYear: number
  startDateKey?: string
  endDateKey?: string
  region: string
  visibility: 'public' | 'member_only' | 'hold'
  status: 'active' | 'canceled'
  sourceCalendarEventId?: string
  organizers: Array<{ id: string; displayName: string }>
  unmatchedOrganizerName?: string
}

function millis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis()
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  return null
}

function yearFromMillis(value: number | null): number | null {
  return value === null ? null : Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(value)))
}

function text(value: unknown, max = 180): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function visibility(value: unknown): 'public' | 'member_only' | 'hold' {
  return value === 'public' || value === 'member_only' ? value : 'hold'
}

function fileStatus(value: unknown): ArchiveBundleFileProjection['status'] {
  if (value === 'upload_pending' || value === 'scanning' || value === 'ready' || value === 'blocked' || value === 'error' || value === 'withdrawn') return value
  return 'error'
}

function scanStatus(value: unknown): ArchiveBundleFileProjection['scanStatus'] {
  if (value === 'clean' || value === 'blocked' || value === 'error') return value
  return 'pending'
}

function fileFormat(value: Record<string, unknown>): string {
  const name = text(value.originalName, 240)
  const extension = name.includes('.') ? name.split('.').pop()?.toUpperCase() : ''
  if (extension && /^[A-Z0-9]{1,10}$/.test(extension)) return extension
  const contentType = text(value.contentType, 100)
  if (contentType.includes('presentation')) return 'PPTX'
  if (contentType === 'application/pdf') return 'PDF'
  return 'FILE'
}

export async function archiveViewer(auth: { uid?: string; token?: Record<string, unknown> } | undefined): Promise<ArchiveViewer> {
  const administrator = auth?.token?.role === 'administrator'
  if (!auth?.uid) return { uid: null, member: false, administrator }
  const user = await getFirestore().collection('users').doc(auth.uid).get()
  const member = user.exists && user.get('connected') === true && hasCurrentCommunityConsent(user.data() ?? {})
  return { uid: member ? auth.uid : null, member, administrator }
}

export function projectArchiveBundle(
  snapshot: DocumentSnapshot,
  viewer: ArchiveViewer,
  eventIds: string[] = [],
): ArchiveBundleProjection | null {
  if (!snapshot.exists) return null
  const data = snapshot.data() ?? {}
  if (data.deletedFromListings === true) return null
  if (typeof data.ownerUid !== 'string' || typeof data.title !== 'string' || typeof data.description !== 'string'
    || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)
    || !Number.isSafeInteger(data.createdAtMs) || !Number.isSafeInteger(data.updatedAtMs)) return null
  const bundle = data as unknown as MaterialBundleRecord
  if (!viewer.administrator && !canReadMaterialBundle(bundle, { uid: viewer.uid, activeMember: viewer.member })) return null
  if (data.status === 'withdrawn') return null
  const owner = viewer.administrator || (viewer.uid !== null && data.ownerUid === viewer.uid)
  const sourceFiles = data.files && typeof data.files === 'object' && !Array.isArray(data.files)
    ? Object.values(data.files as Record<string, unknown>)
    : []
  const files = sourceFiles.flatMap((value): ArchiveBundleFileProjection[] => {
    if (!value || typeof value !== 'object') return []
    const file = value as Record<string, unknown>
    const status = fileStatus(file.status)
    const scan = scanStatus(file.scanStatus)
    if (!owner && (status !== 'ready' || scan !== 'clean')) return []
    const fileId = text(file.fileId, 180)
    if (!fileId) return []
    const ready = canReadMaterialBundleFile(bundle, file as unknown as MaterialBundleFile, { uid: viewer.uid, activeMember: viewer.member })
      || (viewer.administrator && status === 'ready' && scan === 'clean')
    return [{
      fileId,
      displayName: text(file.displayName, 240) || text(file.originalName, 240) || '이름 없는 파일',
      originalName: text(file.originalName, 240),
      sizeBytes: Number.isSafeInteger(file.sizeBytes) && Number(file.sizeBytes) >= 0 ? Number(file.sizeBytes) : 0,
      order: Number.isSafeInteger(file.order) && Number(file.order) >= 0 ? Number(file.order) : 0,
      status,
      scanStatus: scan,
      format: fileFormat(file),
      canPreview: ready,
      canDownload: ready && bundle.rights?.redistribution === 'download_allowed',
    }]
  }).sort((left, right) => left.order - right.order || left.fileId.localeCompare(right.fileId))
  const createdAtMs = millis(data.createdAtMs) ?? millis(data.createdAt)
  const updatedAtMs = millis(data.updatedAtMs) ?? millis(data.updatedAt)
  return {
    bundleId: snapshot.id,
    title: text(data.title, 160) || '제목 없는 자료 묶음',
    ...(text(data.description, 2_000) ? { description: text(data.description, 2_000) } : {}),
    visibility: visibility(data.visibility),
    status: data.status === 'active' ? 'active' : 'draft',
    createdAtMs,
    updatedAtMs,
    uploadYear: yearFromMillis(millis(data.submittedAt) ?? createdAtMs),
    eventIds: [...new Set(eventIds)].sort(),
    files,
  }
}

function materialFormat(data: Record<string, unknown>): string {
  if (data.textContent) return 'TEXT'
  if (data.sourceMode === 'google_drive_link') return 'LINK'
  if (data.sourceMode === 'instagram_url') return 'INSTAGRAM'
  const path = text(data.approvedStoragePath, 500)
  const extension = path.includes('.') ? path.split('.').pop()?.toUpperCase() : ''
  return extension && /^[A-Z0-9]{1,10}$/.test(extension) ? extension : 'FILE'
}

export function projectArchiveMaterial(snapshot: DocumentSnapshot, viewer: ArchiveViewer): ArchiveMaterialProjection | null {
  if (!snapshot.exists) return null
  const data = snapshot.data() ?? {}
  if (data.deletedFromListings === true) return null
  if (!canReadArchiveRecord({ visibility: data.visibility, status: data.status }, viewer)) return null
  const attachmentReadable = data.attachmentStatus === undefined || data.attachmentStatus === 'clean' || data.attachmentStatus === 'not_applicable'
  const hasOriginalFile = attachmentReadable && typeof data.approvedStoragePath === 'string' && Boolean(data.approvedStoragePath)
  const rights = data.rights && typeof data.rights === 'object' ? data.rights as Record<string, unknown> : {}
  const uploadedAtMs = millis(data.createdAt)
  return {
    id: snapshot.id,
    title: text(data.title, 160) || '제목 없는 자료',
    visibility: data.visibility === 'member_only' ? 'member_only' : 'public',
    format: materialFormat(data),
    uploadedAtMs,
    uploadYear: yearFromMillis(uploadedAtMs),
    hasOriginalFile,
    canDownload: hasOriginalFile && rights.redistribution === 'download_allowed',
  }
}

export function projectArchiveActivity(snapshot: DocumentSnapshot, viewer: ArchiveViewer): ArchiveActivityProjection | null {
  if (!snapshot.exists) return null
  const data = snapshot.data() ?? {}
  if (data.deletedFromListings === true) return null
  if (!canReadArchiveRecord({ visibility: data.visibility, status: data.status }, viewer)) return null
  const createdAtMs = millis(data.createdAt)
  return {
    id: snapshot.id,
    title: text(data.title, 160) || '제목 없는 활동 기록',
    visibility: data.visibility === 'member_only' ? 'member_only' : 'public',
    updatedAtMs: millis(data.updatedAt) ?? millis(data.createdAt),
    uploadYear: yearFromMillis(createdAtMs),
  }
}

export function projectArchiveEvent(
  snapshot: DocumentSnapshot,
  viewer: ArchiveViewer,
  organizers: Array<{ id: string; displayName: string }> = [],
  source?: DocumentSnapshot,
): ArchiveEventProjection | null {
  if (!snapshot.exists) return null
  let data = snapshot.data() ?? {}
  if (typeof data.sourceCalendarEventId === 'string') {
    if (!source?.exists || source.get('status') !== 'published'
      || !['public', 'member_only'].includes(source.get('visibility'))) return null
    data = { ...data, title: source.get('title'), visibility: source.get('visibility'),
      status: source.get('eventState') === 'canceled' ? 'canceled' : 'active' }
  }
  if (!canReadArchiveRecord({ visibility: data.visibility, status: data.status, ownerUid: data.ownerUid }, viewer)) return null
  const year = Number(data.heldYear)
  if (!Number.isSafeInteger(year)) return null
  const unmatchedOrganizerName = organizers.length === 0 ? text(data.sourceOrganizerName, 80) : ''
  return {
    id: snapshot.id,
    title: text(data.title, 160) || '제목 없는 행사',
    datePrecision: data.datePrecision === 'day' ? 'day' : 'year',
    heldYear: year,
    ...(typeof data.startDateKey === 'string' ? { startDateKey: data.startDateKey } : {}),
    ...(typeof data.endDateKey === 'string' ? { endDateKey: data.endDateKey } : {}),
    region: text(data.region, 80),
    visibility: visibility(data.visibility),
    status: data.status === 'canceled' ? 'canceled' : 'active',
    ...(typeof data.sourceCalendarEventId === 'string' ? { sourceCalendarEventId: data.sourceCalendarEventId } : {}),
    organizers,
    ...(unmatchedOrganizerName ? { unmatchedOrganizerName } : {}),
  }
}

export async function projectArchiveReference(reference: { targetType: ArchiveCollectionTargetType; targetId: string }, viewer: ArchiveViewer) {
  const firestore = getFirestore()
  const id = archiveId(reference.targetId)
  if (reference.targetType === 'event') {
    const snapshot = await firestore.collection('archiveEvents').doc(id).get()
    const sourceId = snapshot.get('sourceCalendarEventId')
    const source = typeof sourceId === 'string' ? await firestore.collection('calendarEvents').doc(sourceId).get() : undefined
    const event = projectArchiveEvent(snapshot, viewer, [], source)
    return event ? { targetType: 'event' as const, id, title: event.title, href: `/archive-events/${encodeURIComponent(id)}` } : null
  }
  if (reference.targetType === 'bundle') {
    const snapshot = await firestore.collection('materialBundles').doc(id).get()
    const bundle = projectArchiveBundle(snapshot, viewer)
    return bundle ? { targetType: 'bundle' as const, id, title: bundle.title, href: `/bundles/${encodeURIComponent(id)}` } : null
  }
  if (reference.targetType === 'material') {
    const snapshot = await firestore.collection('materials').doc(id).get()
    const material = projectArchiveMaterial(snapshot, viewer)
    return material ? { targetType: 'material' as const, id, title: material.title, href: `/materials/${encodeURIComponent(id)}` } : null
  }
  const snapshot = await firestore.collection('activities').doc(id).get()
  const activity = projectArchiveActivity(snapshot, viewer)
  return activity ? { targetType: 'activity' as const, id, title: activity.title, href: `/activities/${encodeURIComponent(id)}` } : null
}
