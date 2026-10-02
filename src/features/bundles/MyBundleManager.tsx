import { ArrowDown, ArrowUp, CheckCircle2, FilePlus2, LoaderCircle, RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { callableWriteErrorMessage } from "../../lib/firebase/callable-write-error";
import { uploadAccept, uploadContentType, uploadFileError } from "../uploads/file-policy";
import {
  finalizeMaterialBundle,
  listMyMaterialBundles,
  prepareMaterialBundleFiles,
  sha256File,
  updateMaterialBundle,
  uploadPreparedBundleFile,
  withdrawMaterialBundleFile,
} from "./bundle-api";
import {
  baseFileName,
  bundleFileStatusCopy,
  maximumBundleBytes,
  maximumBundleFiles,
  reorderBundleFiles,
  type BundleRights,
  type BundleVisibility,
  type MaterialBundle,
} from "./bundle-model";
import styles from "./BundleViews.module.css";

type PendingUpload = { file: File; clientFileId: string; replaceFileId?: string; uploading: boolean; error: string };

export function MyBundleManager() {
  const [search]=useSearchParams();
  const selectedId=search.get("bundleId");
  const [bundles, setBundles] = useState<MaterialBundle[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (notice = "") => {
    setLoadState("loading");
    try {
      const result = await listMyMaterialBundles();
      while(selectedId && !result.bundles.some(bundle=>bundle.bundleId===selectedId) && result.nextCursor){const next=await listMyMaterialBundles(result.nextCursor);result.bundles.push(...next.bundles);result.nextCursor=next.nextCursor}
      setBundles(result.bundles);
      setNextCursor(result.nextCursor);
      setMessage(notice);
      setLoadState("ready");
    } catch (error) {
      setMessage(callableWriteErrorMessage(error, "자료·기록"));
      setLoadState("error");
    }
  }, [selectedId]);

  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setMessage("");
    try {
      const result = await listMyMaterialBundles(nextCursor);
      setBundles((current) => [...current, ...result.bundles.filter((item) => !current.some((existing) => existing.bundleId === item.bundleId))]);
      setNextCursor(result.nextCursor);
    } catch (error) {
      setMessage(callableWriteErrorMessage(error, "자료·기록"));
    } finally { setLoadingMore(false); }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [attempt, load]);

  if (loadState === "loading") return <p role="status"><LoaderCircle className="spin" size={18} /> 내 자료를 불러오고 있어요.</p>;
  if (loadState === "error") return <div className={styles.actions}><p role="alert">{message}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={17} /> 다시 확인</button></div>;

  return <section className={styles.manager} aria-labelledby="my-bundles-title">
    {selectedId && <Link to="/profile?tab=activity">내 자료 전체 보기</Link>}
    <div className={styles.managerHeader}>
      <div><h2 id="my-bundles-title">내 자료</h2><p>파일별 검사 상태와 표시 순서를 관리할 수 있어요.</p></div>
      <Link className="button button-primary" to="/contribute?intent=material"><FilePlus2 size={17} /> 자료 올리기</Link>
    </div>
    {!bundles.length ? <p>아직 올린 자료가 없습니다.</p> : bundles.filter(bundle=>!selectedId||bundle.bundleId===selectedId).map((bundle) => <BundleEditor key={`${bundle.bundleId}:${bundle.updatedAtMs ?? 0}`} bundle={bundle} onChanged={load} />)}
    {nextCursor !== null && <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "불러오는 중" : "자료 더 보기"}</button>}
    {message && <p role="status"><CheckCircle2 size={18}/>{message}</p>}
  </section>;
}

