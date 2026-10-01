import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, CalendarPlus, FolderHeart, Link2, Plus, RotateCcw, Save, X } from "lucide-react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  createArchiveCollection,
  ensureArchiveEventContext,
  getArchiveCollection,
  getEventArchiveOverview,
  linkArchiveRelation,
  listArchiveOrganizers,
  listArchiveCollections,
  newArchiveRequestId,
  replaceArchiveCollectionItems,
  searchArchiveDiscovery,
  updateArchiveCollection,
} from "./event-archive-api";
import {
  archiveEventContextQuery,
  archiveEventDateLabel,
  archiveRelationPath,
  archiveTargetLabel,
  pastEventYearIsValid,
  type ArchiveCollection,
  type ArchiveCollectionItem,
  type ArchiveCollectionVisibility,
  type ArchiveRelationSummary,
  type ArchiveRelationTarget,
  type EventArchiveOverview,
} from "./event-archive-model";
import { AuthorAccessGate } from "../auth/AuthorAccessGate";
import styles from "./EventArchive.module.css";

function PageHeader({ title, description }: { title: string; description: string }) {
  return <header className={styles.pageHeader}><h1>{title}</h1><p>{description}</p></header>;
}

export function PastArchiveEventCreatePage() {
  return <AuthorAccessGate><PastArchiveEventForm /></AuthorAccessGate>;
}

function PastArchiveEventForm() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [heldYear, setHeldYear] = useState(String(new Date().getFullYear()));
  const [region, setRegion] = useState("");
  const [organizers, setOrganizers] = useState<Array<{ id: string; displayName: string }>>([]);
  const [organizerId, setOrganizerId] = useState("");
  const [visibility, setVisibility] = useState<"public" | "member_only">("public");
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => { void listArchiveOrganizers({ limit: 100 }).then((result) => setOrganizers(result.items)).catch(() => setOrganizers([])); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const year = Number(heldYear);
    if (!pastEventYearIsValid(year)) {
      setState("error");
      setMessage("개최 연도를 확인해 주세요. 미래 연도는 과거 행사로 만들 수 없어요.");
      return;
    }
    setState("working");
    setMessage("");
    try {
      const result = await ensureArchiveEventContext({
        requestId: newArchiveRequestId(),
        title: title.trim(),
        datePrecision: "year",
        heldYear: year,
        region: region.trim(),
        visibility,
        ...(organizerId ? { organizerIds: [organizerId] } : {}),
      });
      navigate(`/archive-events/${encodeURIComponent(result.archiveEventId)}`, { replace: true });
    } catch {
      setState("error");
      setMessage("과거 행사를 만들지 못했어요. 입력 내용과 로그인 상태를 확인해 주세요.");
    }
  };

  return <section className={styles.page}>
    <Link className="back-link" to="/calendar"><ArrowLeft size={17} /> 행사 일정으로 돌아가기</Link>
    <PageHeader title="과거 행사를 기록해요" description="날짜가 기억나지 않으면 연도만 입력해도 돼요." />
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formGrid}>
        <label>행사 이름<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>개최 연도<input required type="number" min="1945" max={new Date().getFullYear()} value={heldYear} onChange={(event) => setHeldYear(event.target.value)} /></label>
        <label>개최 지역<input maxLength={60} value={region} onChange={(event) => setRegion(event.target.value)} placeholder="예: 서울" /></label>
        <label>주최<select value={organizerId} onChange={(event) => setOrganizerId(event.target.value)}><option value="">주최 연결 안 함</option>{organizers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        <label>공개 범위<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="public">누구나 보기</option><option value="member_only">위브 로그인 이용자만 보기</option></select></label>
      </div>
      <p className={styles.muted}>자료와 활동 기록은 행사를 만든 뒤 각각 연결할 수 있어요.</p>
      {message && <p className={`${styles.status} ${styles.error}`} role="alert">{message}</p>}
      <div className={styles.formActions}><button className="button button-primary" type="submit" disabled={state === "working"}><CalendarPlus size={17} /> {state === "working" ? "행사를 만드는 중" : "과거 행사 만들기"}</button></div>
    </form>
  </section>;
}

