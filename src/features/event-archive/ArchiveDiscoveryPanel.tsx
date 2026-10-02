import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, RotateCcw, Search, X, FileText, FileImage, Presentation } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useFirebaseAudience } from "../auth/useFirebaseAudience";
import { searchArchiveDiscovery } from "./event-archive-api";
import { type ArchiveDiscoveryResult } from "./event-archive-model";
import {ResourceActions} from "./ResourceActions";
import {OwnedSubmissionActions} from "../uploads/OwnedSubmissionActions";
import {useOperatorAccess} from "../auth/useOperatorAccess";
import {AdminResourceActions,QcResourceCleanup} from "../admin/ArchiveResourceManagement";
import styles from "./EventArchive.module.css";

const keys = ["organizer", "heldYear", "uploadYear", "region", "archiveFormat"] as const;

export function ArchiveDiscoveryPanel({resourcesOnly=false}: {resourcesOnly?:boolean}) {
  const location = useLocation();
  const operator=useOperatorAccess();
  const [attempt,setAttempt]=useState(0);
  const refresh=()=>setAttempt(value=>value+1);

  const { audience, ready } = useFirebaseAudience();
  const [search, setSearch] = useSearchParams();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [result, setResult] = useState<ArchiveDiscoveryResult>();
  const requestRef = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const keyword = search.get("q") ?? "";
  const [debouncedKeyword,setDebouncedKeyword] = useState(keyword);
  useEffect(()=>{const timer=setTimeout(()=>setDebouncedKeyword(keyword),250);return()=>clearTimeout(timer)},[keyword]);
  const organizerId=search.get("organizer")||undefined, heldYear=Number(search.get("heldYear"))||undefined, uploadYear=Number(search.get("uploadYear"))||undefined, region=search.get("region")||undefined, format=search.get("archiveFormat")||search.get("type")||undefined;
  const filters = useMemo(() => ({
    ...(resourcesOnly ? {scope: "resources" as const, keyword: debouncedKeyword} : {}),
    organizerId,heldYear,uploadYear,region,format,
  }), [debouncedKeyword,resourcesOnly,organizerId,heldYear,uploadYear,region,format]);
  const active = keys.some((key) => search.has(key));
  const [conditionsOpen, setConditionsOpen] = useState(active);

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
  }, [audience, filters, ready,attempt]);

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

  const setFilter = (key: typeof keys[number] | "q", value: string) => setSearch((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true, preventScrollReset: true });
  const reset = () => setSearch((current) => { const next = new URLSearchParams(current); keys.forEach((key) => next.delete(key)); return next; }, { replace: true, preventScrollReset: true });
  const facets = result?.facets;

  return <section className={styles.section} aria-labelledby="archive-discovery-title">
    <div className={styles.heading}><div className={styles.headingCopy}><h2 id="archive-discovery-title">{resourcesOnly ? "자료 찾기" : "행사·자료·기록 찾기"}</h2><p>{resourcesOnly ? "제목·자료 형식·행사 정보로 찾아보세요." : "주최나 행사가 열린 해로 찾아보세요."}</p></div><Filter size={26} aria-hidden="true" /></div>
    {resourcesOnly && <div className={styles.actions}><button className="button button-secondary" type="button" onClick={refresh}><RotateCcw size={16}/>새로고침</button><QcResourceCleanup onDeleted={refresh}/></div>}
    {resourcesOnly && <label className={styles.resourceSearch}><Search size={20} aria-hidden="true"/><span className="sr-only">자료 검색</span><input type="search" value={keyword} placeholder="자료 제목 검색" onChange={event=>setFilter("q",event.target.value)}/></label>}
    <details className={styles.conditions} open={conditionsOpen} onToggle={event => setConditionsOpen(event.currentTarget.open)}>
      <summary>상세 조건{active ? ` · ${keys.filter(key => search.has(key)).length}개 적용` : ""}</summary>
    <div className={styles.formGrid}>
      <label className={styles.form}>주최<select value={filters.organizerId ?? ""} onChange={(event) => setFilter("organizer", event.target.value)}><option value="">모든 주최</option>{facets?.organizers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <label className={styles.form}>개최 연도<span className={styles.muted}>행사가 열린 해</span><select value={filters.heldYear ?? ""} onChange={(event) => setFilter("heldYear", event.target.value)}><option value="">모든 개최 연도</option>{facets?.heldYears.map((year) => <option key={year}>{year}</option>)}</select></label>
      <label className={styles.form}>업로드 연도<span className={styles.muted}>자료를 올린 해</span><select value={filters.uploadYear ?? ""} onChange={(event) => setFilter("uploadYear", event.target.value)}><option value="">모든 업로드 연도</option>{facets?.uploadYears.map((year) => <option key={year}>{year}</option>)}</select></label>
      <label className={styles.form}>개최 지역<select value={filters.region ?? ""} onChange={(event) => setFilter("region", event.target.value)}><option value="">모든 지역</option>{facets?.regions.map((region) => <option key={region}>{region}</option>)}</select></label>
      <label className={styles.form}>자료 형식<select value={filters.format ?? ""} onChange={(event) => setFilter("archiveFormat", event.target.value)}><option value="">모든 형식</option>{facets?.formats.map((format) => <option key={format}>{format}</option>)}</select></label>
    </div>
    </details>
    {active && <div className={`${styles.actions} ${styles.selectedConditions}`} aria-label="적용한 상세 조건">{keys.filter(key => search.has(key)).map(key => <button type="button" key={key} onClick={() => setFilter(key, "")} aria-label={`${({ organizer: "주최", heldYear: "개최 연도", uploadYear: "업로드 연도", region: "지역", archiveFormat: "형식" })[key]} 조건 해제`}>{({ organizer: "주최", heldYear: "개최 연도", uploadYear: "업로드 연도", region: "지역", archiveFormat: "형식" })[key]}: {key === "organizer" ? facets?.organizers.find(item => item.id === search.get(key))?.displayName ?? "선택한 주최" : search.get(key)} <X size={14} aria-hidden="true" /></button>)}<button type="button" className="button button-secondary" onClick={reset}><X size={16} /> 행사 기준 초기화</button></div>}
    {state === "loading" && <p className={styles.status} role="status">행사와 연결된 자료를 찾고 있어요.</p>}
    {state === "error" && <p className={`${styles.status} ${styles.error}`} role="alert"><RotateCcw size={16} /> 행사 기준 검색을 완료하지 못했어요.</p>}
    {state === "ready" && result && <>
      <ul className={styles.counts} aria-label="현재 조건의 고유 결과">{resourcesOnly ? <><li>자료 {result.totalCount ?? result.counts.bundleCount + result.counts.materialCount}</li><li>첨부 파일 {result.counts.fileCount}</li></> : <><li>행사 {result.counts.eventCount}</li><li>자료 {result.counts.bundleCount + result.counts.materialCount}</li><li>활동 기록 {result.counts.activityCount}</li><li>첨부 파일 {result.counts.fileCount}</li></>}</ul>
      {resourcesOnly ? <div className={styles.resourceList}>
        <div className={styles.resourceColumns} aria-hidden="true"><span>이름</span><span>주최·출처</span><span>등록 날짜</span><span>관리</span></div>
        {result.items.map(item=>{
          const path=item.href || (item.targetType === "bundle" ? `/bundles/${item.id}` : `/materials/${item.id}`);
          const previews=item.files?.slice(0,3)??[];
          const formats=previews.length?previews.map(file=>file.format):[item.format??"문서"];
          return <article className={styles.resourceRow} key={`${item.targetType}:${item.id}`}>
            <Link className={styles.resourceName} to={path} state={{returnTo:location.pathname+location.search,resourcesReturn:location.pathname+location.search}}>
              <span className={styles.thumbnailStack}>{formats.map((format,index)=>{const Icon=/PPT/.test(format)?Presentation:/PNG|JPG|JPEG|WEBP/.test(format)?FileImage:FileText;return <span key={index} className={styles.fileThumbnail} data-format={format} aria-hidden="true"><Icon size={24}/><small>{format==="TEXT"?"글":format}</small></span>})}</span>
              <span className={styles.resourceTitle}><strong>{item.title}</strong>{item.files?.length?<small className={styles.fileSummary}><span className={styles.fileCount}>{item.files.length}개 파일</span><span className={styles.fileNames}>{item.files.slice(0,2).map(file=><span key={file.fileId} title={file.originalName}>{file.originalName}</span>)}</span>{item.files.length>2&&<span className={styles.fileMore}>외 {item.files.length-2}개</span>}</small>:<small>{item.format==="TEXT"?"글·회의록":item.format||"자료"}</small>}</span>
            </Link>
            <span className={styles.rowOrganizer}>{item.organizerLabel||"—"}</span>
            <time className={styles.rowDate} dateTime={item.uploadedAtMs?new Date(item.uploadedAtMs).toISOString():undefined}>{item.uploadedAtMs?new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Seoul"}).format(item.uploadedAtMs):"날짜 정보 없음"}</time>
            <div>{item.targetType==="material"&&item.canEdit?<OwnedSubmissionActions id={item.id} returnTo="/resources" onDeleted={refresh}/>:item.targetType==="bundle"&&item.canEdit?<ResourceActions id={item.id} type="bundle" onDeleted={refresh}/>:operator.administrator&&(item.targetType==="material"||item.targetType==="bundle")?<AdminResourceActions id={item.id} type={item.targetType} title={item.title} onDeleted={refresh}/>:null}</div>
          </article>
        })}
        {!result.items.length&&<p className={styles.status}>{audience==="public"?"공개된 자료가 없어요. 로그인하면 이용자에게 공개된 자료도 볼 수 있어요.":"현재 조건에서 볼 수 있는 자료가 없어요."}</p>}
      </div> : result.items.length ? <div className={styles.grid}>{result.items.map(item=><article className={styles.item} key={`${item.targetType}:${item.id}`}><Link to={item.href} state={{returnTo:location.pathname+location.search,resourcesReturn:location.pathname+location.search}}>{item.title}</Link></article>)}</div>:<p className={styles.status}>현재 조건에서 볼 수 있는 자료가 없어요.</p>}
      {result.nextCursor && <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "불러오는 중" : "검색 결과 더 보기"}</button>}
      {pageError && <p role="alert">{pageError}</p>}
      <p className={styles.muted}>현재 권한에서 조회한 결과 · {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: result.timeZone }).format(new Date(result.asOfMs))} 기준</p>
    </>}
  </section>;
}
