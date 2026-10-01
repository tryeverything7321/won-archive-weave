import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "../../lib/firebase/client";
import type {
  ArchiveCollection,
  ArchiveCollectionTarget,
  ArchiveCollectionVisibility,
  ArchiveDiscoveryFilters,
  ArchiveDiscoveryResult,
  ArchiveOrganizer,
  ArchiveRelationTarget,
  ArchiveRelationSummary,
  ArchiveVisibility,
  EventArchiveOverview,
} from "./event-archive-model";

function callable<TInput, TOutput>(name: string) {
  const services = getFirebaseServices();
  if (!services) throw new Error("Firebase is not configured");
  return httpsCallable<TInput, TOutput>(services.functions, name);
}

export async function getEventArchiveOverview(input: { archiveEventId?: string; sourceCalendarEventId?: string }) {
  type RawBundle = { bundleId: string; title: string; description?: string; visibility?: ArchiveVisibility; files?: Array<{ status?: string; canDownload?: boolean }> };
  type RawMaterial = { id: string; title: string; visibility?: ArchiveVisibility; format?: string; canDownload?: boolean };
  type RawActivity = { id: string; title: string; visibility?: ArchiveVisibility };
  type RawOverview = Omit<EventArchiveOverview, "bundles" | "materials" | "activities"> & { bundles: RawBundle[]; materials: RawMaterial[]; activities: RawActivity[] };
  const response = await callable<typeof input, RawOverview>("getEventArchiveOverview")(input);
  const bundles: ArchiveRelationSummary[] = response.data.bundles.map((item) => ({
    id: item.bundleId,
    title: item.title,
    description: item.description,
    targetType: "bundle",
    visibility: item.visibility,
    fileCount: item.files?.length ?? 0,
    downloadableFileCount: item.files?.filter((file) => file.canDownload).length ?? 0,
    pendingFileCount: item.files?.filter((file) => file.status === "upload_pending" || file.status === "scanning").length ?? 0,
  }));
  const materials: ArchiveRelationSummary[] = response.data.materials.map((item) => ({ id: item.id, title: item.title, targetType: "material", visibility: item.visibility, description: item.format }));
  const activities: ArchiveRelationSummary[] = response.data.activities.map((item) => ({ id: item.id, title: item.title, targetType: "activity", visibility: item.visibility }));
  return { ...response.data, bundles, materials, activities };
}

export async function ensureArchiveEventContext(input: {
  requestId: string;
  sourceCalendarEventId?: string;
  title?: string;
  datePrecision?: "year" | "day";
  heldYear?: number;
  startDateKey?: string;
  endDateKey?: string;
  region?: string;
  visibility?: "public" | "member_only";
  organizerIds?: string[];
}) {
  const response = await callable<typeof input, { archiveEventId: string }>("ensureArchiveEventContext")(input);
  return response.data;
}

export async function linkArchiveRelation(input: {
  requestId: string;
  archiveEventId: string;
  targetType: ArchiveRelationTarget;
  targetId: string;
}) {
  const response = await callable<typeof input, { linked: boolean }>("linkArchiveRelation")(input);
  return response.data;
}

export async function unlinkArchiveRelation(input: {
  requestId: string;
  archiveEventId: string;
  targetType: ArchiveRelationTarget;
  targetId: string;
}) {
  const response = await callable<typeof input, { unlinked: boolean }>("unlinkArchiveRelation")(input);
  return response.data;
}

export async function searchArchiveDiscovery(filters: ArchiveDiscoveryFilters & { cursor?: string; limit?: number }) {
  // Callable encoding converts undefined object fields to null. Omit absent filters.
  const input = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));
  const response = await callable<typeof input, ArchiveDiscoveryResult>("searchArchiveDiscovery")(input);
  return response.data;
}

export async function listArchiveOrganizers(input: { cursor?: string; limit?: number } = {}) {
  const response = await callable<typeof input, { items: Array<ArchiveOrganizer & { aliases?: string[]; activityRegion?: string }>; nextCursor?: string; hasMore: boolean }>("listArchiveOrganizers")(input);
  return response.data;
}

export async function listArchiveCollections(input: { cursor?: string; limit?: number } = {}) {
  const response = await callable<typeof input, { items: ArchiveCollection[]; nextCursor?: string; hasMore: boolean }>("listArchiveCollections")(input);
  return response.data;
}

export async function getArchiveCollection(collectionId: string) {
  type RawCollection = Omit<ArchiveCollection, "items"> & { items?: Array<{ targetType: ArchiveCollectionTarget; id: string; title: string; description?: string }> };
  const response = await callable<{ collectionId: string }, { collection: RawCollection | null }>("getArchiveCollection")({ collectionId });
  return response.data.collection
    ? { ...response.data.collection, items: (response.data.collection.items ?? []).map((item, order) => ({ ...item, order })) } as ArchiveCollection
    : null;
}

export async function createArchiveCollection(input: {
  requestId: string;
  title: string;
  description: string;
  visibility: ArchiveCollectionVisibility;
}) {
  const response = await callable<typeof input, { collectionId: string; status: "active"; repeated: boolean }>("createArchiveCollection")(input);
  return response.data;
}

export async function updateArchiveCollection(input: {
  requestId: string;
  collectionId: string;
  title: string;
  description: string;
  visibility: ArchiveCollectionVisibility;
}) {
  const response = await callable<typeof input, { updated: boolean }>("updateArchiveCollection")(input);
  return response.data;
}

export async function replaceArchiveCollectionItems(input: {
  requestId: string;
  collectionId: string;
  items: Array<{ targetType: ArchiveCollectionTarget; targetId: string }>;
}) {
  const response = await callable<typeof input, { updated: boolean }>("replaceArchiveCollectionItems")(input);
  return response.data;
}

export function newArchiveRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