function ArchiveEventRelations({ overview }: { overview: EventArchiveOverview }) {
  const location = useLocation();
  const groups: Array<[string, ArchiveRelationSummary[]]> = [["자료 묶음", overview.bundles], ["개별 자료", overview.materials], ["활동 기록", overview.activities]];
  return <>{groups.map(([label, items]) => <section className={styles.group} key={label}><h2>{label}</h2>{items.length ? <div className={styles.grid}>{items.map((item) => <article className={styles.item} key={`${item.targetType}:${item.id}`}><Link to={archiveRelationPath(item)} state={{ returnTo: location.pathname + location.search }}>{item.title}</Link>{item.description && <p>{item.description}</p>}</article>)}</div> : <p>연결된 {label}이 없어요.</p>}</section>)}</>;
}

export function ArchiveEventDetailPage() {
  const { eventId = "" } = useParams();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [overview, setOverview] = useState<EventArchiveOverview>();
  const load = useCallback(async () => {
    setState("loading");
    try { setOverview(await getEventArchiveOverview({ archiveEventId: eventId })); setState("ready"); }
    catch { setState("error"); }
  }, [eventId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const archiveEvent = overview?.archiveEvent;
  const returnTo = `/archive-events/${encodeURIComponent(eventId)}`;
  return <section className={styles.page}>
    <Link className="back-link" to="/calendar"><ArrowLeft size={17} /> 행사 일정으로 돌아가기</Link>
    {state === "loading" && <p className={styles.status} role="status">행사 자료와 기록을 불러오고 있어요.</p>}
    {state === "error" && <div className={`${styles.status} ${styles.error}`} role="alert"><span>행사를 불러오지 못했어요.</span><button type="button" onClick={() => void load()}><RotateCcw size={16} /> 다시 시도</button></div>}
    {state === "ready" && !archiveEvent && <PageHeader title="이 행사를 볼 수 없어요" description="행사가 없거나 현재 공개 범위에서 볼 수 없습니다." />}
    {archiveEvent && overview && <>
      <PageHeader title={archiveEvent.title} description={`${archiveEventDateLabel(archiveEvent)} · ${archiveEvent.region || "지역 미입력"}${archiveEvent.organizers.length ? ` · ${archiveEvent.organizers.map((item) => item.displayName).join(", ")}` : archiveEvent.unmatchedOrganizerName ? ` · 주최 확인 전: ${archiveEvent.unmatchedOrganizerName}` : ""}`} />
      <ul className={styles.counts}><li>자료 묶음 {overview.counts.bundleCount}</li><li>개별 자료 {overview.counts.materialCount}</li><li>활동 기록 {overview.counts.activityCount}</li><li>첨부 {overview.counts.fileCount}</li></ul>
      <ArchiveEventRelations overview={overview} />
      <div className={styles.actions} aria-label="이 행사 기록 이어가기">
        <Link className="button button-primary" to={archiveEventContextQuery(archiveEvent.id, "material", returnTo)}>자료 올리기</Link>
        <Link className="button button-secondary" to={archiveEventContextQuery(archiveEvent.id, "activity", returnTo)}>활동 기록 남기기</Link>
        <Link className="button button-secondary" to={`/archive-relations/new?archiveEventId=${encodeURIComponent(archiveEvent.id)}&returnTo=${encodeURIComponent(returnTo)}`}>기존 자료·기록 연결</Link>
      </div>
    </>}
  </section>;
}

export function ArchiveCollectionsPage() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<ArchiveCollection[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true); setPageError("");
    try { const next = await listArchiveCollections({ limit: 30, cursor }); setItems((current) => [...current, ...next.items.filter((item) => !current.some((prior) => prior.id === item.id))]); setCursor(next.nextCursor); }
    catch { setPageError("다음 모음을 불러오지 못했어요. 다시 눌러 주세요."); }
    finally { setLoadingMore(false); }
  };
  useEffect(() => { void listArchiveCollections({ limit: 30 }).then((result) => { setItems(result.items); setCursor(result.nextCursor); setState("ready"); }).catch(() => setState("error")); }, []);
  return <section className={styles.page}>
    <PageHeader title="자료 모음" description="다음에 다시 보고 싶은 행사와 자료를 모아 보세요." />
    <div className={styles.actions}><Link className="button button-primary" to="/collections/new"><Plus size={17} /> 새 모음 만들기</Link></div>
    {state === "loading" && <p className={styles.status} role="status">자료 모음을 불러오고 있어요.</p>}
    {state === "error" && <p className={`${styles.status} ${styles.error}`} role="alert">자료 모음을 불러오지 못했어요.</p>}
    {state === "ready" && (items.length ? <div className={styles.collections}>{items.map((item) => <article className={styles.collectionCard} key={item.id}><FolderHeart size={22} /><h2><Link to={`/collections/${encodeURIComponent(item.id)}`}>{item.title}</Link></h2><p>{item.description}</p><small>{item.visibleItemCount ?? item.items?.length ?? 0}개 항목</small></article>)}</div> : <p className={styles.status}>아직 볼 수 있는 자료 모음이 없어요.</p>)}
    {cursor && <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "불러오는 중" : "자료 모음 더 보기"}</button>}
    {pageError && <p role="alert">{pageError}</p>}
  </section>;
}

