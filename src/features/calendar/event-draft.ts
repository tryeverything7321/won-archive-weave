import type { DraftCaptureResult, DraftCodec, DraftIdentity } from "../drafts/draft-store";
import type { EventEditorValue, EventMediaUpload } from "./event-editor-model";

const calendarVisibilities = ["public", "member_only"] as const;
const calendarRegistrationStatuses = ["open", "closing_soon", "closed", "not_required"] as const;
const calendarImageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const calendarImageDisplayModes = ["contain", "cover"] as const;
const maxCalendarGalleryImages = 8;
const maxCalendarImageBytes = 10 * 1024 * 1024;
const draftIdPattern = /^[A-Za-z0-9_-]{8,128}$/u;
const instagramHosts = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
const instagramShortcodePattern = /^[A-Za-z0-9_-]{5,64}$/u;
const instagramAuthorPattern = /^[A-Za-z0-9._]{1,30}$/u;

export type CalendarEventDraftValue = EventEditorValue & {
  visibilitySelected: boolean;
  existingUploads: EventMediaUpload[];
};

export type CalendarEditorAttempt = {
  generation: number;
  uid: string;
};

function recordValue(value: unknown, context = "event"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid_calendar_draft:${context}`);
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, maxLength: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`invalid_calendar_draft:${key}`);
  return value;
}

function oneOf<T extends readonly string[]>(record: Record<string, unknown>, key: string, values: T): T[number] {
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`invalid_calendar_draft:${key}`);
  return value as T[number];
}

function safeDraftUrl(record: Record<string, unknown>, key: string): string {
  const value = stringField(record, key, 2_048);
  if (!value) return value;
  if (/[?&](?:[^=&]*(?:token|secret|auth|code|credential)[^=&]*)=/iu.test(value)) {
    throw new Error(`invalid_calendar_draft:${key}`);
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { return value; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`invalid_calendar_draft:${key}`);
  for (const parameter of parsed.searchParams.keys()) {
    if (/token|secret|auth|code|credential/iu.test(parameter)) throw new Error(`invalid_calendar_draft:${key}`);
  }
  return value;
}

function mediaUploads(value: unknown): EventMediaUpload[] {
  if (!Array.isArray(value) || value.length > maxCalendarGalleryImages + 1) {
    throw new Error("invalid_calendar_draft:existingUploads");
  }
  const paths = new Set<string>();
  let thumbnails = 0;
  let galleries = 0;
  return value.map((item) => {
    const record = recordValue(item, "existingUploads");
    const role = oneOf(record, "role", ["thumbnail", "gallery"] as const);
    const storagePath = stringField(record, "storagePath", 512);
    const fileName = stringField(record, "fileName", 120);
    const contentType = oneOf(record, "contentType", calendarImageMimeTypes);
    const size = record.size;
    const alt = stringField(record, "alt", 180);
    if (
      !storagePath.startsWith("quarantined/")
      || paths.has(storagePath)
      || !Number.isSafeInteger(size)
      || (size as number) <= 0
      || (size as number) > maxCalendarImageBytes
    ) throw new Error("invalid_calendar_draft:existingUploads");
    paths.add(storagePath);
    if (role === "thumbnail") thumbnails += 1;
    else galleries += 1;
    if (thumbnails > 1 || galleries > maxCalendarGalleryImages) throw new Error("invalid_calendar_draft:existingUploads");
    const displayMode = record.displayMode === undefined
      ? undefined
      : oneOf(record, "displayMode", calendarImageDisplayModes);
    return { role, storagePath, fileName, contentType, size: size as number, alt, ...(displayMode ? { displayMode } : {}) };
  });
}

function instagramPosts(value: unknown): EventEditorValue["instagramPosts"] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) throw new Error("invalid_calendar_draft:instagramPosts");
  const seen = new Set<string>();
  return value.map((item) => {
    const record = recordValue(item, "instagramPosts");
    const sourceUrl = stringField(record, "sourceUrl", 2_048);
    let url: URL;
    try { url = new URL(sourceUrl.trim()); } catch { throw new Error("invalid_calendar_draft:instagramPosts"); }
    if (url.protocol !== "https:" || !instagramHosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
      throw new Error("invalid_calendar_draft:instagramPosts");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || (parts[0] !== "p" && parts[0] !== "reel") || !instagramShortcodePattern.test(parts[1])) {
      throw new Error("invalid_calendar_draft:instagramPosts");
    }
    const mediaType = parts[0] === "p" ? "post" : "reel";
    const shortcode = parts[1];
    if (record.mediaType !== mediaType || record.shortcode !== shortcode) throw new Error("invalid_calendar_draft:instagramPosts");
    const canonicalUrl = `https://www.instagram.com/${parts[0]}/${shortcode}/`;
    if (seen.has(canonicalUrl)) throw new Error("invalid_calendar_draft:instagramPosts");
    seen.add(canonicalUrl);
    const originalAuthor = record.originalAuthor === undefined
      ? undefined
      : typeof record.originalAuthor === "string"
        ? record.originalAuthor.trim().replace(/^@/, "")
        : null;
    if (originalAuthor === null || (originalAuthor && !instagramAuthorPattern.test(originalAuthor))) {
      throw new Error("invalid_calendar_draft:instagramPosts");
    }
    return { sourceUrl: canonicalUrl, mediaType, shortcode, ...(originalAuthor ? { originalAuthor } : {}) };
  });
}

