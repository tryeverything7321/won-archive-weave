import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from 'firebase/auth';
import { calendarRequestIsCurrent } from './calendar-request';
import { CalendarCheck2, CalendarDays, Check, LoaderCircle, LogOut, RefreshCw } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "../../lib/firebase/client";
import { classifyGoogleAuthOutcome, reconcileGoogleCalendarSource, type GoogleAuthSignal } from './google-auth-outcome';
import { googleImportResultModel, type GoogleImportResult } from './google-import-result';

type GoogleTokenResponse = { access_token?: string; error?: string; error_description?: string; error_uri?: string };
type GoogleNonOAuthError = { type?: string };
type GoogleTokenClient = { requestAccessToken: (options?: { prompt?: string }) => void };
type GoogleCalendarListItem = { id: string; summary: string; primary?: boolean; timeZone?: string };
type GoogleCalendarEventItem = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (options: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: GoogleNonOAuthError) => void;
          }) => GoogleTokenClient;
          revoke: (token: string, callback?: () => void) => void;
        };
      };
    };
  }
}

const googleClientId = import.meta.env.VITE_GOOGLE_CALENDAR_CLIENT_ID as string | undefined;
const googleScopes = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
].join(" ");

let googleScriptPromise: Promise<void> | null = null;

class GoogleRequestFailure extends Error {
  constructor(readonly signal: GoogleAuthSignal) {
    super('google-calendar-request');
  }
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => {
        googleScriptPromise = null;
        existing.remove();
        reject(new GoogleRequestFailure({ source: 'network' }));
      }, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleScriptPromise = null;
      script.remove();
      reject(new GoogleRequestFailure({ source: 'network' }));
    };
    document.head.append(script);
  });
  return googleScriptPromise;
}

async function googleApi<T>(path: string, accessToken: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new GoogleRequestFailure({ source: 'network' });
  }
  if (!response.ok) throw new GoogleRequestFailure({ source: 'api_response', status: response.status });
  try {
    return await response.json() as T;
  } catch {
    throw new GoogleRequestFailure({ source: 'unknown' });
  }
}

function defaultDate(offsetDays: number) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function endExclusive(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function eventIso(value: { date?: string; dateTime?: string } | undefined) {
  if (value?.dateTime) return new Date(value.dateTime).toISOString();
  if (value?.date) return new Date(`${value.date}T00:00:00.000Z`).toISOString();
  return "";
}

function eventDateLabel(event: GoogleCalendarEventItem) {
  const start = eventIso(event.start);
  if (!start) return "시간 확인 전";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    ...(event.start?.date ? {} : { timeStyle: "short" as const }),
  }).format(new Date(start));
}

