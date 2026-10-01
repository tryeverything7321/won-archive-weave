import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { Link } from "react-router-dom";
import { CalendarClock, CircleAlert, LoaderCircle, Pencil, RotateCw, Trash2, XCircle } from "lucide-react";
import { getFirebaseServices } from "../../lib/firebase/client";
import { WeaveBadge } from "../../components/WeaveBadge";
import { workflowBadgeTone } from "../../components/weave-badge-model";
import { eventMediaNotice } from './event-media-notice';
import { managedEventActions, managedEventStatusLabel, type ManagedEvent } from "./event-editor-model";

type EventManagerProps = {
  onEdit?: (event: ManagedEvent) => void;
  onCreate?: () => void;
};

type ManagerState =
  | { kind: "loading" }
  | { kind: "ready"; events: ManagedEvent[] }
  | { kind: "error"; message: string };

type ManagedEventWire = Omit<ManagedEvent, "startAt" | "endAt" | "registrationDeadline" | "createdAt" | "updatedAt"> & {
  startAt: string;
  endAt: string;
  registrationDeadline: string;
  createdAt: string;
  updatedAt: string;
};

function toManagedEvent(value: ManagedEventWire): ManagedEvent {
  const { registrationDeadline, ...record } = value;
  return {
    ...record,
    startAt: new Date(value.startAt),
    endAt: new Date(value.endAt),
    ...(registrationDeadline ? { registrationDeadline: new Date(registrationDeadline) } : {}),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export function EventManager({ onEdit, onCreate }: EventManagerProps) {
  const services = useMemo(() => getFirebaseServices(), []);
  const [user, setUser] = useState<User | null>(() => services?.auth.currentUser ?? null);
  const [state, setState] = useState<ManagerState>({ kind: "loading" });
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const accountGeneration = useRef(0);
  const listGeneration = useRef(0);

  const load = useCallback(async () => {
    const ownerUid = services?.auth.currentUser?.uid;
    const account = accountGeneration.current;
    const request = ++listGeneration.current;
    const isCurrent = () => accountGeneration.current === account
      && listGeneration.current === request && services?.auth.currentUser?.uid === ownerUid;
    if (!services || !ownerUid) {
      setState({ kind: "ready", events: [] });
      return;
    }
    setState({ kind: "loading" });
    try {
      const callable = httpsCallable<Record<string, never>, { events: ManagedEventWire[] }>(services.functions, "listOwnedEvents");
      const result = await callable({});
      if (!isCurrent()) return;
      setState({ kind: "ready", events: result.data.events.map(toManagedEvent) });
    } catch {
      if (!isCurrent()) return;
      setState({ kind: "error", message: "내 행사를 불러오지 못했어요." });
    }
  }, [services]);

  useEffect(() => {
    if (!services) return undefined;
    const unsubscribe = onAuthStateChanged(services.auth, (nextUser) => {
      accountGeneration.current += 1;
      listGeneration.current += 1;
      setUser(nextUser);
      setWorkingId(null);
      setNotice("");
      if (nextUser) void load();
      else setState({ kind: "ready", events: [] });
    });
    return () => {
      accountGeneration.current += 1;
      listGeneration.current += 1;
      unsubscribe();
    };
  }, [load, services]);

  const transition = async (event: ManagedEvent, action: "cancel" | "unpublish" | "restore") => {
    const ownerUid = services?.auth.currentUser?.uid;
    if (!services || !ownerUid || ownerUid !== user?.uid) return;
    const account = accountGeneration.current;
    const isCurrent = () => accountGeneration.current === account && services.auth.currentUser?.uid === ownerUid;
    if (action !== "restore") {
      const question = action === "cancel"
        ? "행사가 취소되었다는 사실을 일정에 남길까요?"
        : "이 행사를 삭제할까요? 달력에서 사라지지만 원본은 내 위브에 남고 비공개 초안으로 복원할 수 있어요.";
      if (!window.confirm(question)) return;
    }
    if (!isCurrent()) return;
    setWorkingId(event.id);
    setNotice("");
    try {
      const callable = httpsCallable<{ eventId: string }, { status: ManagedEvent["status"] }>(
        services.functions,
        action === "cancel" ? "cancelOwnedEvent" : action === "unpublish" ? "unpublishOwnedEvent" : "restoreOwnedEvent",
      );
      const result = await callable({ eventId: event.id });
      if (!isCurrent()) return;
      setState((current) => current.kind === "ready" ? {
        kind: "ready",
        events: current.events.map((item) => item.id === event.id ? { ...item, status: result.data.status, updatedAt: new Date() } : item),
      } : current);
      setNotice(action === "cancel" ? "행사 취소 상태를 반영했어요." : action === "restore" ? "비공개 초안으로 복원했어요. 수정한 뒤 다시 공개할 수 있어요." : "행사 공개를 중단했어요.");
    } catch {
      if (!isCurrent()) return;
      setNotice("요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      if (isCurrent()) setWorkingId(null);
    }
  };

  if (!services || !user) return (
    <section className="event-manager event-manager-empty">
      <CircleAlert size={22} />
      <h2>내 행사는 로그인 뒤 확인할 수 있어요</h2>
      <p>네이버 또는 카카오로 로그인하면 등록한 행사와 공개 상태를 한곳에서 관리할 수 있습니다.</p>
    </section>
  );

  return (
    <section className="event-manager" aria-labelledby="event-manager-title">
      <header className="event-manager-heading">
        <div><span className="section-kicker"><CalendarClock size={18} /> 내가 등록한 행사</span><h2 id="event-manager-title">행사 상태와 수정 내역을 확인해요</h2></div>
        {onCreate && <button type="button" className="button button-primary" onClick={onCreate}>새 행사 등록</button>}
      </header>

      {state.kind === "loading" ? (
        <div className="event-manager-state" role="status"><LoaderCircle className="spin" size={22} /> 내 행사를 불러오고 있어요</div>
      ) : state.kind === "error" ? (
        <div className="event-manager-state error" role="alert"><CircleAlert size={22} /><p>{state.message}</p><button type="button" className="button button-secondary" onClick={() => void load()}><RotateCw size={17} /> 다시 불러오기</button></div>
      ) : state.events.length === 0 ? (
        <div className="event-manager-state empty"><CalendarClock size={26} /><h3>아직 등록한 행사가 없어요</h3><p>새로운 만남을 등록하면 공개 상태와 수정 내역이 이곳에 표시됩니다.</p>{onCreate && <button type="button" className="button button-primary" onClick={onCreate}>첫 행사 등록하기</button>}</div>
      ) : (
        <div className="event-manager-list">
          {state.events.map((event) => {
            const actions = managedEventActions(event.status);
            const contentPublished = event.contentPublished && event.status !== "canceled" && event.status !== "unpublished";
            const hasVisibleDetail = event.contentPublished === true && event.status !== "unpublished";
            const mediaNotice = eventMediaNotice(event);
            return <article className={`event-manager-card${hasVisibleDetail ? " is-openable" : ""}`} key={event.id}>
              <div className="event-manager-card-head badge-row" data-badge-primary-count="1" data-badge-secondary-count="0"><WeaveBadge family="workflow" tone={workflowBadgeTone(contentPublished ? "published" : event.status)} size="compact" className={`event-status event-status-${event.status}`}>{contentPublished ? "공개 중" : managedEventStatusLabel(event.status)}</WeaveBadge><time dateTime={event.updatedAt.toISOString()}>{event.updatedAt.toLocaleDateString("ko-KR")} 수정</time></div>
              <h3>{hasVisibleDetail ? <Link className="event-manager-detail-link" to={`/events/${encodeURIComponent(event.id)}`} aria-label={`${event.title} 행사 상세 보기`}>{event.title}</Link> : event.title}</h3>
              <p>{event.summary}</p>
              {event.moderationNotice && <aside className="event-review-reason" aria-label="운영 안내"><strong>{{ warn: '운영 안내', request_correction: '수정 요청', hold: '공개 보류 안내', remove: '공개 중단 안내', restore: '공개 복구 안내' }[event.moderationNotice.action]}</strong><p>{event.moderationNotice.reason}</p><small>{new Date(event.moderationNotice.createdAtMs).toLocaleDateString('ko-KR')}</small></aside>}
              <dl><div><dt>일시</dt><dd>{event.startAt.toLocaleString("ko-KR")}</dd></div><div><dt>지역·장소</dt><dd>{event.region} · {event.locationName}</dd></div><div><dt>작성자</dt><dd>{event.createdByLabel}</dd></div><div><dt>공개</dt><dd>{event.visibility === "public" ? "전체 공개" : "위브 로그인 이용자 공개"}</dd></div></dl>
              {mediaNotice && !event.moderationNotice && <p className="event-review-reason">{mediaNotice}</p>}
              <div className="event-manager-actions">
                {actions.canEdit && onEdit && <button type="button" className="owner-icon-action" title="행사 수정" aria-label={`${event.title} 수정`} onClick={() => onEdit(event)} disabled={actions.locked || workingId === event.id}><Pencil size={18} aria-hidden="true" /></button>}
                {actions.canUnpublish && <button type="button" className="owner-icon-action owner-icon-action-danger" title="행사 삭제" aria-label={`${event.title} 삭제`} onClick={() => void transition(event, "unpublish")} disabled={actions.locked || workingId === event.id}><Trash2 size={18} aria-hidden="true" /></button>}
                {actions.canCancel && <button type="button" className="button button-secondary" onClick={() => void transition(event, "cancel")} disabled={actions.locked || workingId === event.id}><XCircle size={16} /> 행사 취소</button>}
                {actions.canRestore && <button type="button" className="button button-secondary" onClick={() => void transition(event, "restore")} disabled={workingId === event.id}><RotateCw size={16} /> 비공개 초안으로 복원</button>}
              </div>
            </article>;
          })}
        </div>
      )}
      {notice && <p className="event-manager-notice" role="status">{notice}</p>}
    </section>
  );
}
