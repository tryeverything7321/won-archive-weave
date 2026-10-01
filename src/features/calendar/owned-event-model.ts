import type { CalendarEvent } from "./calendar-model";
import type { EventMediaUpload, ManagedEvent, ManagedEventStatus } from "./event-editor-model";

const registrationStatuses = new Set(["open", "closing_soon", "closed", "not_required"]);

function dateValue(value: unknown, fallback: Date): Date {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate() as Date;
    if (!Number.isNaN(date.getTime())) return date;
  }
  return fallback;
}

export function ownedEventEditorRecord(event: CalendarEvent, record: Record<string, unknown>): ManagedEvent {
  const deadline = dateValue(record.registrationDeadline, event.registrationDeadline ?? new Date(NaN));
  const registrationStatus = registrationStatuses.has(String(record.registrationStatus))
    ? record.registrationStatus as ManagedEvent["registrationStatus"]
    : event.registrationStatus ?? "open";
  return {
    id: event.id,
    title: String(record.title ?? event.title),
    summary: String(record.summary ?? event.summary),
    description: String(record.description ?? event.description),
    startAt: dateValue(record.startAt, event.startAt),
    endAt: dateValue(record.endAt, event.endAt),
    allDay: typeof record.allDay === "boolean" ? record.allDay : event.allDay,
    timeZone: String(record.timeZone ?? event.timeZone),
    region: String(record.region ?? event.region),
    organizerName: String(record.organizerName ?? event.organizerName),
    locationName: String(record.locationName ?? event.locationName),
    address: String(record.address ?? event.address ?? ""),
    onlineUrl: String(record.onlineUrl ?? event.onlineUrl ?? ""),
    registrationUrl: String(record.registrationUrl ?? event.registrationUrl ?? ""),
    ...(Number.isNaN(deadline.getTime()) ? {} : { registrationDeadline: deadline }),
    registrationStatus,
    visibility: record.visibility === "public" || record.visibility === "member_only" ? record.visibility : event.visibility,
    sourceUrl: String(record.sourceUrl ?? event.sourceUrl ?? ""),
    instagramPosts: Array.isArray(record.instagramPosts) ? record.instagramPosts as ManagedEvent["instagramPosts"] : event.instagramPosts ?? [],
    status: record.status as ManagedEventStatus,
    createdAt: dateValue(record.createdAt, event.updatedAt ?? new Date()),
    updatedAt: dateValue(record.updatedAt, event.updatedAt ?? new Date()),
    createdByLabel: "내가 등록한 행사",
    gallery: event.gallery ?? [],
    mediaUploads: Array.isArray(record.mediaUploads) ? record.mediaUploads as EventMediaUpload[] : [],
  };
}