function BundleEditor({ bundle, onChanged }: { bundle: MaterialBundle; onChanged: (notice?: string) => Promise<void> }) {
  const rights = bundle.rightsRecord;
  const [title, setTitle] = useState(bundle.title);
  const [description, setDescription] = useState(bundle.description);
  const [visibility, setVisibility] = useState<BundleVisibility>(bundle.visibility);
  const [source, setSource] = useState(rights?.source ?? "");
  const [owner, setOwner] = useState(rights?.owner ?? "");
  const [attribution] = useState(rights?.attribution ?? "");
  const [consentBasis, setConsentBasis] = useState(rights?.consentBasis ?? "");
  const [redistribution, setRedistribution] = useState<BundleRights>(bundle.rights);
  const [files, setFiles] = useState(bundle.files.filter((file) => file.status !== "withdrawn"));
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  const fileEdits = files.filter(file=>file.status!=="withdrawn").map((file,order)=>({fileId:file.fileId,displayName:file.displayName.trim()||baseFileName(file.originalName),order}));
  const originalEdits = bundle.files.filter(file=>file.status!=="withdrawn").map((file,order)=>({fileId:file.fileId,displayName:file.displayName,order}));
  const dirty = title!==bundle.title || description!==bundle.description || visibility!==bundle.visibility || source!==(rights?.source??"") || owner!==(rights?.owner??"") || attribution!==(rights?.attribution??"") || consentBasis!==(rights?.consentBasis??"") || redistribution!==bundle.rights || JSON.stringify(fileEdits)!==JSON.stringify(originalEdits);
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=""};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn)},[dirty]);
  const saveChanges = async () => {
    if (!rights || title.trim().length<2 || !source.trim() || !owner.trim() || !attribution.trim() || !consentBasis.trim()) {
      setMessage("제목은 2자 이상 입력하고 출처와 권리 정보를 확인해 주세요."); return;
    }
    setWorking(true); setMessage("");
    try {
      await updateMaterialBundle({
        bundleId: bundle.bundleId, requestId: crypto.randomUUID(), title: title.trim(), description, visibility,
        eventId: bundle.eventId ?? null,
        ...(fileEdits.length?{fileEdits}:{}),
        rights: { ...rights, source: source.trim(), owner: owner.trim(), attribution: attribution.trim(), consentBasis: consentBasis.trim(), redistribution, retention: redistribution === "source_link_only" ? "source_link" : "managed" },
      });
      await onChanged("수정 내용을 저장했어요.");
    } catch (error) { setMessage(callableWriteErrorMessage(error, "자료·기록")); }
    finally { setWorking(false); }
  };

  const selectUpload = (file: File, replaceFileId?: string) => {
    const error = uploadFileError(file);
    const activeFiles = files.filter((item) => item.status !== "withdrawn" && item.fileId !== replaceFileId);
    if (!replaceFileId && activeFiles.length >= maximumBundleFiles) return setMessage("자료 하나에는 파일을 10개까지 올릴 수 있어요.");
    if (activeFiles.reduce((sum, item) => sum + item.sizeBytes, 0) + file.size > maximumBundleBytes) return setMessage("자료에 첨부하는 파일은 모두 합해 100MB 이하로 올려 주세요.");
    if (error) return setMessage(error);
    setPending({ file, replaceFileId, clientFileId: crypto.randomUUID(), uploading: false, error: "" });
    setMessage("");
  };

  const uploadPending = async () => {
    if (!pending) return;
    setPending({ ...pending, uploading: true, error: "" }); setWorking(true); setMessage("");
    try {
      const sha256 = await sha256File(pending.file);
      const requestId = crypto.randomUUID();
      const contentType = uploadContentType(pending.file);
      const current = pending.replaceFileId ? files.find((item) => item.fileId === pending.replaceFileId) : undefined;
      const prepared = await prepareMaterialBundleFiles({ bundleId: bundle.bundleId, requestId, files: [{ clientFileId: pending.clientFileId, name: pending.file.name, displayName: current?.displayName || baseFileName(pending.file.name), order: current?.order ?? files.filter((item) => item.status !== "withdrawn").length, size: pending.file.size, contentType, sha256, ...(pending.replaceFileId ? { replaceFileId: pending.replaceFileId } : {}) }] });
      const target = prepared.files[0];
      if (!target) throw new Error("파일 업로드 대상을 확인하지 못했어요.");
      await uploadPreparedBundleFile(bundle.bundleId, target, pending.file, prepared.reservationId, requestId, contentType, () => undefined);
      await finalizeMaterialBundle(bundle.bundleId, crypto.randomUUID());
      setPending(null); await onChanged("파일을 올렸어요. 안전 확인이 끝나면 열 수 있어요.");
    } catch (error) {
      const text = callableWriteErrorMessage(error, "자료·기록");
      setPending((current) => current ? { ...current, uploading: false, error: text } : current); setMessage(text);
    } finally { setWorking(false); }
  };

  const withdraw = async (fileId: string) => {
    setWorking(true); setMessage("");
    try { await withdrawMaterialBundleFile(bundle.bundleId, fileId); await onChanged("파일 공개를 중단했어요."); }
    catch (error) { setMessage(callableWriteErrorMessage(error, "자료·기록")); }
    finally { setWorking(false); }
  };

  return <article className={styles.bundleEditor}>
    <div className={styles.editorHeader}>
      <div><h3>{bundle.title}</h3><p>{bundle.files.length}개 파일 · {bundle.status === "active" ? "게시됨" : bundle.status === "draft" ? "등록 중" : "공개 중단"}</p></div>
      <Link className="button button-secondary" to={`/bundles/${encodeURIComponent(bundle.bundleId)}`} state={{ returnTo: "/profile?tab=activity" }}>자료 보기</Link>
    </div>
    <div className={styles.saveBar} role="group" aria-label="수정 내용 저장">
      <div><strong>{dirty?"저장하지 않은 변경이 있어요":"수정한 내용을 여기서 저장하세요"}</strong><span>제목·설명·공개 범위와 파일 이름·순서를 함께 저장해요</span></div>
      <button className="button button-primary" type="button" disabled={working || !rights || !!pending || !dirty} onClick={()=>void saveChanges()}>{working?<LoaderCircle className="spin" size={18}/>:<Save size={18}/>}수정 내용 저장</button>
    </div>
    {message && <p className={styles.errorNotice} role="alert">{message}</p>}
    {!rights && <p role="status">권리 정보를 불러온 뒤 수정할 수 있어요.</p>}
    <fieldset className={styles.editorFields} disabled={working||!!pending}><legend>자료 내용</legend>
      <label>제목<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>공개 범위<select value={visibility} onChange={(event) => setVisibility(event.target.value as BundleVisibility)}><option>공개</option><option>회원 전용</option><option>보류</option></select></label>
      <label className={styles.wide}>설명<textarea value={description} maxLength={5000} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>자료 출처<input value={source} maxLength={160} onChange={(event) => setSource(event.target.value)} /></label>
      <label>권리자<input value={owner} maxLength={160} onChange={(event) => setOwner(event.target.value)} /></label>
      <label>공유 근거<input value={consentBasis} maxLength={500} onChange={(event) => setConsentBasis(event.target.value)} /></label>
      <label>파일 이용 방법<select value={redistribution} onChange={(event) => setRedistribution(event.target.value as BundleRights)}><option value="view_only">위브에서 보기</option><option value="download_allowed">원본 내려받기</option></select></label>
    </fieldset>
    <h4 className={styles.filesHeading}>첨부 파일</h4>
    {dirty&&<p className={styles.fileHelp}>파일 추가·교체·공개 중단은 수정 내용을 저장한 뒤 할 수 있어요</p>}
    <div className={styles.managerFiles}>
      {files.filter((file) => file.status !== "withdrawn").map((file, index, activeFiles) => {
        const state = bundleFileStatusCopy(file.status);
        return <div className={styles.managerFile} key={file.fileId}>
          <label>{index + 1}. 표시 이름<input disabled={working||!!pending} value={file.displayName} maxLength={160} onChange={(event) => setFiles((current) => current.map((item) => item.fileId === file.fileId ? { ...item, displayName: event.target.value } : item))} /><span className={`${styles.badge} ${styles[state.tone]}`}>{state.label}</span></label>
          <div className={styles.actions}>
            <button type="button" disabled={working || !!pending || index === 0} aria-label={`${file.displayName} 위로 이동`} onClick={() => setFiles((current) => reorderBundleFiles(current, current.findIndex((item) => item.fileId === file.fileId), index - 1))}><ArrowUp size={17} /></button>
            <button type="button" disabled={working || !!pending || index === activeFiles.length - 1} aria-label={`${file.displayName} 아래로 이동`} onClick={() => setFiles((current) => reorderBundleFiles(current, current.findIndex((item) => item.fileId === file.fileId), index + 1))}><ArrowDown size={17} /></button>
            <label className={styles.filePicker}>교체<input type="file" disabled={working||dirty||!!pending} accept={uploadAccept} onChange={(event) => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (selected) selectUpload(selected, file.fileId); }} /></label>
            <button type="button" disabled={working||dirty||!!pending} onClick={() => void withdraw(file.fileId)}><Trash2 size={17} /> 공개 중단</button>
          </div>
        </div>;
      })}
    </div>
    <div className={styles.actions}>
      <label className={styles.filePicker}>파일 추가<input type="file" disabled={working||dirty||!!pending} accept={uploadAccept} onChange={(event) => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (selected) selectUpload(selected); }} /></label>
    </div>
    {pending && <div className={styles.actions}><span>{pending.replaceFileId ? "교체" : "추가"}할 파일: {pending.file.name}</span><button type="button" disabled={pending.uploading} onClick={() => void uploadPending()}>{pending.uploading ? <LoaderCircle className="spin" size={17} /> : pending.error ? <RotateCcw size={17} /> : <FilePlus2 size={17} />}{pending.error ? "다시 시도" : "이 파일 올리기"}</button><button type="button" disabled={pending.uploading} onClick={() => setPending(null)}>취소</button></div>}
  </article>;
}
