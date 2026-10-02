import { ArrowLeft, Download, Eye, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { callableWriteErrorMessage } from "../../lib/firebase/callable-write-error";
import { createMaterialBundleFileAccess, getMaterialBundle } from "./bundle-api";
import { bundleFileStatusCopy, type MaterialBundle } from "./bundle-model";
import styles from "./BundleViews.module.css";

function formatBytes(bytes: number) {
  const safe = Math.max(0, bytes);
  if (safe < 1024) return `${safe.toLocaleString("ko-KR")}B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}KB`;
  return `${(safe / (1024 * 1024)).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}MB`;
}

export function BundleDetailPage() {
  const { bundleId = "" } = useParams();
  const location = useLocation();
  const candidate = location.state?.returnTo;
  const returnTo = typeof candidate === "string" && /^\/(?![/\\])/.test(candidate) ? candidate : "/resources";
  const [attempt, setAttempt] = useState(0);
  const pollingStarted = useRef(0);
  const [bundle, setBundle] = useState<MaterialBundle | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [openingFileId, setOpeningFileId] = useState("");

  useEffect(() => {
    let active = true;
    void getMaterialBundle(bundleId)
      .then((value) => { if (active) { setBundle(value); setLoadState("ready"); } })
      .catch((error) => { if (active) { setMessage(callableWriteErrorMessage(error, "자료·기록")); setLoadState(current => current === "ready" ? "ready" : "error"); } });
    return () => { active = false; };
  }, [attempt, bundleId]);

  useEffect(()=>{
    if (!pollingStarted.current) pollingStarted.current=Date.now();
    if (Date.now() - pollingStarted.current > 120_000 || !bundle?.files.some(file=>file.status === "upload_pending" || file.status === "scanning")) return;
    const timer=setTimeout(()=>{if(document.visibilityState === "visible")setAttempt(value=>value+1)},5000);
    return()=>clearTimeout(timer);
  },[attempt,bundle]);

  const openFile = async (fileId: string, action: "preview" | "download") => {
    setOpeningFileId(fileId);
    setMessage("");
    try {
      const access = await createMaterialBundleFileAccess(bundleId, fileId, action);
      window.location.assign(access.url);
    } catch (error) {
      setMessage(callableWriteErrorMessage(error, "자료·기록"));
    } finally {
      setOpeningFileId("");
    }
  };

  if (loadState === "loading") return <PageFrame eyebrow="자료 묶음" title="자료를 불러오고 있어요" description="파일별 공개 상태를 확인하고 있어요"><p role="status"><LoaderCircle className="spin" size={18} /> 잠시만 기다려 주세요.</p></PageFrame>;
  if (loadState === "error" || !bundle) return <PageFrame eyebrow="자료 묶음" title="자료 묶음을 열지 못했어요" description={message || "공개가 중단되었거나 열람 권한이 필요한 자료일 수 있어요."}><div className={styles.actions}><Link to={returnTo}>자료 목록</Link><button type="button" onClick={() => { setLoadState("loading"); setAttempt((value) => value + 1); }}><RotateCcw size={17} /> 다시 확인</button></div></PageFrame>;

  return <PageFrame eyebrow="자료 묶음" title={bundle.title} description={`${bundle.files.length}개 파일 · ${bundle.visibility}`}>
    <div className={styles.bundlePage}>
      <Link className={styles.backLink} to={returnTo}><ArrowLeft size={17} /> 이전 화면으로</Link>
      {bundle.description && <p className={styles.description}>{bundle.description}</p>}
      <dl className={styles.metadata}>
        <div><dt>출처</dt><dd>{bundle.sourceLabel || bundle.ownerLabel || "표시된 출처 없음"}</dd></div>
        <div><dt>이용</dt><dd>{bundle.rights === "download_allowed" ? "원본 내려받기 가능" : bundle.rights === "source_link_only" ? "출처 링크에서만 이용" : "위브에서 보기"}</dd></div>
      </dl>
      <section aria-labelledby="bundle-files-title">
        <div className={styles.sectionHeading}><h2 id="bundle-files-title">묶음 파일</h2><span>바이러스·파일 형식 검사를 통과하면 열 수 있어요</span></div>
        {bundle.files.some(file=>file.status === "upload_pending" || file.status === "scanning" || file.status === "error") && <div className={styles.actions}><p role="status">검사 중인 파일은 상태를 자동으로 갱신해요. 검사 연결 오류는 파일이 위험하다는 뜻이 아니에요.</p><button type="button" className="button button-secondary" onClick={()=>{pollingStarted.current=Date.now();setAttempt(value=>value+1)}}><RotateCcw size={17} aria-hidden="true"/>상태 다시 확인</button><Link className="button button-secondary" to="/profile">내 자료 수정·재시도</Link></div>}
        <div className={styles.fileGrid}>
          {bundle.files.map((file, index) => {
            const state = bundleFileStatusCopy(file.status);
            const available = state.actionable && file.scanStatus === "clean";
            return <article className={styles.fileCard} key={file.fileId}>
              <span className={styles.order}>{index + 1}</span>
              <div><h3>{file.displayName}</h3><p>{file.originalName} · {formatBytes(file.sizeBytes)}</p><span className={`${styles.badge} ${styles[state.tone]}`}>{state.label}</span></div>
              <div className={styles.fileActions}>
                <button type="button" disabled={!available || openingFileId === file.fileId} onClick={() => void openFile(file.fileId, "preview")}><Eye size={17} /> 미리보기</button>
                {bundle.rights === "download_allowed" && <button type="button" disabled={!available || openingFileId === file.fileId} onClick={() => void openFile(file.fileId, "download")}><Download size={17} /> 내려받기</button>}
              </div>
            </article>;
          })}
          {!bundle.files.length && <p>지금 열 수 있는 파일이 없습니다.</p>}
        </div>
      </section>
      {message && <p className={styles.error} role="alert">{message}</p>}
    </div>
  </PageFrame>;
}
