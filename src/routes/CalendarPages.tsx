import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  List,
  MapPin,
  RotateCcw,
  UsersRound,
} from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { PageFrame } from "../components/PageFrame";
import { WeaveBadge } from "../components/WeaveBadge";
import { WeaveSymbol } from "../components/WeaveSymbol";
import { showPublicFixtures } from "../config/public-fixtures";
import { CalendarEventMedia } from "../features/calendar/CalendarEventMedia";
import { EventShareLink } from "../features/calendar/EventShareLink";
import { resolveMediaDisplayMode } from "../features/calendar/calendar-media-presentation";
import { InstagramEventEmbed } from "../features/social/InstagramEventEmbed";
import { includeCalendarExample, calendarSearchWithExamples } from "../features/calendar/calendar-example-policy";
import { calendarFixtures, getCalendarFixture } from "../features/calendar/calendar-fixtures";
import { useFirebaseAudience } from "../features/auth/useFirebaseAudience";
import { startOAuthLogin } from "../features/auth/api";
import { ProviderLoginButton } from "../features/auth/ProviderLoginButton";
import {
  eventDateLabel,
  eventDateTimeLabel,
  eventTimeLabel,
  googleCalendarAddUrl,
  monthKey,
  seoulDateKey,
  type CalendarEvent,
  type CalendarEventImage,
  type CalendarEventPageCursor,
  type CalendarMonth,
} from "../features/calendar/calendar-model";
import { firestoreCalendarRepository } from "../features/calendar/firestore-calendar-repository";
import { listPublicExternalCalendars, type ExternalCalendarLink } from "../features/calendar/external-calendar-repository";
import { GoogleCalendarImport } from "../features/calendar/GoogleCalendarImport";
import { EventEditor } from "../features/calendar/EventEditor";
import { OwnedEventActions } from "../features/calendar/OwnedEventActions";
import { eventActionModel } from "../features/calendar/event-action-model";
import { eventDetailPresentation } from "../features/calendar/event-detail-presentation";
import {
  calendarConnectPath,
  calendarDraftIdFromSearch,
  calendarDraftReturnFromSearch,
  calendarNewDraftPath,
} from "../features/calendar/event-draft";
import {
  calendarRestoreDecision,
  createCalendarDetailState,
  createCalendarListRestoreState,
  filterCalendarEvents,
  parseCalendarDetailState,
  parseCalendarListRestoreState,
  parseCalendarSearch,
  serializeCalendarSearch,
  type CalendarSearchState,
} from "../features/calendar/calendar-navigation";
import { getFirebaseServices, isFirebaseConfigured, isOAuthConfigured } from "../lib/firebase/client";
import discoveryStyles from "../features/discovery/DiscoveryExperience.module.css";
import { EventArchivePanel } from "../features/event-archive/EventArchivePanel";

type LoadState = "loading" | "ready" | "error" | "unavailable";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const sourceLabels = {
  manual: "위브에 등록",
  google: "Google Calendar",
  ics: "공유 캘린더",
  timetree_link: "TimeTree",
} as const;

