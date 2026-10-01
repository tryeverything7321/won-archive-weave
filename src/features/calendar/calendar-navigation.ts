import type { CalendarMonth } from "./calendar-model";

export type CalendarView = "month" | "agenda";

export type CalendarSearchState = {
  month: CalendarMonth;
  view: CalendarView;
  region: string;
  organizer: string;
  search: string;
};

export type CalendarListRestore = {
  eventId: string;
  scrollY: number;
};

export type CalendarDetailReturn = {
  returnTo: string;
  historyBack: true;
};

type CalendarFilterableEvent = {
  title: string;
  summary: string;
  description: string;
  locationName: string;
  region: string;
  organizerName: string;
};

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MAX_FILTER_LENGTH = 120;
const MAX_SEARCH_LENGTH = 200;

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function searchParams(value: string | URLSearchParams) {
  return typeof value === "string"
    ? new URLSearchParams(value.startsWith("?") ? value.slice(1) : value)
    : new URLSearchParams(value);
}

function safeText(value: string | null, fallback: string, maxLength: number) {
  if (value === null) return fallback;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || hasControlCharacter(normalized)) return fallback;
  return normalized;
}

function parseMonth(value: string | null, fallback: CalendarMonth): CalendarMonth {
  const match = value?.match(MONTH_PATTERN);
  if (!match) return fallback;
  const year = Number(match[1]);
  if (year < 2000 || year > 2100) return fallback;
  return { year, month: Number(match[2]) - 1 };
}

export function parseCalendarSearch(
  value: string | URLSearchParams,
  fallback: CalendarSearchState,
): CalendarSearchState {
  const params = searchParams(value);
  const view = params.get("view");
  return {
    month: parseMonth(params.get("month"), fallback.month),
    view: view === "month" || view === "agenda" ? view : fallback.view,
    region: safeText(params.get("region"), fallback.region, MAX_FILTER_LENGTH),
    organizer: safeText(params.get("organizer"), fallback.organizer, MAX_FILTER_LENGTH),
    search: safeText(params.get("q"), fallback.search, MAX_SEARCH_LENGTH),
  };
}

export function serializeCalendarSearch(state: CalendarSearchState) {
  const params = new URLSearchParams({
    month: `${state.month.year}-${String(state.month.month + 1).padStart(2, "0")}`,
    view: state.view,
    region: state.region,
    organizer: state.organizer,
    q: state.search,
  });
  return `?${params.toString()}`;
}

export function calendarViewAfterResize(
  current: CalendarView,
  hasExplicitView: boolean,
  isPhone: boolean,
): CalendarView {
  if (hasExplicitView) return current;
  return isPhone ? "agenda" : "month";
}

export function filterCalendarEvents<T extends CalendarFilterableEvent>(
  events: T[],
  filters: Pick<CalendarSearchState, "region" | "organizer" | "search">,
) {
  const needle = filters.search.trim().toLocaleLowerCase("ko-KR");
  return events.filter((event) => {
    if (filters.region !== "전체" && event.region !== filters.region) return false;
    if (filters.organizer !== "전체" && event.organizerName !== filters.organizer) return false;
    if (!needle) return true;
    return [event.title, event.summary, event.description, event.locationName, event.region, event.organizerName]
      .some((value) => value.toLocaleLowerCase("ko-KR").includes(needle));
  });
}

function stateRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeCalendarReturnTo(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value, "https://weave.local");
    if (parsed.origin !== "https://weave.local" || parsed.pathname !== "/calendar") return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function createCalendarListRestoreState(
  currentState: unknown,
  eventId: string,
  scrollY: number,
) {
  const current = stateRecord(currentState) ?? {};
  return {
    ...current,
    calendarRestore: {
      eventId,
      scrollY: Math.max(0, Number.isFinite(scrollY) ? scrollY : 0),
    },
  };
}

export function parseCalendarListRestoreState(value: unknown): CalendarListRestore | null {
  const restore = stateRecord(stateRecord(value)?.calendarRestore);
  if (
    typeof restore?.eventId !== "string"
    || !restore.eventId
    || hasControlCharacter(restore.eventId)
    || restore.eventId.length > 200
    || typeof restore.scrollY !== "number"
    || !Number.isFinite(restore.scrollY)
    || restore.scrollY < 0
  ) return null;
  return { eventId: restore.eventId, scrollY: restore.scrollY };
}

export function createCalendarDetailState(returnTo: string) {
  return {
    calendarReturn: {
      returnTo: safeCalendarReturnTo(returnTo) ?? "/calendar",
      historyBack: true as const,
    },
  };
}

export function parseCalendarDetailState(value: unknown): CalendarDetailReturn | null {
  const calendarReturn = stateRecord(stateRecord(value)?.calendarReturn);
  const returnTo = safeCalendarReturnTo(calendarReturn?.returnTo);
  if (!returnTo || calendarReturn?.historyBack !== true) return null;
  return { returnTo, historyBack: true };
}

export function calendarRestoreDecision(
  restore: CalendarListRestore | null,
  renderedEventIds: string[],
  options: { resultsReady: boolean; hasMore: boolean; loadFailed?: boolean },
): "none" | "wait" | "load-more" | "restore" | "fallback" | "failed" {
  if (!restore) return "none";
  if (!options.resultsReady) return "wait";
  if (renderedEventIds.includes(restore.eventId)) return "restore";
  if (options.loadFailed) return "failed";
  if (options.hasMore) return "load-more";
  return "fallback";
}
