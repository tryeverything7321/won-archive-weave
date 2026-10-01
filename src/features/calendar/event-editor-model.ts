import type { InstagramPostAttachmentValue } from "../social/instagram-url";
import type { CalendarEventImage, CalendarMediaDisplayMode, CalendarVisibility } from "./calendar-model";

export const eventRegistrationStatuses = ["open", "closing_soon", "closed", "not_required"] as const;
export type EventRegistrationStatus = (typeof eventRegistrationStatuses)[number];

export const managedEventStatuses = [
  "draft",
  "review_queued",
  "publishing",
  "publishing_failed",
  "published",
  "updated",
  "canceled",
  "unpublished",
] as const;
export type ManagedEventStatus = (typeof managedEventStatuses)[number];

export function managedEventActions(status: ManagedEventStatus) {
  const canceled = status === "canceled";
  const unpublished = status === "unpublished";
  return {
    canEdit: !unpublished,
    canCancel: !canceled && !unpublished,
    canUnpublish: !unpublished,
    canRestore: unpublished,
    locked: status === "publishing",
  };
}

export type EventMediaUpload = {
  role: "thumbnail" | "gallery";
  storagePath: string;
  fileName: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
  alt: string;
  displayMode?: CalendarMediaDisplayMode;
};

export type EventEditorValue = {
  title: string;
  summary: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timeZone: string;
  region: string;
  organizerName: string;
  locationName: string;
  address: string;
  onlineUrl: string;
  registrationUrl: string;
  registrationDeadline: string;
  registrationStatus: EventRegistrationStatus;
  visibility: CalendarVisibility;
  sourceUrl: string;
  instagramPosts: InstagramPostAttachmentValue[];
};

export type ManagedEvent = Omit<EventEditorValue, "startAt" | "endAt" | "registrationDeadline"> & {
  id: string;
  startAt: Date;
  endAt: Date;
  registrationDeadline?: Date;
  status: ManagedEventStatus;
  contentPublished?: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdByLabel: string;
  thumbnail?: CalendarEventImage;
  gallery: CalendarEventImage[];
  mediaUploads: EventMediaUpload[];
  reviewReason?: string;
  moderationNotice?: { action: 'warn' | 'request_correction' | 'hold' | 'remove' | 'restore'; reason: string; createdAtMs: number };
};

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function managedEventEditorValue(event: ManagedEvent): EventEditorValue {
  const local = (date: Date) => {
    const parts = dateParts(date, event.timeZone);
    return `${parts.date}T${parts.time}`;
  };
  return {
    title: event.title,
    summary: event.summary,
    description: event.description,
    startAt: event.allDay ? dateParts(event.startAt, event.timeZone).date : local(event.startAt),
    endAt: event.allDay ? dateParts(new Date(event.endAt.getTime() - 1), event.timeZone).date : local(event.endAt),
    allDay: event.allDay,
    timeZone: event.timeZone,
    region: event.region,
    organizerName: event.organizerName,
    locationName: event.locationName,
    address: event.address,
    onlineUrl: event.onlineUrl,
    registrationUrl: event.registrationUrl,
    registrationDeadline: event.registrationDeadline ? local(event.registrationDeadline) : "",
    registrationStatus: event.registrationStatus,
    visibility: event.visibility,
    sourceUrl: event.sourceUrl,
    instagramPosts: event.instagramPosts,
  };
}

export function eventEditorDateInputValue(value: string, allDay: boolean): string {
  return allDay ? value.slice(0, 10) : value;
}

export function eventEditorSetAllDayDate(value: string, date: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value) ? `${date}${value.slice(10)}` : date;
}

export function eventEditorToggleAllDay(value: EventEditorValue, allDay: boolean): EventEditorValue {
  if (value.allDay === allDay) return value;
  if (!allDay) {
    return {
      ...value,
      allDay,
      startAt: value.startAt.includes("T") ? value.startAt : `${value.startAt}T09:00`,
      endAt: value.endAt.includes("T") ? value.endAt : `${value.endAt}T11:00`,
    };
  }
  return { ...value, allDay };
}