function currentMonth(): CalendarMonth {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function moveMonth(value: CalendarMonth, delta: number): CalendarMonth {
  const date = new Date(value.year, value.month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function monthLabel(value: CalendarMonth) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(
    new Date(value.year, value.month, 1),
  );
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthCells(value: CalendarMonth) {
  const first = new Date(value.year, value.month, 1);
  const start = new Date(value.year, value.month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function eventTouchesDay(event: CalendarEvent, date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return event.startAt < end && event.endAt > start;
}

function dedupeEvents(current: CalendarEvent[], next: CalendarEvent[]) {
  const merged = new Map(current.map((event) => [event.id, event]));
  next.forEach((event) => merged.set(event.id, event));
  return [...merged.values()].sort(
    (left, right) => left.startAt.getTime() - right.startAt.getTime() || left.id.localeCompare(right.id),
  );
}

function EventStateLabel({ event }: { event: CalendarEvent }) {
  if (event.eventState === "canceled") return <WeaveBadge family="workflow" tone="rejected" size="compact" className="calendar-state canceled">취소</WeaveBadge>;
  if (event.eventState === "tentative") return <WeaveBadge family="workflow" tone="warning" size="compact" className="calendar-state tentative">일정 확인 중</WeaveBadge>;
  if (event.visibility === "member_only") return <WeaveBadge family="access" tone="restricted" size="compact" className="calendar-state member">위브 로그인 이용자</WeaveBadge>;
  return null;
}

function CalendarImage({
  image,
  variant,
  fallback,
}: {
  image: CalendarEventImage;
  variant: "month" | "agenda" | "hero" | "gallery";
  fallback?: { date: string; topic: string; region: string };
}) {
  const [failed, setFailed] = useState(false);
  const size = variant === "month"
    ? { width: "100%", height: 36, borderRadius: 6, marginBottom: 7 }
    : variant === "agenda"
      ? { width: "min(100%, 360px)", aspectRatio: "16 / 9", borderRadius: 14, marginBottom: 14 }
      : variant === "gallery"
        ? { width: "100%", aspectRatio: "4 / 3", borderRadius: 18 }
        : { position: "absolute" as const, inset: 0, width: "100%", height: "100%" };
  const fallbackBackground = variant === "hero" ? "#143957" : "#dce9ef";

  return (
    <div
      className={`calendar-event-media calendar-event-media-${variant}${failed ? " is-fallback" : ""}`}
      style={{
        ...size,
        position: variant === "hero" ? "absolute" : "relative",
        overflow: "hidden",
        flexShrink: 0,
        background: fallbackBackground,
      }}
      aria-hidden={failed ? "true" : undefined}
    >
      {fallback && variant !== "hero" && (
        <span className="calendar-record-fallback" aria-hidden="true">
          <small>{fallback.date}</small>
          <strong>{fallback.topic}</strong>
          <i>{fallback.region}</i>
        </span>
      )}
      {!failed && (
        <img
          src={image.url}
          alt={image.alt}
          loading="lazy"
          decoding="async"
          width={image.width ?? 960}
          height={image.height ?? 640}
          onError={() => setFailed(true)}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: resolveMediaDisplayMode(image.displayMode),
            opacity: variant === "hero" ? 0.34 : 1,
          }}
        />
      )}
      {variant === "hero" && (
        <span
          className="calendar-event-media-overlay"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(4, 31, 52, 0.92) 0%, rgba(4, 31, 52, 0.58) 58%, rgba(4, 31, 52, 0.28) 100%)" }}
        />
      )}
    </div>
  );
}

function AgendaCard({
  event,
  index = 0,
  detailState,
  onOpen,
}: {
  event: CalendarEvent;
  index?: number;
  detailState: ReturnType<typeof createCalendarDetailState>;
  onOpen: (event: ReactMouseEvent<HTMLAnchorElement>, eventId: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const actions = eventActionModel(event);
  const accessibleEventLabel = `${eventDateLabel(event)}, ${event.region}, ${event.locationName}, ${event.title}, ${actions.label}`;
  return (
    <motion.article
      className={`${discoveryStyles.agendaCard} calendar-agenda-card ${event.eventState === "canceled" ? "is-canceled" : ""}`}
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.28, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.2) }}
      layout={!reduceMotion}
    >
      <div className="calendar-agenda-date" aria-hidden="true">
        <strong>{new Intl.DateTimeFormat("ko-KR", { day: "2-digit", timeZone: event.timeZone }).format(event.startAt)}</strong>
        <span>{new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: event.timeZone }).format(event.startAt)}</span>
      </div>
      <div className="calendar-agenda-copy">
        <div className="calendar-event-kickers badge-row" data-badge-primary-count={event.origin === "fixture" ? "1" : "0"} data-badge-secondary-count={event.eventState !== "confirmed" || event.visibility === "member_only" ? "1" : "0"}>
          <span className="calendar-plain-meta">{event.region} · {event.organizerName}</span>
          {event.origin === "fixture" && <WeaveBadge family="provenance" tone="fixture" size="compact" className="fixture-label">둘러보기 예시</WeaveBadge>}
          <EventStateLabel event={event} />
        </div>
        <h3><Link aria-label={accessibleEventLabel} data-calendar-event-id={event.id} state={detailState} onClick={(click) => onOpen(click, event.id)} to={`/events/${event.id}`}>{event.title}</Link></h3>
        <p>{event.summary}</p>
        <div className="calendar-agenda-meta">
          <span><Clock3 size={16} /> {eventTimeLabel(event)}</span>
          <span><MapPin size={16} /> {event.locationName}</span>
        </div>
        <p className={discoveryStyles.eventActionState}>{actions.label}</p>
        {event.thumbnail && (
          <CalendarImage
            image={event.thumbnail}
            variant="agenda"
            fallback={{
              date: eventDateLabel(event),
              topic: event.topic ?? "행사",
              region: event.region,
            }}
          />
        )}
      </div>
      <Link className="calendar-card-arrow" state={detailState} onClick={(click) => onOpen(click, event.id)} to={`/events/${event.id}`} aria-label={`${accessibleEventLabel}, 자세히 보기`}>
        <ArrowRight size={20} />
      </Link>
    </motion.article>
  );
}

