import type { Topic } from "../../content";
import type { InstagramPostAttachmentValue } from "../social/instagram-url";

export type CalendarVisibility = "public" | "member_only";
export type CalendarEventState = "confirmed" | "tentative" | "canceled";
export type CalendarEventOrigin = "fixture" | "published";
export type CalendarEventSource = "manual" | "google" | "ics" | "timetree_link";
export type CalendarRegistrationStatus = "open" | "closing_soon" | "closed" | "not_required";
export type CalendarMediaDisplayMode = "contain" | "cover";

export type CalendarEventImage = {
  url: string;
  alt: string;
  width?: number;
  height?: number;
  displayMode?: CalendarMediaDisplayMode;
};

export type CalendarEvent = {
  id: string;
  title: string;
  summary: string;
  description: string;
  organizerName: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  timeZone: string;
  topic?: Topic;
  region: string;
  locationName: string;
  address?: string;
  onlineUrl?: string;
  registrationUrl?: string;
  registrationDeadline?: Date;
  registrationStatus?: CalendarRegistrationStatus;
  sourceUrl?: string;
  thumbnail?: CalendarEventImage;
  gallery?: CalendarEventImage[];
  instagramPosts?: InstagramPostAttachmentValue[];
  visibility: CalendarVisibility;
  eventState: CalendarEventState;
  sourceType: CalendarEventSource;
  origin: CalendarEventOrigin;
  updatedAt?: Date;
};

export type CalendarEventCursor = {
  startAtSeconds: number;
  startAtNanoseconds: number;
  id: string;
};

export type CalendarEventPageCursor = {
  public: CalendarEventCursor | null;
  member: CalendarEventCursor | null;
  publicDone: boolean;
  memberDone: boolean;
};

export type CalendarEventPage = {
  items: CalendarEvent[];
  nextCursor: CalendarEventPageCursor;
  hasMore: boolean;
};

export type CalendarMonth = {
  year: number;
  month: number;
};

export function monthKey({ year, month }: CalendarMonth) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function seoulDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function eventTimeLabel(event: CalendarEvent) {
  if (event.allDay) return "하루 종일";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: event.timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(event.startAt);
}

export function eventDateLabel(event: CalendarEvent) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: event.timeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(event.startAt);
}

export function eventDateTimeLabel(event: CalendarEvent) {
  const date = eventDateLabel(event);
  if (event.allDay) return `${date} · 하루 종일`;
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone: event.timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(event.startAt);
  return `${date} · ${time}`;
}

function googleUtcDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function googleAllDayDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

export function googleCalendarAddUrl(event: CalendarEvent) {
  const parameters = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: event.allDay
      ? `${googleAllDayDate(event.startAt, event.timeZone)}/${googleAllDayDate(event.endAt, event.timeZone)}`
      : `${googleUtcDate(event.startAt)}/${googleUtcDate(event.endAt)}`,
    details: [event.summary, `주최: ${event.organizerName}`].filter(Boolean).join("\n\n"),
    location: [event.locationName, event.address].filter(Boolean).join(" "),
    ctz: event.timeZone,
  });
  return `https://calendar.google.com/calendar/render?${parameters.toString()}`;
}