function decodeCalendarEventDraft(value: unknown): CalendarEventDraftValue {
  const record = recordValue(value);
  if (typeof record.allDay !== "boolean") throw new Error("invalid_calendar_draft:allDay");
  if (record.visibilitySelected !== undefined && typeof record.visibilitySelected !== "boolean") {
    throw new Error("invalid_calendar_draft:visibilitySelected");
  }
  return {
    title: stringField(record, "title", 120),
    summary: stringField(record, "summary", 240),
    description: stringField(record, "description", 5_000),
    startAt: stringField(record, "startAt", 40),
    endAt: stringField(record, "endAt", 40),
    allDay: record.allDay,
    timeZone: stringField(record, "timeZone", 80),
    region: stringField(record, "region", 40),
    organizerName: stringField(record, "organizerName", 80),
    locationName: stringField(record, "locationName", 160),
    address: stringField(record, "address", 240),
    onlineUrl: safeDraftUrl(record, "onlineUrl"),
    registrationUrl: safeDraftUrl(record, "registrationUrl"),
    registrationDeadline: stringField(record, "registrationDeadline", 40),
    registrationStatus: oneOf(record, "registrationStatus", calendarRegistrationStatuses),
    visibility: oneOf(record, "visibility", calendarVisibilities),
    sourceUrl: safeDraftUrl(record, "sourceUrl"),
    instagramPosts: instagramPosts(record.instagramPosts),
    visibilitySelected: record.visibilitySelected === true,
    existingUploads: mediaUploads(record.existingUploads),
  };
}

export const calendarEventDraftCodec: DraftCodec<CalendarEventDraftValue> = {
  encode: decodeCalendarEventDraft,
  decode: decodeCalendarEventDraft,
};

export function calendarEventDraftIdentity(ownerId: string, eventId: string | undefined, draftId: string): DraftIdentity {
  return eventId
    ? { ownerId, kind: "calendar:event:edit", documentId: eventId }
    : { ownerId, kind: "calendar:event:create", documentId: draftId };
}

export function calendarDraftIdFromSearch(search: string): string | null {
  const draftId = new URLSearchParams(search).get("draft") ?? "";
  return draftIdPattern.test(draftId) ? draftId : null;
}

export function calendarNewDraftPath(draftId: string): string {
  if (!draftIdPattern.test(draftId)) throw new Error("invalid_calendar_draft:draftId");
  return `/calendar/new?${new URLSearchParams({ draft: draftId })}`;
}

export function calendarConnectPath(returnTo: string): string {
  const parsed = new URL(returnTo, "https://weave.local");
  if (parsed.origin !== "https://weave.local" || parsed.pathname !== "/calendar/new" || !calendarDraftIdFromSearch(parsed.search)) {
    throw new Error("invalid_calendar_draft:returnTo");
  }
  return `/calendar/connect?${new URLSearchParams({ returnTo: `${parsed.pathname}${parsed.search}` })}`;
}

export function calendarDraftReturnFromSearch(search: string): string | null {
  const returnTo = new URLSearchParams(search).get("returnTo");
  if (!returnTo || !returnTo.startsWith("/calendar/new?")) return null;
  let parsed: URL;
  try { parsed = new URL(returnTo, "https://weave.local"); } catch { return null; }
  const draftId = parsed.origin === "https://weave.local" && parsed.pathname === "/calendar/new"
    ? calendarDraftIdFromSearch(parsed.search)
    : null;
  return draftId ? calendarNewDraftPath(draftId) : null;
}

export function calendarEventDraftNeedsFileReselection(hasSelectedFiles: boolean): boolean | undefined {
  return hasSelectedFiles ? true : undefined;
}

export function savedCalendarEventDraftRevision(result: DraftCaptureResult | undefined): string | undefined {
  return result?.status === "saved" ? result.revision : undefined;
}

export function calendarEditorAttemptIsCurrent(
  attempt: CalendarEditorAttempt,
  currentGeneration: number,
  currentUid: string | undefined,
): boolean {
  return attempt.generation === currentGeneration && Boolean(attempt.uid) && attempt.uid === currentUid;
}