export function CalendarPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { audience, ready: audienceReady } = useFirebaseAudience();
  const [fallbackSearch] = useState<CalendarSearchState>(() => ({
    month: currentMonth(),
    view: window.matchMedia("(max-width: 767px)").matches ? "agenda" : "month",
    region: "전체",
    organizer: "전체",
    search: "",
  }));
  const navigationSearch = useMemo(
    () => parseCalendarSearch(location.search, fallbackSearch),
    [fallbackSearch, location.search],
  );
  const { month, view, region, organizer, search } = navigationSearch;
  const [publishedEvents, setPublishedEvents] = useState<CalendarEvent[]>([]);
  const [cursor, setCursor] = useState<CalendarEventPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>(() => isFirebaseConfigured ? "loading" : "unavailable");
  const [loadingMore, setLoadingMore] = useState(false);
  const [restoreDismissed, setRestoreDismissed] = useState(false);
  const [externalCalendars, setExternalCalendars] = useState<ExternalCalendarLink[]>([]);
  const requestId = useRef(0);
  const calendarShellRef = useRef<HTMLElement>(null);
  const restorationFinished = useRef(false);
  const reduceMotion = useReducedMotion();
  const selectedMonthKey = monthKey(month);
  const examplesEnabled = showPublicFixtures && includeCalendarExample(new URLSearchParams(location.search));
  const canonicalCalendarSearch = calendarSearchWithExamples(serializeCalendarSearch(navigationSearch), examplesEnabled);
  const returnTo = `/calendar${canonicalCalendarSearch}`;
  const detailState = useMemo(() => createCalendarDetailState(returnTo), [returnTo]);
  const restore = useMemo(() => parseCalendarListRestoreState(location.state), [location.state]);

  useEffect(() => {
    const canonicalSearch = canonicalCalendarSearch;
    if (location.search === canonicalSearch) return;
    navigate({ pathname: "/calendar", search: canonicalSearch }, { replace: true, state: location.state });
  }, [location.search, location.state, navigate, canonicalCalendarSearch]);

  const updateNavigation = useCallback((patch: Partial<CalendarSearchState>, replace = false) => {
    const next = { ...navigationSearch, ...patch };
    navigate({ pathname: "/calendar", search: calendarSearchWithExamples(serializeCalendarSearch(next), examplesEnabled) }, { replace });
  }, [navigate, navigationSearch, examplesEnabled]);

  const openEvent = useCallback((click: ReactMouseEvent<HTMLAnchorElement>, eventId: string) => {
    if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
    click.preventDefault();
    navigate(
      { pathname: "/calendar", search: canonicalCalendarSearch },
      { replace: true, state: createCalendarListRestoreState(location.state, eventId, window.scrollY) },
    );
    navigate(`/events/${eventId}`, { state: createCalendarDetailState(returnTo) });
  }, [location.state, navigate, canonicalCalendarSearch, returnTo]);

  const loadEvents = useCallback(async (nextCursor: CalendarEventPageCursor | null, append: boolean) => {
    if (!isFirebaseConfigured) return;
    const currentRequest = ++requestId.current;
    if (append) setLoadingMore(true);
    else {
      setLoadState("loading");
      setPublishedEvents([]);
      setCursor(null);
      setHasMore(false);
    }
    try {
      const page = await firestoreCalendarRepository.listMonth({
        monthKey: selectedMonthKey,
        includeMember: audience === "member",
        cursor: nextCursor,
        pageSize: 25,
      });
      if (currentRequest !== requestId.current) return;
      setPublishedEvents((current) => append ? dedupeEvents(current, page.items) : page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setLoadState("ready");
    } catch {
      if (currentRequest === requestId.current) setLoadState("error");
    } finally {
      if (currentRequest === requestId.current) setLoadingMore(false);
    }
  }, [audience, selectedMonthKey]);

  useEffect(() => {
    if (isFirebaseConfigured && audienceReady) void Promise.resolve().then(() => loadEvents(null, false));
    return () => {
      requestId.current += 1;
    };
  }, [audienceReady, loadEvents]);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    let active = true;
    void listPublicExternalCalendars().then((items) => {
      if (active) setExternalCalendars(items);
    }).catch(() => {
      if (active) setExternalCalendars([]);
    });
    return () => { active = false; };
  }, []);

  const fixtures = useMemo(
    () => examplesEnabled ? calendarFixtures.filter((event) =>
      seoulDateKey(event.startAt).startsWith(selectedMonthKey)
      && (event.visibility === "public" || audience === "member")) : [],
    [audience, selectedMonthKey, examplesEnabled],
  );
  const allEvents = useMemo(
    () => dedupeEvents(publishedEvents, fixtures),
    [fixtures, publishedEvents],
  );
  const regions = useMemo(
    () => ["전체", ...new Set(allEvents.map((event) => event.region))],
    [allEvents],
  );
  const organizers = useMemo(
    () => ["전체", ...new Set(allEvents.map((event) => event.organizerName))],
    [allEvents],
  );
  const shownEvents = useMemo(
    () => filterCalendarEvents(allEvents, { region, organizer, search }),
    [allEvents, organizer, region, search],
  );
  const cells = useMemo(() => monthCells(month), [month]);
  const todayKey = dayKey(new Date());

  const resetToToday = () => {
    updateNavigation({ month: currentMonth(), region: "전체", organizer: "전체", search: "" });
  };

  useLayoutEffect(() => {
    if (restorationFinished.current || restoreDismissed || !restore || loadingMore) return;
    const selected = [...document.querySelectorAll<HTMLElement>("[data-calendar-event-id]")]
      .find((element) => element.dataset.calendarEventId === restore.eventId);
    const decision = calendarRestoreDecision(
      restore,
      selected ? [restore.eventId] : [],
      { resultsReady: loadState !== "loading", hasMore, loadFailed: loadState === "error" },
    );
    if (decision === "load-more") {
      void Promise.resolve().then(() => loadEvents(cursor, true));
      return;
    }
    if (decision === "restore" && selected) {
      restorationFinished.current = true;
      selected.focus({ preventScroll: true });
      window.scrollTo({ top: restore.scrollY, behavior: "instant" });
      return;
    }
    if (decision === "fallback") {
      restorationFinished.current = true;
      calendarShellRef.current?.focus({ preventScroll: true });
      calendarShellRef.current?.scrollIntoView({ block: "start" });
    }
  }, [cursor, hasMore, loadEvents, loadingMore, loadState, restore, restoreDismissed, shownEvents, view]);

  return (
    <PageFrame
      eyebrow="전국 행사 일정"
      title={<><span>이번 달의 만남을 보고</span><br />{" "}<span>마음 가는 곳으로 이어져요</span></>}
      description={examplesEnabled
        ? "전국 교당과 교구, 청년 모임이 올린 일정을 한곳에서 살펴보세요. 실제 일정과 둘러보기 예시가 함께 표시됩니다."
        : "전국 교당과 교구, 청년 모임의 일정을 한곳에서 살펴보세요."}
    >
      <section className="calendar-planner-cta">
        <div className="calendar-planner-message">
          <WeaveSymbol decorative />
          <div>
            <p>새로운 만남을 알리고 싶다면</p>
            <h2>함께할 행사를 알려 주세요</h2>
          </div>
        </div>
        <div className="calendar-planner-actions">
          <Link className="button button-primary" to="/calendar/new">행사 등록하기</Link>
          <Link className="button button-secondary" to="/profile?tab=activity&manage=events">내 일정 수정·삭제</Link>
        </div>
      </section>
      <section className="calendar-shell" aria-labelledby="calendar-month-title" ref={calendarShellRef} tabIndex={-1}>
        <div className="calendar-toolbar">
          <div className="calendar-month-control">
            <button type="button" onClick={() => updateNavigation({ month: moveMonth(month, -1) })} aria-label="이전 달 보기">
              <ChevronLeft size={21} />
            </button>
            <AnimatePresence mode="wait" initial={false}>
              <motion.h2
                id="calendar-month-title"
                key={selectedMonthKey}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
                transition={{ duration: reduceMotion ? 0 : 0.22 }}
              >
                {monthLabel(month)}
              </motion.h2>
            </AnimatePresence>
            <button type="button" onClick={() => updateNavigation({ month: moveMonth(month, 1) })} aria-label="다음 달 보기">
              <ChevronRight size={21} />
            </button>
            <button className="calendar-today" type="button" onClick={resetToToday}>오늘</button>
          </div>
          <div className="calendar-view-toggle" aria-label="일정 보기 방식">
            <button type="button" className={view === "month" ? "is-active" : ""} aria-pressed={view === "month"} onClick={() => updateNavigation({ view: "month" })}>
              <CalendarDays size={18} /> 월별
            </button>
            <button type="button" className={view === "agenda" ? "is-active" : ""} aria-pressed={view === "agenda"} onClick={() => updateNavigation({ view: "agenda" })}>
              <List size={18} /> 목록
            </button>
          </div>
        </div>

        <div className="calendar-filter-panel">
          <label>
            <span>지역</span>
            <select value={region} onChange={(event) => updateNavigation({ region: event.target.value })}>
              {!regions.includes(region) && <option>{region}</option>}
              {regions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>교당·주최</span>
            <select value={organizer} onChange={(event) => updateNavigation({ organizer: event.target.value })}>
              {!organizers.includes(organizer) && <option>{organizer}</option>}
              {organizers.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>행사 내용</span>
            <input type="search" value={search} onChange={(event) => updateNavigation({ search: event.target.value }, true)} placeholder="행사명, 장소, 내용 검색" />
          </label>
          <p>{monthLabel(month)}에 불러온 일정을 지역과 주최별로 골라 볼 수 있어요.</p>
        </div>

        <div className="calendar-origin-key" aria-label="일정 구분">
          <span><i className="is-live" /> 불러온 실제 일정 {shownEvents.filter(event => event.origin !== "fixture").length}건</span>
          {examplesEnabled && <span><i className="is-fixture" /> 예시 {shownEvents.filter(event => event.origin === "fixture").length}건</span>}
          {showPublicFixtures && <label><input type="checkbox" checked={examplesEnabled} onChange={event => navigate({ pathname: "/calendar", search: calendarSearchWithExamples(serializeCalendarSearch(navigationSearch), event.target.checked) })} /> 예시 보기</label>}
        </div>

        {loadState === "loading" && publishedEvents.length === 0 && (
          <div className="calendar-load-state" role="status">공개 일정을 불러오고 있어요.</div>
        )}
        {loadState === "error" && publishedEvents.length === 0 && (
          <div className="calendar-load-state" role="alert">
            <p>{examplesEnabled
              ? "공개 일정을 불러오지 못했어요. 예시 일정은 계속 둘러볼 수 있습니다."
              : "공개 일정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."}</p>
            <button type="button" onClick={() => void loadEvents(null, false)}><RotateCcw size={17} /> 다시 시도</button>
          </div>
        )}
        {loadState === "unavailable" && (
          <div className="calendar-load-state">{examplesEnabled
            ? "현재는 예시 일정으로 위브의 캘린더 흐름을 보여 드립니다."
            : "아직 공개된 일정이 없어요. 새 행사를 등록해 주세요."}</div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {view === "month" ? (
            <motion.div
              className="calendar-month-grid"
              key={`month-${selectedMonthKey}`}
              initial={reduceMotion ? false : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -18 }}
              transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              {weekdays.map((weekday) => <div className="calendar-weekday" key={weekday}>{weekday}</div>)}
              {cells.map((date) => {
                const events = shownEvents.filter((event) => eventTouchesDay(event, date));
                const key = dayKey(date);
                const outside = date.getMonth() !== month.month;
                return (
                  <div className={`calendar-day ${outside ? "is-outside" : ""} ${key === todayKey ? "is-today" : ""}`} key={key}>
                    <span className="calendar-day-number">{date.getDate()}<i>{key === todayKey ? "오늘" : ""}</i></span>
                    <div className="calendar-day-events">
                      {events.slice(0, 3).map((event) => (
                        <Link
                          aria-label={`${eventDateLabel(event)}, ${event.region}, ${event.locationName}, ${event.organizerName}, ${event.title}, ${eventActionModel(event).label}`}
                          className={`calendar-day-event ${event.origin === "fixture" ? "is-fixture" : "is-live"}`}
                          data-calendar-event-id={event.id}
                          state={detailState}
                          onClick={(click) => openEvent(click, event.id)}
                          to={`/events/${event.id}`}
                          key={event.id}
                        >
                          {event.thumbnail && (
                            <CalendarImage
                              image={event.thumbnail}
                              variant="month"
                              fallback={{
                                date: eventDateLabel(event),
                                topic: event.topic ?? "행사",
                                region: event.region,
                              }}
                            />
                          )}
                          <span className="calendar-day-event-taxonomy">
                            <i className="is-region">{event.region}</i>
                            <i className="is-organizer">{event.organizerName}</i>
                          </span>
                          <b>{event.title}</b>
                          <small>{eventTimeLabel(event)}</small>
                        </Link>
                      ))}
                      {events.length > 3 && <span className="calendar-more-count">일정 {events.length - 3}개 더 있음</span>}
                    </div>
                  </div>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              className="calendar-agenda-list"
              key={`agenda-${selectedMonthKey}`}
              initial={reduceMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
              transition={{ duration: reduceMotion ? 0 : 0.26 }}
            >
              {shownEvents.length > 0
                ? shownEvents.map((event, index) => <AgendaCard event={event} index={index} detailState={detailState} onOpen={openEvent} key={event.id} />)
                : <div className="calendar-empty"><CalendarDays size={28} /><h3>이달에는 조건에 맞는 일정이 없어요</h3><p>지역, 주최, 행사 내용을 바꾸어 다시 살펴보세요.</p></div>}
            </motion.div>
          )}
        </AnimatePresence>

        {hasMore && loadState !== "error" && (
          <div className="calendar-load-more">
            <button type="button" disabled={loadingMore} onClick={() => void loadEvents(cursor, true)}>
              {loadingMore ? "일정을 불러오는 중" : "이달의 일정 더 보기"}
            </button>
          </div>
        )}
        {restore && !restoreDismissed && loadState === "error" && publishedEvents.length > 0 && (
          <div className="calendar-load-state" role="alert">
            <p>선택한 일정을 더 불러오지 못했어요. 다시 시도하거나 현재 결과를 살펴보세요.</p>
            <button type="button" disabled={loadingMore} onClick={() => void loadEvents(cursor, true)}>
              <RotateCcw size={17} /> 선택한 일정 다시 불러오기
            </button>
            <button type="button" onClick={() => {
              restorationFinished.current = true;
              setRestoreDismissed(true);
              calendarShellRef.current?.focus({ preventScroll: true });
              calendarShellRef.current?.scrollIntoView({ block: "start" });
            }}>현재 결과 보기</button>
          </div>
        )}
      </section>

      {externalCalendars.length > 0 && (
        <section className="external-calendar-links" aria-labelledby="external-calendar-title">
          <div><p>외부 공개 캘린더</p><h2 id="external-calendar-title">쓰던 캘린더에서도 일정을 이어서 살펴보세요</h2><span>외부 캘린더의 공개 범위와 최신 일정은 각 운영 주체가 관리합니다.</span></div>
          <div>{externalCalendars.map((calendar) => <a href={calendar.publicUrl} target="_blank" rel="noopener noreferrer" key={calendar.id}><CalendarDays size={21} /><span><small>{calendar.region} · {calendar.organizerName}</small><strong>{calendar.name}</strong></span><ExternalLink size={18} /></a>)}</div>
        </section>
      )}


    </PageFrame>
  );
}

export function CalendarEventCreatePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [draftId] = useState(() => calendarDraftIdFromSearch(location.search)
    ?? `draft-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`}`);
  const [savedEvent, setSavedEvent] = useState<{ eventId: string; status: "review_queued" | "published" | "updated" | "canceled" }>();
  const completionRef = useRef<HTMLElement>(null);
  const draftPath = useMemo(() => calendarNewDraftPath(draftId), [draftId]);

  useEffect(() => {
    if (`${location.pathname}${location.search}` === draftPath) return;
    navigate(draftPath, { replace: true, state: location.state });
  }, [draftPath, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (savedEvent) completionRef.current?.focus();
  }, [savedEvent]);

  return (
    <PageFrame
      eyebrow="행사 등록"
      title="새 행사 내용을 입력해요"
      description="행사 이름부터 적어 등록하세요. 이미 적어 둔 Google Calendar 일정은 아래에서 가져올 수 있습니다."
    >
      {savedEvent ? (
        <section className={discoveryStyles.completionPanel} ref={completionRef} tabIndex={-1} role="status" aria-labelledby="event-save-complete-title">
          <div className={discoveryStyles.completionHeading}>
            <CheckCircle2 size={26} aria-hidden="true" />
            <div>
              <h2 id="event-save-complete-title">행사를 저장했어요</h2>
              <p>{savedEvent.status === "review_queued" ? "행사 내용은 공개됐고 사진은 파일 보안 검사가 끝나면 표시됩니다." : "저장한 행사가 일정에 반영됐습니다."}</p>
            </div>
          </div>
          <div className={discoveryStyles.completionActions} aria-label="저장한 행사 다음 행동">
            <Link className="button button-primary" to={`/events/${encodeURIComponent(savedEvent.eventId)}`}>저장한 행사 보기 <ArrowRight size={17} /></Link>
            <Link className="button button-secondary" to="/calendar">행사 일정으로 돌아가기</Link>
          </div>
        </section>
      ) : <EventEditor hideHeading draftId={draftId} returnTo={draftPath} onSaved={setSavedEvent} />}
      {!savedEvent && <section className="calendar-import-shortcut">
        <div>
          <CalendarDays size={22} aria-hidden="true" />
          <p>이미 Google Calendar에 적어 둔 일정이 있나요</p>
          <h2>같은 내용을 다시 입력하지 않아도 돼요</h2>
        </div>
        <Link className="button button-secondary" to={calendarConnectPath(draftPath)}>
          Google Calendar에서 가져오기 <ArrowRight size={17} />
        </Link>
      </section>}
    </PageFrame>
  );
}

type CalendarSourceType = "google_public_ics" | "ics" | "timetree_link";

export function CalendarConnectPage() {
  const location = useLocation();
  const draftReturn = useMemo(() => calendarDraftReturnFromSearch(location.search), [location.search]);
  const connectReturnTo = `/calendar/connect${location.search}`;
  const [connectionMode, setConnectionMode] = useState<'personal' | 'organization'>('personal');
  const { audience, ready: audienceReady } = useFirebaseAudience();
  const [sourceType, setSourceType] = useState<CalendarSourceType>("google_public_ics");
  const [name, setName] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [region, setRegion] = useState("전국");
  const [url, setUrl] = useState("");
  const [visibility, setVisibility] = useState<"public" | "member_only">("public");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const services = getFirebaseServices();
    if (!services?.auth.currentUser) {
      setState("error");
      setMessage("로그인한 뒤 캘린더를 연결해 주세요.");
      return;
    }
    setState("submitting");
    setMessage("");
    try {
      const callable = httpsCallable(services.functions, "submitCalendarSource");
      await callable({
        name,
        organizerName,
        region,
        visibility,
        sourceType,
        ...(sourceType === "timetree_link" ? { publicUrl: url } : { feedUrl: url }),
      });
      setState("done");
      setMessage(sourceType === "timetree_link"
        ? "연결 요청을 보냈어요. 운영자가 공개 범위와 주소를 확인한 뒤 TimeTree 링크를 연결합니다."
        : "연결 요청을 보냈어요. 운영자가 공개 범위와 원본 주소를 확인한 뒤 일정을 가져옵니다.");
    } catch {
      setState("error");
      setMessage("연결 요청을 보내지 못했어요. 로그인 상태와 캘린더 주소를 확인해 주세요.");
    }
  };

  const urlLabel = sourceType === "timetree_link" ? "TimeTree 공개 캘린더 주소" : "공개 iCal 주소";
  const guide = sourceType === "google_public_ics"
    ? { title: "Google Calendar에서", steps: ["캘린더 설정을 열어요", "일정의 액세스 권한을 공개로 바꿔요", "캘린더 통합에서 공개 iCal 형식 주소를 복사해요"] }
    : sourceType === "timetree_link"
      ? { title: "TimeTree에서", steps: ["공유할 캘린더를 열어요", "공개 캘린더 설정을 확인해요", "공개 캘린더 주소를 복사해요"] }
      : { title: "다른 캘린더에서", steps: ["캘린더의 공유 설정을 열어요", "공개 범위를 확인해요", "HTTPS로 시작하는 ICS 주소를 복사해요"] };
  return (
    <PageFrame
      eyebrow="행사 일정"
      title="캘린더 연결하기"
      description="공유할 일정을 골라 위브에 가져오세요. 개인 일정과 단체의 공개 캘린더 중에서 선택할 수 있어요."
    >
      {draftReturn && <Link className="back-link" to={draftReturn}><ArrowLeft size={17} /> 작성 중인 행사로 돌아가기</Link>}
      <div className="profile-section-nav" aria-label="가져올 캘린더 선택">
        <button type="button" aria-pressed={connectionMode === 'personal'} onClick={() => setConnectionMode('personal')}>내 Google 일정 가져오기</button>
        <button type="button" aria-pressed={connectionMode === 'organization'} onClick={() => setConnectionMode('organization')}>단체 공개 캘린더 연결</button>
      </div>
      {connectionMode === 'personal' ? <GoogleCalendarImport /> : <>
      {audienceReady && audience !== "member" && (
        <section className="event-editor-state" aria-labelledby="calendar-connect-login-title">
          <div>
            <h2 id="calendar-connect-login-title">로그인한 뒤 이 화면으로 돌아와요</h2>
            <p>로그인하면 입력하던 캘린더 연결 화면으로 바로 복귀합니다.</p>
          </div>
          <div className="community-login-actions" aria-label="캘린더 연결 로그인">
            <ProviderLoginButton
              disabled={!isOAuthConfigured}
              provider="kakao"
              onClick={() => startOAuthLogin("kakao", connectReturnTo)}
            />
            <ProviderLoginButton
              disabled={!isOAuthConfigured}
              provider="naver"
              onClick={() => startOAuthLogin("naver", connectReturnTo)}
            />
<ProviderLoginButton
              disabled={!isOAuthConfigured}
              provider="google"
              onClick={() => startOAuthLogin("google", connectReturnTo)}
            />
          </div>
          {!isOAuthConfigured && <small>로그인 연결을 준비하고 있어요.</small>}
        </section>
      )}
      <div className="calendar-connect-divider"><span>교당·교구의 공개 행사 캘린더를 연결하려면</span></div>
      <section className="calendar-connect-layout">
        <form className="calendar-connect-form" onSubmit={submit}>
          <fieldset>
            <legend>위브로 가져올 공개 캘린더를 선택해 주세요</legend>
            <div className="calendar-source-options">
              {([
                ["google_public_ics", "Google Calendar", "공개 iCal 주소로 일정을 가져와요"],
                ["ics", "공개 ICS", "다른 캘린더의 ICS 주소를 연결해요"],
                ["timetree_link", "TimeTree", "공개 캘린더를 새 창에서 함께 보여 줘요"],
              ] as const).map(([value, label, help]) => (
                <label className={sourceType === value ? "is-selected" : ""} key={value}>
                  <input type="radio" name="sourceType" value={value} checked={sourceType === value} disabled={state === "submitting"} onChange={() => {
                    setSourceType(value);
                    setUrl("");
                    setMessage("");
                    setState("idle");
                  }} />
                  <strong>{label}</strong><span>{help}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="calendar-connect-grid">
            <label><span>캘린더 이름</span><input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 서울교구 청년 일정" /></label>
            <label><span>운영 주체</span><input required maxLength={80} value={organizerName} onChange={(event) => setOrganizerName(event.target.value)} placeholder="예: 서울교구 청년회" /></label>
            <label><span>지역</span><input required maxLength={40} value={region} onChange={(event) => setRegion(event.target.value)} /></label>
            <label><span>공개 범위</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as "public" | "member_only")}><option value="public">누구나 보기</option><option value="member_only">위브 로그인 이용자만 보기</option></select></label>
            <label className="is-wide"><span>{urlLabel}</span><input required type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label>
          </div>
          <p className="calendar-connect-help">비공개 캘린더는 아직 연결하지 않아요. 원본 캘린더에서 공개 범위를 먼저 확인해 주세요.</p>
          <button className="button button-primary" type="submit" disabled={state === "submitting"}>{state === "submitting" ? "연결 요청을 보내는 중" : "공개 캘린더 연결 요청"}</button>
          {message && <p className={`calendar-connect-message is-${state}`} role={state === "error" ? "alert" : "status"}>{message}</p>}
        </form>
        <aside className="calendar-connect-guide">
          <CalendarDays size={30} />
          <p>{guide.title}</p>
          <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <span>비공개 일정과 개인 캘린더는 연결하지 않는 편이 안전해요.</span>
        </aside>
      </section>
      </>}
    </PageFrame>
  );
}

export function CalendarEventPage() {
  const { eventId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const calendarReturn = useMemo(() => parseCalendarDetailState(location.state), [location.state]);
  const { audience, ready: audienceReady } = useFirebaseAudience();
  const storedFixture = eventId ? getCalendarFixture(eventId) : undefined;
  const fixture = storedFixture && (storedFixture.visibility === "public" || audience === "member")
    ? storedFixture
    : undefined;
  const [published, setPublished] = useState<CalendarEvent>();
  const [state, setState] = useState<"loading" | "ready" | "error">(
    () => isFirebaseConfigured || !audienceReady ? "loading" : "ready",
  );
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!eventId || !isFirebaseConfigured || !audienceReady) return;
    const currentRequest = ++requestId.current;
    if (!fixture) setState("loading");
    try {
      const result = await firestoreCalendarRepository.getVisibleEvent(eventId, audience === "member");
      if (currentRequest !== requestId.current) return;
      setPublished(result);
      setState("ready");
    } catch {
      if (currentRequest === requestId.current) setState("error");
    }
  }, [audience, audienceReady, eventId, fixture]);

  useEffect(() => {
    if (isFirebaseConfigured && audienceReady) void Promise.resolve().then(load);
    return () => { requestId.current += 1; };
  }, [audienceReady, load]);

  const event = published ?? fixture;
  if (!event && state === "loading") {
    return <PageFrame eyebrow="행사 일정" title="일정을 불러오고 있어요" description="잠시만 기다려 주세요."><div className="calendar-load-state" role="status">행사 정보를 확인하고 있어요.</div></PageFrame>;
  }
  if (!event && state === "error") {
    return <PageFrame eyebrow="행사 일정" title="일정을 불러오지 못했어요" description="연결 상태를 확인한 뒤 다시 시도해 주세요."><div className="calendar-load-state" role="alert"><button type="button" onClick={() => void load()}><RotateCcw size={17} /> 다시 시도</button><Link to={calendarReturn?.returnTo ?? "/calendar"}>행사 일정으로 돌아가기</Link></div></PageFrame>;
  }
  if (!event) return <PageFrame eyebrow="행사 일정" title="이 일정을 찾을 수 없어요" description="일정이 삭제되었거나 공개 범위가 바뀌었을 수 있습니다."><Link className="button button-secondary" to={calendarReturn?.returnTo ?? "/calendar"}>행사 일정으로 돌아가기</Link></PageFrame>;
  const actions = eventActionModel(event);
  const presentation = eventDetailPresentation(event);

  return (
    <article className="calendar-detail section-frame">
      {calendarReturn
        ? <button className="back-link" type="button" onClick={() => navigate(-1)}><ArrowLeft size={17} /> 행사 일정으로 돌아가기</button>
        : <Link className="back-link" to="/calendar"><ArrowLeft size={17} /> 행사 일정으로 돌아가기</Link>}
      {event.origin !== "fixture" && <OwnedEventActions event={event} onChanged={() => void load()} />}
      <header className={`calendar-detail-hero${presentation.hasThumbnail ? "" : " is-without-media"}`}>
        {presentation.hasThumbnail && <div className="calendar-detail-orbit" aria-hidden="true"><span /><i /></div>}
        <div className="calendar-event-kickers badge-row" data-badge-primary-count={event.origin === "fixture" ? "1" : "0"} data-badge-secondary-count={event.eventState !== "confirmed" || event.visibility === "member_only" ? "1" : "0"}>
          <span className="calendar-plain-meta">{event.region} · {event.organizerName}</span>
          {event.origin === "fixture" && <WeaveBadge family="provenance" tone="fixture" size="compact" className="fixture-label">둘러보기 예시</WeaveBadge>}
          <EventStateLabel event={event} />
        </div>
        <h1>{event.title}</h1>
        {presentation.summary && <p>{presentation.summary}</p>}
      </header>
      {event.origin === "fixture" && <p className="calendar-load-state">둘러보기용 예시입니다. 실제 모집 중인 행사가 아닙니다.</p>}
      <div className={`calendar-detail-overview${event.thumbnail ? " has-poster" : ""}`}>
        {event.thumbnail && <div className="calendar-detail-poster"><CalendarEventMedia image={event.thumbnail} /></div>}
      <div className={`${discoveryStyles.detailEssentials} calendar-detail-information`}>
        <aside className="calendar-detail-meta">
          <div><CalendarDays size={19} /><span>일시</span><strong>{eventDateTimeLabel(event)}</strong></div>
          <div><MapPin size={19} /><span>장소</span><strong>{event.locationName}</strong>{event.address && <small>{event.address}</small>}</div>
          <div><UsersRound size={19} /><span>주최</span><strong>{event.organizerName}</strong></div>
          {presentation.showSource && <div><ExternalLink size={19} /><span>가져온 곳</span><strong>{sourceLabels[event.sourceType]}</strong></div>}
        </aside>
        <section className={`calendar-detail-actions${!actions.registration && !event.sourceUrl ? " is-simple" : ""}`}>
          <div>
            <p>{actions.label}</p>
            <p className="calendar-action-description">{actions.description}</p>
          </div>
          <div>
            {event.origin !== "fixture" && <EventShareLink eventId={event.id} />}
            {event.origin !== "fixture" && actions.canAddToCalendar && <a className="button button-google-calendar" href={googleCalendarAddUrl(event)} target="_blank" rel="noopener noreferrer">구글 캘린더에 담기 <CalendarPlus size={17} /></a>}
            {event.origin !== "fixture" && actions.registration && <a className="button button-primary" href={actions.registration.url} target="_blank" rel="noreferrer">{actions.registration.label} <ExternalLink size={17} /></a>}
            {event.sourceUrl && <a className="button button-secondary" href={event.sourceUrl} target="_blank" rel="noreferrer">원본 일정 보기 <ExternalLink size={17} /></a>}
          </div>
        </section>
      </div>
      </div>
      <div className={`calendar-detail-layout${presentation.description ? "" : " is-without-description"}`}>
        {presentation.description && <section className="calendar-detail-story">
          <h2>행사 소개</h2>
          <p>{presentation.description}</p>
          {event.eventState === "canceled" && <div className="calendar-canceled-note">이 일정은 취소되었습니다. 이동하기 전에 주최 측 안내를 확인해 주세요.</div>}
        </section>}
        {!presentation.description && event.eventState === "canceled" && <div className="calendar-canceled-note">이 일정은 취소되었습니다. 이동하기 전에 주최 측 안내를 확인해 주세요.</div>}
      </div>
      <EventArchivePanel event={event} />
      {event.gallery && event.gallery.length > 0 && (
        <section className="calendar-event-gallery" aria-labelledby="calendar-gallery-title" style={{ padding: "0 clamp(4px, 4vw, 54px) clamp(42px, 7vw, 94px)" }}>
          <p className="detail-topic">행사 사진</p>
          <h2 id="calendar-gallery-title">함께한 장면을 둘러보세요</h2>
          <div className="calendar-event-gallery-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16, marginTop: 24 }}>
            {event.gallery.map((image) => <CalendarEventMedia image={image} key={image.url} />)}
          </div>
        </section>
      )}
      <InstagramEventEmbed posts={event.instagramPosts ?? []} />
    </article>
  );
}
