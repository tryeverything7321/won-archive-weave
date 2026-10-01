import type { CalendarEvent, CalendarEventPage } from "../calendar/calendar-model";
import type { CalendarRepository } from "../calendar/calendar-repository";

const DISPLAY_COUNT = 3;
const SEARCH_MONTHS = 4;

export function selectUpcomingEvents(events: CalendarEvent[], now: Date, count = DISPLAY_COUNT) {
  const unique = new Map<string, CalendarEvent>();
  for (const event of events) {
    if (
      event.origin !== "published"
      || event.visibility !== "public"
      || event.eventState === "canceled"
      || event.endAt.getTime() <= now.getTime()
    ) continue;
    unique.set(event.id, event);
  }
  return [...unique.values()]
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime() || left.id.localeCompare(right.id))
    .slice(0, count);
}

function seoulMonth(now: Date, offset: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function loadUpcomingEvents(
  repository: CalendarRepository,
  now = new Date(),
  onProgress?: (events: CalendarEvent[]) => void,
) {
  const found: CalendarEvent[] = [];
  const firstPage = (offset: number) => repository.listMonth({
    monthKey: seoulMonth(now, offset), includeMember: false, cursor: null, pageSize: 50,
  });
  // Wrap speculative reads immediately: an unused later-month failure must not
  // become an unhandled rejection after the nearest three events are found.
  type Result = { page: CalendarEventPage } | { error: unknown };
  const settle = (request: Promise<CalendarEventPage>): Promise<Result> => request.then(
    (page) => ({ page }), (error: unknown) => ({ error }),
  );
  let laterMonths: Array<Promise<Result>> = [];
  for (let offset = 0; offset < SEARCH_MONTHS; offset += 1) {
    let result: Result = offset === 0 ? await settle(firstPage(0)) : await laterMonths[offset - 1];
    for (;;) {
      if ("error" in result) throw result.error;
      const page = result.page;
      found.push(...page.items);
      const selected = selectUpcomingEvents(found, now);
      if (selected.length) onProgress?.(selected);
      if (selected.length >= DISPLAY_COUNT) return selected;
      if (!page.hasMore) break;
      result = await settle(repository.listMonth({
        monthKey: seoulMonth(now, offset), includeMember: false,
        cursor: page.nextCursor, pageSize: 50,
      }));
    }
    if (offset === 0) {
      laterMonths = Array.from({ length: SEARCH_MONTHS - 1 }, (_, index) => settle(firstPage(index + 1)));
    }
  }
  return selectUpcomingEvents(found, now);
}
