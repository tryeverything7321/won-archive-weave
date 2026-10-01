import {
  Timestamp,
  collection,
  documentId,
  doc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import type { Activity, Material, Topic } from '../content'
import { readTextContent } from '../features/content/text-content'
import { isReadablePublication, linkedMaterialIds, readAttachmentStatus, materialFormat, readAccessibleMaterial } from './material-access'
import { readInstagramAttachments } from '../features/social/instagram-url'
import { getFirebaseServices } from '../lib/firebase/client'
import type {
  ArchiveActivity,
  ArchiveActivityCursor,
  ArchiveAudience,
  ArchiveMaterial,
  ArchiveMaterialCursor,
  ArchiveRepository,
  PublishedArchiveRepository,
} from './archive-repository'

const DEFAULT_PUBLIC_MATERIAL_PAGE_SIZE = 24
const MIN_PUBLIC_MATERIAL_PAGE_SIZE = 20
const MAX_PUBLIC_MATERIAL_PAGE_SIZE = 30
const DEFAULT_PUBLIC_ACTIVITY_PAGE_SIZE = 24
const MIN_PUBLIC_ACTIVITY_PAGE_SIZE = 20
const MAX_PUBLIC_ACTIVITY_PAGE_SIZE = 30

function firestore() {
  const services = getFirebaseServices()
  if (!services) throw new Error('Firebase is not configured')
  return services.firestore
}

function activity(value: Record<string, unknown>): Activity | null {
  if (typeof value.slug !== 'string' || typeof value.title !== 'string' || typeof value.topic !== 'string') return null
  const recipeValue = typeof value.recipe === 'object' && value.recipe !== null
    ? value.recipe as Record<string, unknown>
    : null
  const recipe = recipeValue
    && typeof recipeValue.purpose === 'string'
    && typeof recipeValue.preparation === 'string'
    && typeof recipeValue.promotion === 'string'
    && typeof recipeValue.lessons === 'string'
    ? {
        purpose: recipeValue.purpose,
        preparation: recipeValue.preparation,
        promotion: recipeValue.promotion,
        lessons: recipeValue.lessons,
      }
    : undefined
  return {
    slug: value.slug,
    title: value.title,
    topic: value.topic as Topic,
    type: String(value.type ?? ''),
    date: String(value.date ?? ''),
    place: String(value.place ?? ''),
    summary: String(value.summary ?? ''),
    story: String(value.story ?? ''),
    outcome: String(value.outcome ?? ''),
    nextAction: String(value.nextAction ?? ''),
    tone: String(value.tone ?? 'blueprint'),
    ...(recipe ? { recipe } : {}),
  }
}

function publishedActivity(value: Record<string, unknown>, audience: ArchiveAudience): ArchiveActivity | null {
  if (!isReadablePublication(value, audience)) return null
  const parsed = activity(value)
  const instagramAttachments = readInstagramAttachments(value.instagramAttachments)
  return parsed
    ? {
        ...parsed,
        origin: 'published',
        ...(typeof value.id === 'string' ? { id: value.id } : {}),
        linkedMaterialIds: linkedMaterialIds(value),
        ...(readTextContent(value.textContent) ? { textContent: readTextContent(value.textContent) } : {}),
        visibility: value.visibility === 'member_only' ? '회원 전용' : '공개',
        ...(typeof value.owner === 'string' && value.owner.trim() ? { owner: value.owner.trim() } : {}),
        ...(typeof value.source === 'string' && value.source.trim() ? { source: value.source.trim() } : {}),
        ...(typeof value.attribution === 'string' && value.attribution.trim() ? { attribution: value.attribution.trim() } : {}),
        ...(value.updatedAt instanceof Timestamp ? { updatedAt: value.updatedAt.toDate() } : {}),
        ...(instagramAttachments.length ? { instagramAttachments } : {}),
      }
    : null
}

function material(id: string, value: Record<string, unknown>, audience: ArchiveAudience = 'public'): ArchiveMaterial | null {
  if (typeof value.title !== 'string' || !isReadablePublication(value, audience)) return null
  const attachmentStatus = readAttachmentStatus(value.attachmentStatus)
  const attachmentReadable = !attachmentStatus || attachmentStatus === 'clean'
  const approvedStoragePath = attachmentReadable && typeof value.approvedStoragePath === 'string' ? value.approvedStoragePath : ''
  const extension = approvedStoragePath.split('.').pop()?.toUpperCase()
  const rights = typeof value.rights === 'object' && value.rights !== null
    ? value.rights as Record<string, unknown>
    : {}
  const redistribution = rights.redistribution === 'download_allowed' || rights.redistribution === 'source_link_only'
    ? rights.redistribution
    : 'view_only'
  const sourceLink = typeof value.sourceLink === 'object' && value.sourceLink !== null
    ? value.sourceLink as Record<string, unknown>
    : null
  const sourceUrl = verifiedGoogleSourceUrl(sourceLink)
  const instagramAttachments = readInstagramAttachments(value.instagramAttachments)
  const textContent = readTextContent(value.textContent)
  const supportedType = materialFormat(value.sourceMode, Boolean(textContent), extension ?? '')
  const previewStatus = value.previewStatus === 'ready'
    || value.previewStatus === 'not_provided'
    || value.previewStatus === 'queued'
    || value.previewStatus === 'failed'
    ? value.previewStatus
    : undefined
  return {
    id,
    ...(attachmentStatus ? { attachmentStatus } : {}),
    ...(value.updatedAt instanceof Timestamp ? { updatedAt: value.updatedAt.toDate() } : {}),
    ...(textContent ? { textContent } : {}),
    title: value.title,
    type: supportedType as Material['type'],
    activitySlug: typeof value.activitySlug === 'string' ? value.activitySlug : '',
    owner: String(value.owner ?? ''),
    visibility: value.visibility === 'member_only' ? '회원 전용' : '공개',
    availability: (redistribution === 'download_allowed' && Boolean(approvedStoragePath)) || Boolean(sourceUrl)
      ? 'available'
      : 'unavailable',
    description: typeof value.description === 'string' && value.description.trim()
      ? value.description
      : '',
    origin: 'published',
    redistribution,
    ...(previewStatus && attachmentReadable ? { previewStatus } : {}),
    ...(sourceUrl ? { sourceUrl, sourceProvider: 'google_drive' as const } : {}),
    ...(instagramAttachments.length ? { instagramAttachments } : {}),
  }
}

function verifiedGoogleSourceUrl(sourceLink: Record<string, unknown> | null): string | undefined {
  if (sourceLink?.provider !== 'google_drive' || sourceLink.status !== 'verified' || typeof sourceLink.sourceUrl !== 'string') {
    return undefined
  }
  try {
    const url = new URL(sourceLink.sourceUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return undefined
    if (url.hostname === 'drive.google.com' && /^\/file\/d\/[A-Za-z0-9_-]{20,180}\/view$/.test(url.pathname)) {
      return url.toString()
    }
    if (url.hostname === 'docs.google.com' && /^\/(?:document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]{20,180}\/edit$/.test(url.pathname)) {
      return url.toString()
    }
  } catch {
    return undefined
  }
  return undefined
}

function publicMaterialPageSize(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PUBLIC_MATERIAL_PAGE_SIZE
  return Math.min(MAX_PUBLIC_MATERIAL_PAGE_SIZE, Math.max(MIN_PUBLIC_MATERIAL_PAGE_SIZE, Math.floor(value)))
}

function publicActivityPageSize(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PUBLIC_ACTIVITY_PAGE_SIZE
  return Math.min(MAX_PUBLIC_ACTIVITY_PAGE_SIZE, Math.max(MIN_PUBLIC_ACTIVITY_PAGE_SIZE, Math.floor(value)))
}

function materialCursor(id: string, value: Record<string, unknown>): ArchiveMaterialCursor | null {
  const createdAt = value.createdAt
  if (!(createdAt instanceof Timestamp)) return null
  return {
    createdAtSeconds: createdAt.seconds,
    createdAtNanoseconds: createdAt.nanoseconds,
    id,
  }
}

function activityCursor(id: string, value: Record<string, unknown>): ArchiveActivityCursor | null {
  const createdAt = value.createdAt
  if (!(createdAt instanceof Timestamp)) return null
  return {
    createdAtSeconds: createdAt.seconds,
    createdAtNanoseconds: createdAt.nanoseconds,
    id,
  }
}

function visibilityConstraint(audience: ArchiveAudience): QueryConstraint {
  return audience === 'member'
    ? where('visibility', 'in', ['public', 'member_only'])
    : where('visibility', '==', 'public')
}

export const firestoreArchiveRepository: ArchiveRepository = {
  async listActivities() {
    const snapshot = await getDocs(query(collection(firestore(), 'activities'), where('status', '==', 'published'), where('visibility', '==', 'public'), limit(100)))
    return snapshot.docs.map((item) => activity({ id: item.id, ...item.data() })).filter((item): item is Activity => item !== null)
  },
  async listMaterials() {
    const snapshot = await getDocs(query(collection(firestore(), 'materials'), where('status', '==', 'published'), where('visibility', '==', 'public'), limit(100)))
    return snapshot.docs.map((item) => material(item.id, item.data())).filter((item): item is ArchiveMaterial => item !== null)
  },
  async listTopics() {
    const activities = await this.listActivities()
    return [...new Set(activities.map((item) => item.topic))]
  },
  async getActivity(slug) {
    const snapshot = await getDocs(query(collection(firestore(), 'activities'), where('slug', '==', slug), where('status', '==', 'published'), where('visibility', '==', 'public'), limit(1)))
    const first = snapshot.docs[0]
    return first ? activity({ id: first.id, ...first.data() }) ?? undefined : undefined
  },
  async getActivityMaterials(slug) {
    const snapshot = await getDocs(query(collection(firestore(), 'materials'), where('activitySlug', '==', slug), where('status', '==', 'published'), where('visibility', '==', 'public'), limit(50)))
    return snapshot.docs.map((item) => material(item.id, item.data())).filter((item): item is ArchiveMaterial => item !== null)
  },
}

export const publishedArchiveRepository: PublishedArchiveRepository = {
  async getPublicMaterial(id, options = {}) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) return undefined
    const audience = options.audience ?? 'public'
    const snapshot = await readAccessibleMaterial(() => getDocFromServer(doc(firestore(), 'materials', id)))
    return snapshot?.exists() ? material(snapshot.id, snapshot.data(), audience) ?? undefined : undefined
  },
  async listLinkedMaterials(activity, options = {}) {
    const ids = linkedMaterialIds({ linkedMaterialIds: activity.linkedMaterialIds })
    if (!ids.length) return []
    const audience = options.audience ?? 'public'
    // Rules are not filters for an ID query: one hidden ID can reject the whole batch.
    // Bound concurrency while checking each current record independently (maximum 30).
    const items: ArchiveMaterial[] = []
    for (let offset = 0; offset < ids.length; offset += 6) {
      const batch = await Promise.all(ids.slice(offset, offset + 6).map((id) => this.getPublicMaterial(id, { audience })))
      items.push(...batch.filter((item): item is ArchiveMaterial => item !== undefined))
    }
    return items
  },
  async listPublicActivitiesPage(options = {}) {
    const audience = options.audience ?? 'public'
    const pageSize = publicActivityPageSize(options.pageSize)
    const constraints: QueryConstraint[] = [
      where('status', '==', 'published'),
      visibilityConstraint(audience),
      orderBy('createdAt', 'desc'),
      orderBy(documentId(), 'desc'),
    ]
    if (options.cursor) {
      constraints.push(startAfter(
        new Timestamp(options.cursor.createdAtSeconds, options.cursor.createdAtNanoseconds),
        options.cursor.id,
      ))
    }
    constraints.push(limit(pageSize + 1))

    const snapshot = await getDocs(query(collection(firestore(), 'activities'), ...constraints))
    const pageDocs = snapshot.docs.slice(0, pageSize)
    const last = pageDocs.at(-1)
    const nextCursor = last ? activityCursor(last.id, last.data()) : null
    return {
      items: pageDocs
        .map((item) => publishedActivity({ ...item.data(), id: item.id }, audience))
        .filter((item): item is ArchiveActivity => item !== null),
      nextCursor,
      hasMore: snapshot.docs.length > pageSize && nextCursor !== null,
    }
  },
  async getPublicActivity(slug, options = {}) {
    const audience = options.audience ?? 'public'
    const snapshot = await getDocsFromServer(query(
      collection(firestore(), 'activities'),
      where('slug', '==', slug),
      where('status', '==', 'published'),
      visibilityConstraint(audience),
      limit(1),
    ))
    const first = snapshot.docs[0]
    return first ? publishedActivity({ ...first.data(), id: first.id }, audience) ?? undefined : undefined
  },
  async listPublicActivityMaterialsPage(slug, options = {}) {
    const audience = options.audience ?? 'public'
    const pageSize = publicMaterialPageSize(options.pageSize)
    const constraints: QueryConstraint[] = [
      where('activitySlug', '==', slug),
      where('status', '==', 'published'),
      visibilityConstraint(audience),
      orderBy('createdAt', 'desc'),
      orderBy(documentId(), 'desc'),
    ]
    if (options.cursor) {
      constraints.push(startAfter(
        new Timestamp(options.cursor.createdAtSeconds, options.cursor.createdAtNanoseconds),
        options.cursor.id,
      ))
    }
    constraints.push(limit(pageSize + 1))

    const snapshot = await getDocs(query(collection(firestore(), 'materials'), ...constraints))
    const pageDocs = snapshot.docs.slice(0, pageSize)
    const last = pageDocs.at(-1)
    const nextCursor = last ? materialCursor(last.id, last.data()) : null
    return {
      items: pageDocs
        .map((item) => material(item.id, item.data(), audience))
        .filter((item): item is ArchiveMaterial => item !== null),
      nextCursor,
      hasMore: snapshot.docs.length > pageSize && nextCursor !== null,
    }
  },
  async listPublicMaterialsPage(options = {}) {
    const audience = options.audience ?? 'public'
    const pageSize = publicMaterialPageSize(options.pageSize)
    const constraints: QueryConstraint[] = [
      where('status', '==', 'published'),
      visibilityConstraint(audience),
      orderBy('createdAt', 'desc'),
      orderBy(documentId(), 'desc'),
    ]
    if (options.cursor) {
      constraints.push(startAfter(
        new Timestamp(options.cursor.createdAtSeconds, options.cursor.createdAtNanoseconds),
        options.cursor.id,
      ))
    }
    constraints.push(limit(pageSize + 1))

    const snapshot = await getDocs(query(collection(firestore(), 'materials'), ...constraints))
    const pageDocs = snapshot.docs.slice(0, pageSize)
    const last = pageDocs.at(-1)
    const nextCursor = last ? materialCursor(last.id, last.data()) : null
    return {
      items: pageDocs
        .map((item) => material(item.id, item.data(), audience))
        .filter((item): item is ArchiveMaterial => item !== null),
      nextCursor,
      hasMore: snapshot.docs.length > pageSize && nextCursor !== null,
    }
  },
}
