import {
  Timestamp,
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import type { Topic } from "../../content";
import { readInstagramAttachments } from "../social/instagram-url";
import { resolveMediaDisplayMode } from "./calendar-media-presentation";
import { getFirebaseServices } from "../../lib/firebase/client";
import type { CalendarRepository } from "./calendar-repository";
import type {
  CalendarEvent,
  CalendarEventCursor,
  CalendarEventImage,
  CalendarEventPageCursor,
  CalendarVisibility,
} from "./calendar-model";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const MAX_GALLERY_IMAGES = 8;
const SECRET_MEDIA_QUERY_KEY = /(?:token|secret|signature|sig|key|auth|access[_-]?token|private)/i;

function firestore() {
  const services = getFirebaseServices();
  if (!services) throw new Error("Firebase is not configured");
  return services.firestore;
}

function pageSize(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

function timestampCursor(id: string, value: Record<string, unknown>): CalendarEventCursor | null {
  const startAt = value.startAt;
  if (!(startAt instanceof Timestamp)) return null;
  return {
    startAtSeconds: startAt.seconds,
    startAtNanoseconds: startAt.nanoseconds,
    id,
  };
}

function approvedImage(value: unknown): CalendarEventImage | null {
  if (!value || typeof value !== "object") return null;
  const image = value as Record<string, unknown>;
  if (typeof image.url !== "string" || typeof image.alt !== "string") return null;
  const alt = image.alt.trim().slice(0, 180);
  if (!alt) return null;
  try {
    const url = new URL(image.url);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some((key) => SECRET_MEDIA_QUERY_KEY.test(key))) return null;
    const width = typeof image.width === "number" && image.width >= 1 && image.width <= 10_000
      ? Math.floor(image.width)
      : undefined;
    const height = typeof image.height === "number" && image.height >= 1 && image.height <= 10_000
      ? Math.floor(image.height)
      : undefined;
    return { url: url.toString(), alt, displayMode: resolveMediaDisplayMode(image.displayMode), ...(width ? { width } : {}), ...(height ? { height } : {}) };
  } catch {
    return null;
  }
}

function approvedMedia(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const media = value as Record<string, unknown>;
  if (media.status !== "approved") return {};
  const thumbnail = approvedImage(media.thumbnail);
  const gallery = Array.isArray(media.gallery)
    ? media.gallery.map(approvedImage).filter((image): image is CalendarEventImage => image !== null).slice(0, MAX_GALLERY_IMAGES)
    : [];
  return {
    ...(thumbnail ? { thumbnail } : {}),
    ...(gallery.length ? { gallery } : {}),
  };
}

function parseEvent(id: string, value: Record<string, unknown>): CalendarEvent | null {
  const startAt = value.startAt;
  const endAt = value.endAt;
  const registrationDeadline = value.registrationDeadline;
  const updatedAt = value.updatedAt;
  const visibility = value.visibility;
  if (
    value.status !== "published"
    || (visibility !== "public" && visibility !== "member_only")
    || !(startAt instanceof Timestamp)
    || !(endAt instanceof Timestamp)
    || typeof value.title !== "string"
  ) return null;

  return {
    id,
    title: value.title,
    summary: String(value.summary ?? ""),
    description: String(value.description ?? ""),
    organizerName: String(value.organizerName ?? ""),
    startAt: startAt.toDate(),
    endAt: endAt.toDate(),
    allDay: value.allDay === true,
    timeZone: typeof value.timeZone === "string" ? value.timeZone : "Asia/Seoul",
    ...(typeof value.topic === "string" ? { topic: value.topic as Topic } : {}),
    region: String(value.region ?? "전국"),
    locationName: String(value.locationName ?? "장소 확인 중"),
    ...(typeof value.address === "string" ? { address: value.address } : {}),
    ...(typeof value.onlineUrl === "string" ? { onlineUrl: value.onlineUrl } : {}),
    ...(typeof value.registrationUrl === "string" ? { registrationUrl: value.registrationUrl } : {}),
    ...(registrationDeadline instanceof Timestamp ? { registrationDeadline: registrationDeadline.toDate() } : {}),
    ...(value.registrationStatus === "open"
      || value.registrationStatus === "closing_soon"
      || value.registrationStatus === "closed"
      || value.registrationStatus === "not_required"
      ? { registrationStatus: value.registrationStatus }
      : {}),
    ...(typeof value.sourceUrl === "string" ? { sourceUrl: value.sourceUrl } : {}),
    instagramPosts: readInstagramAttachments(value.instagramPosts),
    ...approvedMedia(value.media),
    visibility,
    eventState: value.eventState === "tentative" || value.eventState === "canceled"
      ? value.eventState
      : "confirmed",
    sourceType: value.sourceType === "google" || value.sourceType === "ics" || value.sourceType === "timetree_link"
      ? value.sourceType
      : "manual",
    origin: "published",
    ...(updatedAt instanceof Timestamp ? { updatedAt: updatedAt.toDate() } : {}),
  };
}

async function visibilityPage(options: {
  monthKey: string;
  visibility: CalendarVisibility;
  cursor: CalendarEventCursor | null;
  size: number;
  done: boolean;
}) {
  if (options.done) return { items: [] as CalendarEvent[], cursor: null, done: true };
  const constraints: QueryConstraint[] = [
    where("status", "==", "published"),
    where("visibility", "==", options.visibility),
    where("monthKeys", "array-contains", options.monthKey),
    orderBy("startAt", "asc"),
    orderBy(documentId(), "asc"),
  ];
  if (options.cursor) {
    constraints.push(startAfter(
      new Timestamp(options.cursor.startAtSeconds, options.cursor.startAtNanoseconds),
      options.cursor.id,
    ));
  }
  constraints.push(limit(options.size + 1));
  const snapshot = await getDocs(query(collection(firestore(), "calendarEvents"), ...constraints));
  const docs = snapshot.docs.slice(0, options.size);
  const last = docs.at(-1);
  const cursor = last ? timestampCursor(last.id, last.data()) : null;
  return {
    items: docs.map((item) => parseEvent(item.id, item.data())).filter((item): item is CalendarEvent => item !== null),
    cursor,
    done: snapshot.docs.length <= options.size || cursor === null,
  };
}

const initialCursor: CalendarEventPageCursor = {
  public: null,
  member: null,
  publicDone: false,
  memberDone: false,
};

export const firestoreCalendarRepository: CalendarRepository = {
  async listMonth(options) {
    const size = pageSize(options.pageSize);
    const cursor = options.cursor ?? initialCursor;
    const [publicPage, memberPage] = await Promise.all([
      visibilityPage({
        monthKey: options.monthKey,
        visibility: "public",
        cursor: cursor.public,
        size,
        done: cursor.publicDone,
      }),
      options.includeMember
        ? visibilityPage({
            monthKey: options.monthKey,
            visibility: "member_only",
            cursor: cursor.member,
            size,
            done: cursor.memberDone,
          })
        : Promise.resolve({ items: [] as CalendarEvent[], cursor: null, done: true }),
    ]);
    const items = [...publicPage.items, ...memberPage.items]
      .sort((left, right) => left.startAt.getTime() - right.startAt.getTime() || left.id.localeCompare(right.id));
    const nextCursor = {
      public: publicPage.cursor,
      member: memberPage.cursor,
      publicDone: publicPage.done,
      memberDone: memberPage.done,
    };
    return {
      items,
      nextCursor,
      hasMore: !nextCursor.publicDone || !nextCursor.memberDone,
    };
  },

  async getVisibleEvent(eventId, includeMember) {
    const visibilities: CalendarVisibility[] = includeMember ? ["public", "member_only"] : ["public"];
    for (const visibility of visibilities) {
      const snapshot = await getDocs(query(
        collection(firestore(), "calendarEvents"),
        where(documentId(), "==", eventId),
        where("status", "==", "published"),
        where("visibility", "==", visibility),
        limit(1),
      ));
      const first = snapshot.docs[0];
      if (first) return parseEvent(first.id, first.data()) ?? undefined;
    }
    return undefined;
  },
};