export function eventEditorSubmissionFields(value: EventEditorValue) {
  const registrationRequired = value.registrationStatus !== "not_required";
  return {
    startAt: value.allDay ? value.startAt.slice(0, 10) : value.startAt,
    endAt: value.allDay ? value.endAt.slice(0, 10) : value.endAt,
    registrationDeadline: registrationRequired ? value.registrationDeadline : "",
    registrationUrl: registrationRequired ? value.registrationUrl : "",
  };
}

export function eventEditorVisibilityIsReady(isEditing: boolean, visibilitySelected: boolean): boolean {
  return isEditing || visibilitySelected;
}

export type EventFileSelection = {
  id: string;
  role: "thumbnail" | "gallery";
  file: File;
  alt: string;
  displayMode?: CalendarMediaDisplayMode;
};

export const eventImageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const maxEventImageBytes = 10 * 1024 * 1024;
export const maxEventGalleryImages = 8;

export function emptyEventEditorValue(now = new Date()): EventEditorValue {
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const local = (value: Date) => {
    const offset = value.getTimezoneOffset() * 60_000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 16);
  };
  return {
    title: "",
    summary: "",
    description: "",
    startAt: local(start),
    endAt: local(end),
    allDay: false,
    timeZone: "Asia/Seoul",
    region: "",
    organizerName: "",
    locationName: "",
    address: "",
    onlineUrl: "",
    registrationUrl: "",
    registrationDeadline: "",
    registrationStatus: "not_required",
    visibility: "public",
    sourceUrl: "",
    instagramPosts: [],
  };
}

export function eventImageFileError(file: File): string | null {
  if (!eventImageMimeTypes.includes(file.type as (typeof eventImageMimeTypes)[number])) {
    return "JPG, PNG, WEBP 사진만 올릴 수 있어요.";
  }
  if (file.size <= 0 || file.size > maxEventImageBytes) {
    return "사진 한 장은 10MB 이하로 올려 주세요.";
  }
  return null;
}

export function sanitizeEventImageName(name: string): string {
  const leaf = name.replace(/\\/g, "/").split("/").pop() ?? "event-image";
  const safe = leaf.normalize("NFKC").replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/_+/g, "_");
  return safe.slice(0, 120) || "event-image";
}

export function validateEventEditorValue(value: EventEditorValue): string | null {
  if (value.title.trim().length < 2) return "행사 이름을 두 글자 이상 입력해 주세요.";
  if (!value.region.trim() || !value.organizerName.trim()) {
    return "지역과 주최를 입력해 주세요.";
  }
  if (!value.locationName.trim() && !value.onlineUrl.trim()) {
    return "행사 장소나 온라인 참여 링크 중 하나를 입력해 주세요.";
  }
  const start = new Date(value.allDay ? `${value.startAt.slice(0, 10)}T00:00:00Z` : value.startAt);
  const end = new Date(value.allDay ? `${value.endAt.slice(0, 10)}T00:00:00Z` : value.endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || (value.allDay ? end < start : end <= start)) {
    return "행사 시작과 종료 시간을 확인해 주세요.";
  }
  const maximumDuration = value.allDay ? 30 : 31;
  if (end.getTime() - start.getTime() > maximumDuration * 24 * 60 * 60 * 1000) {
    return "한 행사는 31일 이내로 등록해 주세요.";
  }
  if (value.registrationStatus !== "not_required" && value.registrationDeadline) {
    const deadline = new Date(value.registrationDeadline);
    const deadlineAfterEnd = value.allDay
      ? value.registrationDeadline.slice(0, 10) > value.endAt.slice(0, 10)
      : deadline > end;
    if (!Number.isFinite(deadline.getTime()) || deadlineAfterEnd) return "신청 마감일을 확인해 주세요.";
  }
  return null;
}

export function managedEventStatusLabel(status: ManagedEventStatus): string {
  return {
    draft: "작성 중",
    review_queued: "사진 확인 중",
    publishing: "공개 준비 중",
    publishing_failed: "공개 재시도 필요",
    published: "공개 중",
    updated: "수정 공개",
    canceled: "행사 취소",
    unpublished: "공개 중단",
  }[status];
}
