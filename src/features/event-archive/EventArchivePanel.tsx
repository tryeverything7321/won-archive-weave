import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowRight, Link2, RotateCcw } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import type { CalendarEvent } from "../calendar/calendar-model";
import { useFirebaseAudience } from "../auth/useFirebaseAudience";
import {
  ensureArchiveEventContext,
  getEventArchiveOverview,
  linkArchiveRelation,
  newArchiveRequestId,
  searchArchiveDiscovery,
} from "./event-archive-api";
import { archiveRelationPath, eventContextQuery, type ArchiveRelationSummary, type EventArchiveOverview } from "./event-archive-model";
import styles from "./EventArchive.module.css";

function RelationGroup({ title, items, empty }: { title: string; items: ArchiveRelationSummary[]; empty: string }) {
  const location = useLocation();
  return <section className={styles.group} aria-labelledby={`event-archive-${title}`}>
    <h3 id={`event-archive-${title}`}>{title}</h3>
    {items.length ? <div className={styles.grid}>{items.map((item) => <article className={styles.item} key={`${item.targetType}:${item.id}`}>
      <Link to={archiveRelationPath(item)} state={{ returnTo: location.pathname + location.search }}>{item.title}</Link>
      {item.description && <p>{item.description}</p>}
      {typeof item.fileCount === "number" && <small>첨부 {item.fileCount}개{typeof item.pendingFileCount === "number" && item.pendingFileCount > 0 ? ` · 검사 중 ${item.pendingFileCount}개` : ""}</small>}
    </article>)}</div> : <p>{empty}</p>}
  </section>;
}

export function EventArchivePanel({ event }: { event: CalendarEvent }) {
  const location = useLocation();
  const { audience, ready } = useFirebaseAudience();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [overview, setOverview] = useState<EventArchiveOverview>();
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [candidates, setCandidates] = useState<ArchiveRelationSummary[]>([]);
  const [candidateCursor, setCandidateCursor] = useState<string>();
  const [connectorState, setConnectorState] = useState<"idle" | "loading" | "linking" | "done" | "error">("idle");
  const [connectorMessage, setConnectorMessage] = useState("");
  const requestRef = useRef(0);
  const returnTo = `${location.pathname}${location.search}`;

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setState("loading");
    try {
      const result = await getEventArchiveOverview({ sourceCalendarEventId: event.id });
      if (request !== requestRef.current) return;
      setOverview(result);
      setState("ready");
    } catch {
      if (request === requestRef.current) setState("error");
    }
  }, [event.id]);

  useEffect(() => {
    if (!ready) return;
    void Promise.resolve().then(load);
    return () => { requestRef.current += 1; };
  }, [audience, load, ready]);

  const openConnector = async (cursor?: string) => {
    setConnectorOpen(true);
    setConnectorState("loading");
    setConnectorMessage("");
    try {
      const result = await searchArchiveDiscovery({ limit: 20, cursor });
      setCandidateCursor(result.nextCursor);
      setCandidates((current) => [...(cursor ? current : []), ...result.items.flatMap((item) => (item.targetType === "material" || item.targetType === "bundle") && item.canLink
        ? [{ id: item.id, title: item.title, targetType: item.targetType, description: item.format ?? undefined }]
        : [])]);
      setConnectorState("idle");
    } catch {
      setConnectorState("error");
      setConnectorMessage("연결할 수 있는 자료를 불러오지 못했어요.");
    }
  };

  const connect = async (item: ArchiveRelationSummary) => {
    setConnectorState("linking");
    setConnectorMessage("");
    try {
      const context = await ensureArchiveEventContext({ requestId: newArchiveRequestId(), sourceCalendarEventId: event.id });
      await linkArchiveRelation({ requestId: newArchiveRequestId(), archiveEventId: context.archiveEventId, targetType: item.targetType, targetId: item.id });
      setConnectorState("done");
      setConnectorMessage(`‘${item.title}’을 이 행사에 연결했어요.`);
      await load();
    } catch {
      setConnectorState("error");
      setConnectorMessage("자료를 연결하지 못했어요. 내 자료인지와 현재 공개 상태를 확인해 주세요.");
    }
  };

  const counts = useMemo(() => overview?.counts, [overview]);
  return <section className={styles.section} aria-labelledby="event-archive-title">
    <div className={styles.heading}>
      <div className={styles.headingCopy}>
        <h2 id="event-archive-title">이 행사에서 남긴 자료와 기록</h2>
        <p>발표 자료와 진행안, 함께한 후기를 찾아보세요.</p>
      </div>
      <Archive size={28} aria-hidden="true" />
    </div>
    {state === "loading" && <p className={styles.status} role="status">연결된 자료와 기록을 불러오고 있어요.</p>}
    {state === "error" && <div className={`${styles.status} ${styles.error}`} role="alert"><span>연결된 자료와 기록을 불러오지 못했어요.</span><button type="button" onClick={() => void load()}><RotateCcw size={16} /> 다시 시도</button></div>}
    {state === "ready" && overview && <>
      {overview.archiveEvent?.unmatchedOrganizerName && <p className={styles.status}>주최 확인 전: {overview.archiveEvent.unmatchedOrganizerName}</p>}
      <ul className={styles.counts} aria-label="행사 아카이브 요약">
        <li>자료 {(counts?.bundleCount ?? 0) + (counts?.materialCount ?? 0)}</li>
        <li>활동 기록 {counts?.activityCount ?? 0}</li>
        <li>첨부 파일 {counts?.fileCount ?? 0}</li>
      </ul>
      <RelationGroup title="자료" items={[...overview.bundles, ...overview.materials]} empty="아직 연결된 자료가 없어요." />
      <RelationGroup title="활동 기록" items={overview.activities} empty="아직 연결된 활동 기록이 없어요." />
    </>}
    <div className={styles.actions} aria-label="행사 기록 이어가기">
      <Link className="button button-primary" to={eventContextQuery(event.id, "material", returnTo)}>자료 올리기 <ArrowRight size={17} /></Link>
      <Link className="button button-secondary" to={eventContextQuery(event.id, "activity", returnTo)}>활동 기록 남기기</Link>
      {audience === "member" && <button type="button" className="button button-secondary" onClick={() => void openConnector()}><Link2 size={17} /> 기존 자료 연결</button>}
    </div>
    {connectorOpen && <div className={styles.connector} aria-live="polite">
      <strong>내가 연결할 수 있는 기존 자료</strong>
      {connectorState === "loading" && <p role="status">자료를 확인하고 있어요.</p>}
      {candidates.length > 0 && <ul className={styles.connectorResults}>{candidates.map((item) => <li key={`${item.targetType}:${item.id}`}><span>{item.title}</span><button type="button" disabled={connectorState === "linking"} onClick={() => void connect(item)}>이 행사에 연결</button></li>)}</ul>}
      {connectorState === "idle" && candidates.length === 0 && <p>현재 연결할 수 있는 자료가 없어요. 먼저 자료를 올려 주세요.</p>}
      {candidateCursor && <button type="button" disabled={connectorState === "loading" || connectorState === "linking"} onClick={() => void openConnector(candidateCursor)}>연결할 자료 더 보기</button>}
      {connectorMessage && <p className={connectorState === "error" ? styles.error : styles.status} role={connectorState === "error" ? "alert" : "status"}>{connectorMessage}</p>}
    </div>}
  </section>;
}