export function GoogleCalendarImport() {
  const services = useMemo(() => getFirebaseServices(), []);
  const accessToken = useRef("");
  const requestEpoch = useRef(0);
  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [events, setEvents] = useState<GoogleCalendarEventItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [eventAffiliations, setEventAffiliations] = useState<Record<string, { organizerName?: string; region?: string }>>({});
  const [from, setFrom] = useState(defaultDate(0));
  const [to, setTo] = useState(defaultDate(90));
  const [organizerName, setOrganizerName] = useState("");
  const [region, setRegion] = useState("전국");
  const [visibility, setVisibility] = useState<"public" | "member_only">("public");
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<"idle" | "connecting" | "ready" | "loading" | "submitting" | "done" | "cancelled" | "error">("idle");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!services) return;
    const unsubscribe = onAuthStateChanged(services.auth, () => {
      requestEpoch.current += 1;
      accessToken.current = '';
      setConnected(false); setCalendars([]); setEvents([]); setSelectedIds(new Set());
      setEventAffiliations({});
      setCalendarId(''); setOrganizerName(''); setRegion('전국'); setVisibility('public'); setState('idle'); setNotice('');
    });
    return () => { unsubscribe(); requestEpoch.current += 1; accessToken.current = ''; };
  }, [services]);

  const startRequest = () => {
    const epoch = ++requestEpoch.current;
    const uid = services?.auth.currentUser?.uid;
    return () => calendarRequestIsCurrent(epoch, requestEpoch.current, uid, services?.auth.currentUser?.uid);
  };

  const showGoogleAuthOutcome = (signal: GoogleAuthSignal) => {
    const outcome = classifyGoogleAuthOutcome(signal);
    if (outcome.kind === 'authorization_expired') {
      accessToken.current = '';
      setConnected(false);
    }
    setState(outcome.state);
    setNotice(outcome.message);
  };

  const showGoogleRequestFailure = (error: unknown) => {
    showGoogleAuthOutcome(error instanceof GoogleRequestFailure ? error.signal : { source: 'unknown' });
  };

  const loadEvents = async (nextCalendarId = calendarId) => {
    if (!accessToken.current || !nextCalendarId) return;
    const isCurrent = startRequest();
    setState("loading");
    setNotice("");
    try {
      const result = await googleApi<{ items?: GoogleCalendarEventItem[]; nextPageToken?: string }>(
        `/calendars/${encodeURIComponent(nextCalendarId)}/events?${new URLSearchParams({
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "100",
          timeMin: new Date(`${from}T00:00:00.000Z`).toISOString(),
          timeMax: endExclusive(to),
        })}`,
        accessToken.current,
      );
      if (!isCurrent()) return;
      setEvents((result.items ?? []).filter((item) => item.status !== "cancelled" && item.id && item.start && item.end));
      setSelectedIds(new Set());
      setState("ready");
      setNotice(result.nextPageToken ? "가까운 일정 100개를 먼저 보여 드려요. 기간을 좁히면 원하는 일정을 더 쉽게 찾을 수 있어요." : "가져올 일정만 골라 주세요.");
    } catch (error) {
      if (!isCurrent()) return;
      showGoogleRequestFailure(error);
    }
  };

  const connect = async () => {
    if (!services?.auth.currentUser) {
      setState("error");
      setNotice("네이버 또는 카카오로 로그인한 뒤 Google Calendar를 연결해 주세요.");
      return;
    }
    if (!googleClientId) {
      showGoogleAuthOutcome({ source: 'configuration' });
      return;
    }
    setState("connecting");
    setNotice("");
    const isCurrent = startRequest();
    try {
      await loadGoogleIdentityServices();
      if (!isCurrent()) return;
      const client = window.google?.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: googleScopes,
        callback: (response) => {
          if (!isCurrent()) return;
          if (!response.access_token || response.error) {
            showGoogleAuthOutcome({
              source: 'oauth_callback',
              error: response.error,
              error_description: response.error_description,
            });
            return;
          }
          accessToken.current = response.access_token;
          void googleApi<{ items?: GoogleCalendarListItem[] }>(
            "/users/me/calendarList?minAccessRole=reader&maxResults=100&fields=items(id,summary,primary,timeZone)",
            response.access_token,
          ).then((result) => {
            if (!isCurrent()) return;
            const nextCalendars = result.items ?? [];
            const nextSource = reconcileGoogleCalendarSource(calendarId, nextCalendars);
            setConnected(true);
            setCalendars(nextCalendars);
            setCalendarId(nextSource.calendarId);
            if (nextSource.clearDependentSelection) {
              setEvents([]);
              setSelectedIds(new Set());
            }
            setState("ready");
            setNotice(nextSource.calendarId ? "가져올 기간을 확인한 뒤 일정을 불러와 주세요." : "읽을 수 있는 캘린더를 찾지 못했어요.");
          }).catch((error: unknown) => {
            if (!isCurrent()) return;
            showGoogleRequestFailure(error);
          });
        },
        error_callback: (error) => {
          if (!isCurrent()) return;
          showGoogleAuthOutcome({ source: 'sdk_error_callback', type: error.type });
        },
      });
      if (!client) throw new GoogleRequestFailure({ source: 'configuration' });
      client.requestAccessToken({ prompt: "consent" });
    } catch (error) {
      if (!isCurrent()) return;
      showGoogleAuthOutcome(error instanceof GoogleRequestFailure ? error.signal : { source: 'configuration' });
    }
  };

  const disconnect = () => {
    requestEpoch.current += 1;
    const token = accessToken.current;
    accessToken.current = "";
    setConnected(false);
    setCalendars([]);
    setEvents([]);
    setSelectedIds(new Set());
    setCalendarId("");
    setEventAffiliations({});
    setState("idle");
    setNotice("Google Calendar 연결을 해제했어요.");
    if (token) window.google?.accounts.oauth2.revoke(token);
  };

  const toggleEvent = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });
  };

  const submit = async (formEvent: React.FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!services?.auth.currentUser || !calendarId || selectedIds.size === 0) return;
    const isCurrent = startRequest();
    const selected = events.filter((item) => selectedIds.has(item.id));
    setState("submitting");
    setNotice("");
    try {
      const callable = httpsCallable(services.functions, "submitSelectedGoogleCalendarEvents");
      const result = await callable({
        organizerName,
        region,
        visibility,
        events: selected.map((item) => ({
          externalId: `${calendarId}:${item.id}`,
          organizerName: eventAffiliations[item.id]?.organizerName ?? organizerName,
          region: eventAffiliations[item.id]?.region ?? region,
          title: item.summary || "제목 없는 일정",
          description: item.description || "",
          locationName: item.location || "",
          startAt: eventIso(item.start),
          endAt: eventIso(item.end),
          allDay: Boolean(item.start?.date),
          timeZone: item.start?.timeZone || calendars.find((calendar) => calendar.id === calendarId)?.timeZone || "Asia/Seoul",
        })),
      });
      const data = result.data as GoogleImportResult;
      if (!isCurrent()) return;
      const outcome = googleImportResultModel(selected.map((item) => item.id), data);
      setState(outcome.tone);
      setNotice(outcome.message);
      setSelectedIds(new Set(outcome.retryIds));
    } catch {
      if (!isCurrent()) return;
      setState("error");
      setNotice("선택한 일정을 보내지 못했어요. 입력 내용과 로그인 상태를 확인해 주세요.");
    }
  };

  return (
    <section className="google-calendar-import" aria-labelledby="google-calendar-import-title">
      <header>
        <div><CalendarDays size={24} /><p>내 Google Calendar에서</p><h2 id="google-calendar-import-title">공유할 일정만 골라 위브로 가져와요</h2></div>
        {connected ? <button type="button" className="google-calendar-disconnect" onClick={disconnect}><LogOut size={16} /> 연결 해제</button> : null}
      </header>
      {!connected ? (
        <div className="google-calendar-connect-state">
          <p>Google Calendar의 일정 목록을 잠시 확인하고, 직접 선택한 일정만 위브에 바로 올립니다.</p>
          <button className="button google-calendar-connect-button" type="button" onClick={() => void connect()} disabled={state === "connecting"}>
            {state === "connecting" ? <LoaderCircle className="spin" size={18} /> : <CalendarCheck2 size={18} />}
            {state === "connecting" ? "Google 연결 중" : "Google Calendar 연결"}
          </button>
          <small>읽기 전용 · 일회성 연결 · 선택하지 않은 일정은 저장하지 않아요</small>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="google-calendar-picker">
            <label><span>가져올 캘린더</span><select value={calendarId} onChange={(event) => { setCalendarId(event.target.value); setEvents([]); setSelectedIds(new Set()); setEventAffiliations({}); }}>{calendars.map((calendar) => <option value={calendar.id} key={calendar.id}>{calendar.summary}{calendar.primary ? " · 기본" : ""}</option>)}</select></label>
            <label><span>시작일</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
            <label><span>종료일</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
            <button type="button" onClick={() => void loadEvents()} disabled={!calendarId || state === "loading"}><RefreshCw className={state === "loading" ? "spin" : ""} size={17} /> 일정 불러오기</button>
          </div>
          {events.length > 0 && <div className="google-calendar-event-list" aria-label="Google Calendar 일정 선택">{events.map((item) => (
            <label className={selectedIds.has(item.id) ? "is-selected" : ""} key={item.id}>
              <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleEvent(item.id)} />
              <span><small>{eventDateLabel(item)}</small><strong>{item.summary || "제목 없는 일정"}</strong>{item.location && <em>{item.location}</em>}</span>
              {selectedIds.has(item.id) && <Check size={18} aria-hidden="true" />}
            </label>
          ))}</div>}
          {events.length > 0 && <div className="google-calendar-share-fields">
            <p>선택한 {selectedIds.size}개의 일정을 어떻게 소개할까요</p>
            <div>
              <label><span>기본 교당·주최</span><input maxLength={80} value={organizerName} onChange={(event) => setOrganizerName(event.target.value)} placeholder="같은 소속이면 여기에 한 번만 입력" /></label>
              <label><span>지역</span><input required maxLength={40} value={region} onChange={(event) => setRegion(event.target.value)} /></label>
              <label><span>공개 범위</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="public">누구나 보기</option><option value="member_only">위브 로그인 이용자만 보기</option></select></label>
            </div>
            {selectedIds.size > 0 && <>
              <p>아래에서 일정마다 교당·주최와 지역을 바꿀 수 있어요. 따로 바꾼 값은 기본값을 수정해도 유지됩니다.</p>
              {events.filter(item => selectedIds.has(item.id)).map(item => (
                <fieldset className="google-calendar-event-affiliation" key={item.id} disabled={state === "submitting"}>
                  <legend>{item.summary || "제목 없는 일정"} · {eventDateLabel(item)}</legend>
                  <div>
                    <label><span>교당·주최</span><input required maxLength={80} value={eventAffiliations[item.id]?.organizerName ?? organizerName} onChange={event => {
                      const value = event.target.value;
                      setEventAffiliations(current => ({ ...current, [item.id]: { ...current[item.id], organizerName: value } }));
                    }} /></label>
                    <label><span>지역</span><input required maxLength={40} value={eventAffiliations[item.id]?.region ?? region} onChange={event => {
                      const value = event.target.value;
                      setEventAffiliations(current => ({ ...current, [item.id]: { ...current[item.id], region: value } }));
                    }} /></label>
                  </div>
                </fieldset>
              ))}
            </>}
            <button className="button button-primary" type="submit" disabled={selectedIds.size === 0 || state === "submitting"}>{state === "submitting" ? <LoaderCircle className="spin" size={18} /> : <CalendarCheck2 size={18} />} 선택한 일정 올리기</button>
          </div>}
        </form>
      )}
      {notice && <p className={`google-calendar-notice is-${state}`} role={state === "error" ? "alert" : "status"}>{notice}</p>}
    </section>
  );
}