function CollectionForm({ existing }: { existing?: ArchiveCollection }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [visibility, setVisibility] = useState<ArchiveCollectionVisibility>(existing?.visibility ?? "public");
  const [selected, setSelected] = useState<ArchiveCollectionItem[]>(existing?.items ?? []);
  const [candidates, setCandidates] = useState<ArchiveCollectionItem[]>([]);
  const [candidateCursor, setCandidateCursor] = useState<string>();
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const createdId = useRef(existing?.id);
  const createRequestId = useRef(newArchiveRequestId());
  const loadCandidates = useCallback(async (cursor?: string) => {
    setCandidateLoading(true); setCandidateError("");
    try { const result = await searchArchiveDiscovery({ limit: 40, cursor }); setCandidates((current) => [...(cursor ? current : []), ...result.items.map((item, index) => ({ ...item, order: index }))] as ArchiveCollectionItem[]); setCandidateCursor(result.nextCursor); }
    catch { setCandidateError("담을 자료를 불러오지 못했어요"); }
    finally { setCandidateLoading(false); }
  }, []);
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  useEffect(() => { void Promise.resolve().then(() => loadCandidates()); }, [loadCandidates]);
  const toggle = (item: ArchiveCollectionItem) => setSelected((current) => current.some((value) => value.targetType === item.targetType && value.id === item.id) ? current.filter((value) => value.targetType !== item.targetType || value.id !== item.id) : [...current, { ...item, order: current.length }]);
  const move = (index: number, delta: number) => setSelected((current) => { const next = [...current]; const target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next.map((item, order) => ({ ...item, order })); });
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setState("working"); setMessage("");
    try {
      const collectionId = createdId.current ?? (await createArchiveCollection({ requestId: createRequestId.current, title: title.trim(), description: description.trim(), visibility })).collectionId;
      createdId.current = collectionId;
      if (existing) await updateArchiveCollection({ requestId: newArchiveRequestId(), collectionId, title: title.trim(), description: description.trim(), visibility });
      await replaceArchiveCollectionItems({ requestId: newArchiveRequestId(), collectionId, items: selected.map((item) => ({ targetType: item.targetType, targetId: item.id })) });
      navigate(`/collections/${encodeURIComponent(collectionId)}`, { replace: true });
    } catch { setState("error"); setMessage("자료 모음을 저장하지 못했어요. 편집 권한과 항목의 현재 공개 상태를 확인해 주세요."); }
  };
  return <form className={styles.form} onSubmit={submit}>
    <label>모음 이름<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>설명<textarea maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>공개 범위<select value={visibility} onChange={(event) => setVisibility(event.target.value as ArchiveCollectionVisibility)}><option value="public">누구나 보기</option><option value="member_only">위브 로그인 이용자만 보기</option><option value="hold">아직 공개하지 않기</option></select></label>
    <section className={styles.group}><h2>모음에 담기</h2><p>함께 볼 자료와 기록을 선택해 주세요.</p><div className={styles.grid}>{candidates.map((item) => { const checked = selected.some((value) => value.targetType === item.targetType && value.id === item.id); return <label className={styles.item} key={`${item.targetType}:${item.id}`}><input type="checkbox" checked={checked} onChange={() => toggle(item)} /> <strong>{item.title}</strong><small>{archiveTargetLabel(item.targetType)}</small></label>; })}</div></section>
    {candidateLoading && <p role="status">담을 자료를 불러오는 중</p>}
    {(candidateCursor || candidateError) && <button type="button" disabled={candidateLoading} onClick={() => void loadCandidates(candidateCursor)}>{candidateError ? "자료 목록 다시 시도" : "담을 자료 더 보기"}</button>}
    {candidateError && <p role="alert">{candidateError}</p>}
    {selected.length > 0 && <section className={styles.group}><h2>표시 순서</h2><ol className={styles.connectorResults}>{selected.map((item, index) => <li key={`${item.targetType}:${item.id}`}><span>{item.title}</span><span className={styles.collectionActions}><button type="button" aria-label={`${item.title} 위로`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`${item.title} 아래로`} disabled={index === selected.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button><button type="button" aria-label={`${item.title} 모음에서 제거`} onClick={() => toggle(item)}><X size={16} /></button></span></li>)}</ol></section>}
    {message && <p className={`${styles.status} ${styles.error}`} role="alert">{message}</p>}
    <div className={styles.formActions}><button className="button button-primary" disabled={state === "working"} type="submit"><Save size={17} /> {state === "working" ? "저장하는 중" : "자료 모음 저장"}</button></div>
  </form>;
}

