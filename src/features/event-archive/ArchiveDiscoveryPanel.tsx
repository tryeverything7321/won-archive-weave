import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, RotateCcw, X } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useFirebaseAudience } from "../auth/useFirebaseAudience";
import { searchArchiveDiscovery } from "./event-archive-api";
import { archiveRelationPath, archiveTargetLabel, type ArchiveDiscoveryResult, type ArchiveRelationSummary } from "./event-archive-model";
import styles from "./EventArchive.module.css";

const keys = ["organizer", "heldYear", "uploadYear", "region", "archiveFormat"] as const;

export function ArchiveDiscoveryPanel() {
  const location = useLocation();
  const { audience, ready } = useFirebaseAudience();
  const [search, setSearch] = useSearchParams();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [result, setResult] = useState<ArchiveDiscoveryResult>();
  const requestRef = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const filters = useMemo(() => ({
    organizerId: search.get("organizer") || undefined,
    heldYear: Number(search.get("heldYear")) || undefined,
    uploadYear: Number(search.get("uploadYear")) || undefined,
    region: search.get("region") || undefined,
    format: search.get("archiveFormat") || undefined,
  }), [search]);
  const active = keys.some((key) => search.has(key));

  useEffect(() => {
    if (!ready) return;
    const request = ++requestRef.current;
    void Promise.resolve().then(() => {
      setState("loading");
      setLoadingMore(false); setPageError("");
      return searchArchiveDiscovery({ ...filters, limit: 30 });
    }).then((next) => {
      if (request !== requestRef.current) return;
      if (!next.counts || !next.facets || !Array.isArray(next.items) || typeof next.asOfMs !== "number") {
        throw new Error("Archive discovery returned an incomplete response");
      }
      setResult(next);
      setState("ready");
    }).catch(() => { if (request === requestRef.current) setState("error"); });
    return () => { requestRef.current += 1; };
  }, [audience, filters, ready]);

  const loadMore = async () => {
    if (!result?.nextCursor || loadingMore) return;
    const request = requestRef.current;
    setLoadingMore(true); setPageError("");
    try {
      const next = await searchArchiveDiscovery({ ...filters, limit: 30, cursor: result.nextCursor });
      if (request !== requestRef.current) return;
      setResult((current) => current ? { ...next, items: [...current.items, ...next.items.filter((item) => !current.items.some((prior) => prior.id === item.id && prior.targetType === item.targetType))] } : next);
    } catch { if (request === requestRef.current) setPageError("다음 결과를 불러오지 못했어요. 다시 눌러 주세요."); }
    finally { if (request === requestRef.current) setLoadingMore(false); }
  };

  const setFilter = (key: typeof keys[number], value: string) => setSearch((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true, preventScrollReset: true });
  const reset = () => setSearch((current) => { const next = new URLSearchParams(current); keys.forEach((key) => next.delete(key)); return next; }, { replace: true, preventScrollReset: true });
  const facets = result?.facets;

  return <section className={styles.section} aria-labelledby="archive-discovery-title">
    <div className={styles.heading}><div className={styles.headingCopy}><h2 id="archive-discovery-title">행사와 주최로 자료 찾기</h2><p>개최 연도와 업로드 연도는 서로 다른 기준입니다. 행사 없는 독립 자료에는 개최 연도를 붙이지 않습니다.</p></div><Filter size={26} aria-hidden="true" /></div>
    <div className={styles.formGrid}>
      <label className={styles.form}>주최<select value={filters.organizerId ?? ""} onChange={(event) => setFilter("organizer", event.target.value)}><option value="">모든 주최</option>{facets?.organizers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <label className={styles.form}>개최 연도<select value={filters.heldYear ?? ""} onChange={(event) => setFilter("heldYear", event.target.value)}><option value="">모든 개최 연도</option>{facets?.heldYears.map((year) => <option key={year}>{year}</option>)}</select></label>
      <label className={styles.form}>업로드 연도<select value={filters.uploadYear ?? ""} onChange={(event) => setFilter("uploadYear", event.target.value)}><option value="">모든 업로드 연도</option>{facets?.uploadYears.map((year) => <option key={year}>{year}</option>)}</select></label>
      <label className={styles.form}>개최 지역<select value={filters.region ?? ""} onChange={(event) => setFilter("region", event.target.value)}><option value="">모든 지역</option>{facets?.regions.map((region) => <option key={region}>{region}</option>)}</select></label>
      <label className={styles.form}>자료 형식<select value={filters.format ?? ""} onChange={(event) => setFilter("archiveFormat", event.target.value)}><option value="">모든 형식</option>{facets?.formats.map((format) => <option key={format}>{format}</option>)}</select></label>
    </div>
    {active && <div className={styles.actions}><button type="button" className="button button-secondary" onClick={reset}><X size={16} /> 행사 기준 초기화</button></div>}
    {state === "loading" && <p className={styles.status} role="status">행사와 연결된 자료를 찾고 있어요.</p>}
    {state === "error" && <p className={`${styles.status} ${styles.error}`} role="alert"><RotateCcw size={16} /> 행사 기준 검색을 완료하지 못했어요.</p>}
    {state === "ready" && result && <>
      <ul className={styles.counts} aria-label="현재 조건의 고유 결과"><li>행사 {result.counts.eventCount}</li><li>자료 묶음 {result.counts.bundleCount}</li><li>개별 자료 {result.counts.materialCount}</li><li>활동 기록 {result.counts.activityCount}</li><li>첨부 {result.counts.fileCount}</li></ul>
      {result.items.length ? <div className={styles.grid}>{result.items.map((item) => {
        const isEvent = item.targetType === "event";
        const path = isEvent ? `/archive-events/${encodeURIComponent(item.id)}` : archiveRelationPath(item as ArchiveRelationSummary);
        const detail = isEvent ? `${item.heldYear}년 · ${item.region || "지역 미입력"}` : item.format;
        return <article className={styles.item} key={`${item.targetType}:${item.id}`}><small>{archiveTargetLabel(item.targetType)}</small><Link to={path} state={{ returnTo: location.pathname + location.search }}>{item.title}</Link>{detail && <p>{detail}</p>}</article>;
      })}</div> : <p className={styles.status}>현재 조건에서 볼 수 있는 행사·자료·기록이 없어요.</p>}
      {result.nextCursor && <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "불러오는 중" : "검색 결과 더 보기"}</button>}
      {pageError && <p role="alert">{pageError}</p>}
      <p className={styles.muted}>현재 권한에서 조회한 결과 · {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: result.timeZone }).format(new Date(result.asOfMs))} 기준</p>
    </>}
  </section>;
}
