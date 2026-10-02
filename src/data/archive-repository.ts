import {
  activities,
  getActivity,
  getActivityMaterials,
  materials,
  topics,
  type Activity,
  type Material,
  type Topic,
} from '../content'
import type { InstagramPostAttachmentValue } from '../features/social/instagram-url'
import { showPublicFixtures } from '../config/public-fixtures'

export type ArchiveMaterial = Material & {
  updatedAt?: Date
  attachmentStatus?: import('./material-access').AttachmentStatus
  textContent?: import('../features/content/text-content').TextContent
  origin: 'fixture' | 'published'
  redistribution: 'download_allowed' | 'view_only' | 'source_link_only'
  sourceUrl?: string
  sourceProvider?: 'google_drive'
  instagramAttachments?: InstagramPostAttachmentValue[]
  previewStatus?: 'ready' | 'not_provided' | 'queued' | 'failed'
}

export type ArchiveActivity = Activity & {
  materialRedirectId?: string
  id?: string
  linkedMaterialIds?: string[]
  textContent?: import('../features/content/text-content').TextContent
  origin: 'fixture' | 'published'
  visibility: '공개' | '회원 전용'
  instagramAttachments?: InstagramPostAttachmentValue[]
  owner?: string
  source?: string
  attribution?: string
  updatedAt?: Date
}

export type ArchiveAudience = 'public' | 'member'

export type ArchiveMaterialCursor = {
  createdAtSeconds: number
  createdAtNanoseconds: number
  id: string
}

export type ArchiveMaterialPage = {
  items: ArchiveMaterial[]
  nextCursor: ArchiveMaterialCursor | null
  hasMore: boolean
}

export type ArchiveActivityCursor = {
  createdAtSeconds: number
  createdAtNanoseconds: number
  id: string
}

export type ArchiveActivityPage = {
  items: ArchiveActivity[]
  nextCursor: ArchiveActivityCursor | null
  hasMore: boolean
}

export interface ArchiveRepository {
  listActivities(): Promise<Activity[]>
  listMaterials(): Promise<Material[]>
  listTopics(): Promise<Topic[]>
  getActivity(slug: string): Promise<Activity | undefined>
  getActivityMaterials(slug: string): Promise<Material[]>
}

export interface PublishedArchiveRepository {
  getPublicMaterial(id: string, options?: { audience?: ArchiveAudience }): Promise<ArchiveMaterial | undefined>
  listLinkedMaterials(activity: ArchiveActivity, options?: { audience?: ArchiveAudience }): Promise<ArchiveMaterial[]>
  listPublicActivitiesPage(options?: {
    cursor?: ArchiveActivityCursor | null
    pageSize?: number
    audience?: ArchiveAudience
  }): Promise<ArchiveActivityPage>
  getPublicActivity(slug: string, options?: { audience?: ArchiveAudience }): Promise<ArchiveActivity | undefined>
  listPublicActivityMaterialsPage(slug: string, options?: {
    cursor?: ArchiveMaterialCursor | null
    pageSize?: number
    audience?: ArchiveAudience
  }): Promise<ArchiveMaterialPage>
  listPublicMaterialsPage(options?: {
    cursor?: ArchiveMaterialCursor | null
    pageSize?: number
    audience?: ArchiveAudience
  }): Promise<ArchiveMaterialPage>
}

export const fixtureActivities: ArchiveActivity[] = showPublicFixtures
  ? activities.map((activity) => ({
      ...activity,
      origin: 'fixture' as const,
      visibility: '공개' as const,
    }))
  : []

export const fixtureArchiveRepository: ArchiveRepository = {
  async listActivities() {
    return activities
  },
  async listMaterials() {
    return materials
  },
  async listTopics() {
    return topics
  },
  async getActivity(slug) {
    return getActivity(slug)
  },
  async getActivityMaterials(slug) {
    return getActivityMaterials(slug)
  },
}

export const fixtureMaterials: ArchiveMaterial[] = showPublicFixtures
  ? materials.map((material) => ({
      ...material,
      origin: 'fixture' as const,
      redistribution: 'view_only' as const,
    }))
  : []