export function ArchiveCollectionCreatePage() { return <section className={styles.page}><Link className="back-link" to="/collections"><ArrowLeft size={17} /> 자료 모음으로 돌아가기</Link><PageHeader title="새 자료 모음" description="함께 볼 행사와 자료, 기록을 골라 담아 보세요." /><AuthorAccessGate><CollectionForm /></AuthorAccessGate></section>; }

export function ArchiveCollectionEditPage() {
  const { collectionId = "" } = useParams(); const [collection, setCollection] = useState<ArchiveCollection>(); const [failed, setFailed] = useState(false);
  useEffect(() => { void getArchiveCollection(collectionId).then((result) => { if (result) setCollection(result); else setFailed(true); }).catch(() => setFailed(true)); }, [collectionId]);
  return <section className={styles.page}><Link className="back-link" to={`/collections/${encodeURIComponent(collectionId)}`}><ArrowLeft size={17} /> 모음으로 돌아가기</Link><PageHeader title="자료 모음 편집" description="연결 해제는 이 모음에서만 제거하며 원본은 삭제하지 않습니다." />{collection ? <CollectionForm existing={collection} /> : <p className={failed ? `${styles.status} ${styles.error}` : styles.status} role={failed ? "alert" : "status"}>{failed ? "모음을 불러오지 못했어요." : "모음을 불러오고 있어요."}</p>}</section>;
}

export function ArchiveCollectionDetailPage() {
  const location = useLocation();
  const { collectionId = "" } = useParams(); const [collection, setCollection] = useState<ArchiveCollection>(); const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => { void getArchiveCollection(collectionId).then((result) => { setCollection(result ?? undefined); setState("ready"); }).catch(() => setState("error")); }, [collectionId]);
  const collectionItems = collection?.items ?? [];
  return <section className={styles.page}><Link className="back-link" to="/collections"><ArrowLeft size={17} /> 자료 모음으로 돌아가기</Link>{state === "loading" && <p className={styles.status}>모음을 불러오고 있어요.</p>}{state === "error" && <p className={`${styles.status} ${styles.error}`} role="alert">모음을 불러오지 못했어요.</p>}{state === "ready" && !collection && <PageHeader title="이 모음을 볼 수 없어요" description="모음이 없거나 현재 공개 범위에서 볼 수 없습니다." />}{collection && <><PageHeader title={collection.title} description={collection.description || "함께 볼 자료와 기록입니다."} /><div className={styles.actions}>{collection.canEdit && <Link className="button button-secondary" to={`/collections/${encodeURIComponent(collection.id)}/edit`}>모음 편집</Link>}</div>{collectionItems.length ? <div className={styles.grid}>{[...collectionItems].sort((a, b) => a.order - b.order).map((item) => <article className={styles.item} key={`${item.targetType}:${item.id}`}><Link to={item.targetType === "event" ? `/archive-events/${encodeURIComponent(item.id)}` : archiveRelationPath(item as ArchiveRelationSummary)} state={{ returnTo: location.pathname + location.search }}>{item.title}</Link><small>{archiveTargetLabel(item.targetType)}</small></article>)}</div> : <p className={styles.status}>이 모음에 연결된 항목이 없어요.</p>}</>}</section>;
}

