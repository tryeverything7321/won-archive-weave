export type ArchiveVisibility = "public" | "member_only" | "hold";
export type ArchiveRelationTarget = "bundle" | "material" | "activity";
export type ArchiveCollectionVisibility = ArchiveVisibility;
export type ArchiveCollectionTarget = "event" | ArchiveRelationTarget;

export type ArchiveOrganizer = {
  id: string;
  displayName: string;
};

export type ArchiveEventSummary = {
  id: string;
  title: string;
  datePrecision: "year" | "day";
  heldYear: number;
  startDateKey?: string;
  endDateKey?: string;
  region: string;
  organizers: ArchiveOrganizer[];
  unmatchedOrganizerName?: string;
  sourceCalendarEventId?: string;
  status: string;
  visibility: ArchiveVisibility;
};

export type ArchiveRelationSummary = {
  id: string;
  title: string;
  description?: string;
  targetType: ArchiveRelationTarget;
  visibility?: ArchiveVisibility;
  fileCount?: number;
  downloadableFileCount?: number;
  pendingFileCount?: number;
  canLink?: boolean;
};

export type EventArchiveOverview = {
  archiveEvent: ArchiveEventSummary | null;
  bundles: ArchiveRelationSummary[];
  materials: ArchiveRelationSummary[];
  activities: ArchiveRelationSummary[];
  counts: {
    bundleCount: number;
    materialCount: number;
    activityCount: number;
    fileCount: number;
    downloadableFileCount: number;
    pendingFileCount: number;
  };
  asOfMs: number;
  timeZone: "Asia/Seoul";
  completeness: "complete";
};

export type ArchiveDiscoveryFilters = {
  organizerId?: string;
  heldYear?: number;
  uploadYear?: number;
  region?: string;
  format?: string;
};

export type ArchiveDiscoveryFacet = {
  value: string;
  label: string;
};

export type ArchiveDiscoveryResult = {
  items: ArchiveDiscoveryItem[];
  counts: {
    eventCount: number;
    bundleCount: number;
    materialCount: number;
    activityCount: number;
    fileCount: number;
  };
  facets: {
    organizers: ArchiveOrganizer[];
    heldYears: number[];
    uploadYears: number[];
    regions: string[];
    formats: string[];
  };
  nextCursor?: string;
  hasMore: boolean;
  totalCount: number;
  asOfMs: number;
  timeZone: "Asia/Seoul";
  completeness: "complete";
};

export type ArchiveDiscoveryItem = {
  targetType: "event" | ArchiveRelationTarget;
  id: string;
  title: string;
  href: string;
  heldYear: number | null;
  uploadYear: number | null;
  region: string;
  format: string | null;
  canLink: boolean;
};

export type ArchiveCollectionItem = {
  id: string;
  title: string;
  href?: string;
  description?: string;
  order: number;
  targetType: ArchiveCollectionTarget;
};

export type ArchiveCollection = {
  id: string;
  title: string;
  description: string;
  visibility: ArchiveCollectionVisibility;
  ownerLabel?: string;
  canEdit?: boolean;
  items?: ArchiveCollectionItem[];
  visibleItemCount?: number;
  updatedAtMs?: number;
};

export function archiveRelationPath(item: Pick<ArchiveRelationSummary, "id" | "targetType">) {
  if (item.targetType === "bundle") return `/bundles/${encodeURIComponent(item.id)}`;
  if (item.targetType === "material") return `/materials/${encodeURIComponent(item.id)}`;
  return `/activities/${encodeURIComponent(item.id)}`;
}

export function archiveTargetLabel(targetType: ArchiveCollectionTarget) {
  if (targetType === "event") return "행사";
  if (targetType === "bundle") return "자료 묶음";
  if (targetType === "material") return "개별 자료";
  return "활동 기록";
}

export function archiveEventDateLabel(event: ArchiveEventSummary) {
  if (event.datePrecision === "year") return `${event.heldYear}년`;
  if (!event.startDateKey) return `${event.heldYear}년`;
  const start = new Date(`${event.startDateKey}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime())) return `${event.heldYear}년`;
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(start);
}

export function pastEventYearIsValid(value: number, currentYear = new Date().getFullYear()) {
  return Number.isInteger(value) && value >= 1945 && value <= currentYear;
}

export function eventContextQuery(calendarEventId: string, kind: "material" | "activity", returnTo: string) {
  const search = new URLSearchParams({ kind, calendarEventId, returnTo });
  return `/contribute?${search.toString()}`;
}

export function archiveEventContextQuery(archiveEventId: string, kind: "material" | "activity", returnTo: string) {
  const search = new URLSearchParams({ kind, archiveEventId, returnTo });
  return `/contribute?${search.toString()}`;
}