export function ArchiveRelationCreatePage() {
  const [search] = useSearchParams(); const location = useLocation(); const navigate = useNavigate();
  const rawTargetType = search.get("targetType"); const rawTargetId = search.get("targetId"); const presetEventId = search.get("archiveEventId");
  const presetTargetType = rawTargetType === "bundle" || rawTargetType === "material" || rawTargetType === "activity" ? rawTargetType : null;
  const returnTo = search.get("returnTo")?.startsWith("/") ? search.get("returnTo")! : location.state?.returnTo ?? "/resources";
  const [events, setEvents] = useState<Array<{ id: string; title: string; heldYear: number | null }>>([]);
  const [targets, setTargets] = useState<ArchiveRelationSummary[]>([]);
  const [candidateCursor, setCandidateCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [archiveEventId, setArchiveEventId] = useState(presetEventId ?? "");
  const [targetKey, setTargetKey] = useState(presetTargetType && rawTargetId ? `${presetTargetType}:${rawTargetId}` : "");
  const [state, setState] = useState<"loading" | "idle" | "working" | "error">("loading"); const [message, setMessage] = useState("");
  useEffect(() => { void searchArchiveDiscovery({ limit: 40 }).then((result) => {
    setCandidateCursor(result.nextCursor);
    setEvents(result.items.flatMap((item) => item.targetType === "event" ? [{ id: item.id, title: item.title, heldYear: item.heldYear }] : []));
    setTargets(result.items.flatMap((item) => item.targetType !== "event" && item.canLink
      ? [{ id: item.id, title: item.title, targetType: item.targetType, description: item.format ?? undefined }]
      : []));
    setState("idle");
  }).catch(() => { setState("error"); setMessage("연결할 행사와 원본을 불러오지 못했어요."); }); }, []);
  const loadMore = async () => {
    if (!candidateCursor || loadingMore) return;
    setLoadingMore(true); setMessage("");
    try {
      const result = await searchArchiveDiscovery({ limit: 40, cursor: candidateCursor });
      setCandidateCursor(result.nextCursor);
      setEvents((current) => [...current, ...result.items.flatMap((item) => item.targetType === "event" ? [{ id: item.id, title: item.title, heldYear: item.heldYear }] : [])]);
      setTargets((current) => [...current, ...result.items.flatMap((item) => item.targetType !== "event" && item.canLink ? [{ id: item.id, title: item.title, targetType: item.targetType }] : [])]);
    } catch { setMessage("다음 담을 자료를 불러오지 못했어요. 다시 눌러 주세요."); }
    finally { setLoadingMore(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const separator = targetKey.indexOf(":");
    const targetType = targetKey.slice(0, separator) as ArchiveRelationTarget;
    const targetId = targetKey.slice(separator + 1);
    if (separator < 1 || !targetId || !archiveEventId) return;
    setState("working");
    try { await linkArchiveRelation({ requestId: newArchiveRequestId(), archiveEventId, targetType, targetId }); navigate(returnTo, { replace: true }); }
    catch { setState("error"); setMessage("행사에 연결하지 못했어요. 원본 소유권과 현재 상태를 확인해 주세요."); }
  };
  const malformedPreset = Boolean(rawTargetType || rawTargetId) && !(presetTargetType && rawTargetId);
  return <section className={styles.page}><Link className="back-link" to={returnTo}><ArrowLeft size={17} /> 이전 화면으로 돌아가기</Link><PageHeader title="행사에 기존 원본 연결" description="이 행사와 함께 볼 자료나 기록을 선택해 주세요." />{malformedPreset ? <p className={`${styles.status} ${styles.error}`} role="alert">연결할 원본 정보가 올바르지 않아요.</p> : <form className={styles.form} onSubmit={submit}>{!presetEventId && <label>연결할 행사<select required value={archiveEventId} onChange={(event) => setArchiveEventId(event.target.value)}><option value="">행사를 선택해 주세요</option>{events.map((event) => <option key={event.id} value={event.id}>{event.heldYear} · {event.title}</option>)}</select></label>}{!(presetTargetType && rawTargetId) && <label>연결할 기존 원본<select required value={targetKey} onChange={(event) => setTargetKey(event.target.value)}><option value="">자료나 기록을 선택해 주세요</option>{targets.map((item) => <option key={`${item.targetType}:${item.id}`} value={`${item.targetType}:${item.id}`}>{item.title}</option>)}</select></label>}{candidateCursor && <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "불러오는 중" : "행사·원본 목록 더 보기"}</button>}<p className={styles.muted}>목록에 행사가 없다면 먼저 연도만 있는 과거 행사를 만들 수 있어요.</p><div className={styles.actions}><Link className="button button-secondary" to="/archive-events/new">과거 행사 만들기</Link><button className="button button-primary" type="submit" disabled={state === "loading" || state === "working" || !archiveEventId || !targetKey}><Link2 size={17} /> {state === "working" ? "연결하는 중" : "행사에 연결"}</button></div>{message && <p className={`${styles.status} ${state === "error" ? styles.error : ""}`} role="alert">{message}</p>}</form>}</section>;
}
