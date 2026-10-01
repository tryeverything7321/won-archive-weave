import { ArrowDown, ArrowUp, FilePlus2, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callableWriteErrorMessage } from "../../lib/firebase/callable-write-error";
import { uploadAccept, uploadContentType, uploadFileError } from "../uploads/file-policy";
import {
  finalizeMaterialBundle,
  listMyMaterialBundles,
  prepareMaterialBundleFiles,
  sha256File,
  updateMaterialBundle,
  updateMaterialBundleFiles,
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
  const [bundles, setBundles] = useState<MaterialBundle[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const result = await listMyMaterialBundles();
      setBundles(result.bundles);
      setLoadState("ready");
    } catch (error) {
      setMessage(callableWriteErrorMessage(error, "자료·기록"));
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [attempt, load]);

  if (loadState === "loading") return <p role="status"><LoaderCircle className="spin" size={18} /> 내 자료 묶음을 불러오고 있어요.</p>;
  if (loadState === "error") return <div className={styles.actions}><p role="alert">{message}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={17} /> 다시 확인</button></div>;

  return <section className={styles.manager} aria-labelledby="my-bundles-title">
    <div className={styles.managerHeader}>
      <div><h2 id="my-bundles-title">내 자료 묶음</h2><p>파일별 검사 상태와 표시 순서를 관리할 수 있어요.</p></div>
      <Link className="button button-primary" to="/contribute?intent=material"><FilePlus2 size={17} /> 새 묶음 올리기</Link>
    </div>
    {!bundles.length ? <p>아직 올린 자료 묶음이 없습니다.</p> : bundles.map((bundle) => <BundleEditor key={`${bundle.bundleId}:${bundle.updatedAtMs ?? 0}`} bundle={bundle} onChanged={load} />)}
  </section>;
}

function BundleEditor({ bundle, onChanged }: { bundle: MaterialBundle; onChanged: () => Promise<void> }) {
  const rights = bundle.rightsRecord;
  const [title, setTitle] = useState(bundle.title);
  const [description, setDescription] = useState(bundle.description);
  const [visibility, setVisibility] = useState<BundleVisibility>(bundle.visibility);
  const [source, setSource] = useState(rights?.source ?? "");
  const [owner, setOwner] = useState(rights?.owner ?? "");
  const [attribution, setAttribution] = useState(rights?.attribution ?? "");
  const [consentBasis, setConsentBasis] = useState(rights?.consentBasis ?? "");
  const [redistribution, setRedistribution] = useState<BundleRights>(bundle.rights);
  const [files, setFiles] = useState(bundle.files.filter((file) => file.status !== "withdrawn"));
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  const saveMetadata = async () => {
    if (!rights || !title.trim() || !source.trim() || !owner.trim() || !attribution.trim() || !consentBasis.trim()) {
      setMessage("출처와 권리 정보를 모두 확인해 주세요."); return;
    }
    setWorking(true); setMessage("");
    try {
      await updateMaterialBundle({
        bundleId: bundle.bundleId, requestId: crypto.randomUUID(), title: title.trim(), description: description.trim(), visibility,
        eventId: bundle.eventId ?? null,
        rights: { ...rights, source: source.trim(), owner: owner.trim(), attribution: attribution.trim(), consentBasis: consentBasis.trim(), redistribution, retention: redistribution === "source_link_only" ? "source_link" : "managed" },
      });
      setMessage("공통 정보를 저장했어요."); await onChanged();
    } catch (error) { setMessage(callableWriteErrorMessage(error, "자료·기록")); }
    finally { setWorking(false); }
  };

  const saveFiles = async (nextFiles = files) => {
    const active = nextFiles.filter((file) => file.status !== "withdrawn");
    setWorking(true); setMessage("");
    try {
      await updateMaterialBundleFiles({ bundleId: bundle.bundleId, requestId: crypto.randomUUID(), files: active.map((file, order) => ({ fileId: file.fileId, displayName: file.displayName.trim() || baseFileName(file.originalName), order })) });
      setMessage("파일 이름과 순서를 저장했어요."); await onChanged();
    } catch (error) { setMessage(callableWriteErrorMessage(error, "자료·기록")); }
    finally { setWorking(false); }
  };

  const selectUpload = (file: File, replaceFileId?: string) => {
    const error = uploadFileError(file);
    const activeFiles = files.filter((item) => item.status !== "withdrawn" && item.fileId !== replaceFileId);
    if (!replaceFileId && activeFiles.length >= maximumBundleFiles) return setMessage("한 묶음에는 파일을 10개까지 올릴 수 있어요.");
    if (activeFiles.reduce((sum, item) => sum + item.sizeBytes, 0) + file.size > maximumBundleBytes) return setMessage("한 묶음의 파일은 모두 합해 100MB 이하로 올려 주세요.");
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
      setPending(null); setMessage("파일을 올렸어요. 안전 확인이 끝나면 열 수 있어요."); await onChanged();
    } catch (error) {
      const text = callableWriteErrorMessage(error, "자료·기록");
      setPending((current) => current ? { ...current, uploading: false, error: text } : current); setMessage(text);
    } finally { setWorking(false); }
  };

  const withdraw = async (fileId: string) => {
    setWorking(true); setMessage("");
    try { await withdrawMaterialBundleFile(bundle.bundleId, fileId); setMessage("파일 공개를 중단했어요."); await onChanged(); }
    catch (error) { setMessage(callableWriteErrorMessage(error, "자료·기록")); }
    finally { setWorking(false); }
  };

  return <article className={styles.bundleEditor}>
    <div className={styles.editorHeader}>
      <div><h3>{bundle.title}</h3><p>{bundle.files.length}개 파일 · {bundle.status === "active" ? "게시됨" : bundle.status === "draft" ? "등록 중" : "공개 중단"}</p></div>
      <Link className="button button-secondary" to={`/bundles/${encodeURIComponent(bundle.bundleId)}`}>묶음 보기</Link>
    </div>
    <div className={styles.editorFields}>
      <label>제목<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>공개 범위<select value={visibility} onChange={(event) => setVisibility(event.target.value as BundleVisibility)}><option>공개</option><option>회원 전용</option><option>보류</option></select></label>
      <label className={styles.wide}>설명<textarea value={description} maxLength={5000} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>자료 출처<input value={source} maxLength={160} onChange={(event) => setSource(event.target.value)} /></label>
      <label>권리자<input value={owner} maxLength={160} onChange={(event) => setOwner(event.target.value)} /></label>
      <label>표시할 이름<input value={attribution} maxLength={160} onChange={(event) => setAttribution(event.target.value)} /></label>
      <label>공유 근거<input value={consentBasis} maxLength={500} onChange={(event) => setConsentBasis(event.target.value)} /></label>
      <label>파일 이용 방법<select value={redistribution} onChange={(event) => setRedistribution(event.target.value as BundleRights)}><option value="view_only">위브에서 보기</option><option value="download_allowed">원본 내려받기</option></select></label>
    </div>
    <div className={styles.actions}><button type="button" disabled={working || !rights} onClick={() => void saveMetadata()}>공통 정보 저장</button>{!rights && <span>권리 정보를 불러온 뒤 수정할 수 있어요.</span>}</div>
    <div className={styles.managerFiles}>
      {files.filter((file) => file.status !== "withdrawn").map((file, index, activeFiles) => {
        const state = bundleFileStatusCopy(file.status);
        return <div className={styles.managerFile} key={file.fileId}>
          <label>{index + 1}. 표시 이름<input value={file.displayName} maxLength={160} onChange={(event) => setFiles((current) => current.map((item) => item.fileId === file.fileId ? { ...item, displayName: event.target.value } : item))} /><span className={`${styles.badge} ${styles[state.tone]}`}>{state.label}</span></label>
          <div className={styles.actions}>
            <button type="button" disabled={working || index === 0} aria-label={`${file.displayName} 위로 이동`} onClick={() => setFiles((current) => reorderBundleFiles(current, current.findIndex((item) => item.fileId === file.fileId), index - 1))}><ArrowUp size={17} /></button>
            <button type="button" disabled={working || index === activeFiles.length - 1} aria-label={`${file.displayName} 아래로 이동`} onClick={() => setFiles((current) => reorderBundleFiles(current, current.findIndex((item) => item.fileId === file.fileId), index + 1))}><ArrowDown size={17} /></button>
            <label className={styles.filePicker}>교체<input type="file" accept={uploadAccept} onChange={(event) => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (selected) selectUpload(selected, file.fileId); }} /></label>
            <button type="button" disabled={working} onClick={() => void withdraw(file.fileId)}><Trash2 size={17} /> 공개 중단</button>
          </div>
        </div>;
      })}
    </div>
    <div className={styles.actions}>
      <button type="button" disabled={working} onClick={() => void saveFiles()}>파일 이름·순서 저장</button>
      <label className={styles.filePicker}>파일 추가<input type="file" accept={uploadAccept} onChange={(event) => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (selected) selectUpload(selected); }} /></label>
    </div>
    {pending && <div className={styles.actions}><span>{pending.replaceFileId ? "교체" : "추가"}할 파일: {pending.file.name}</span><button type="button" disabled={pending.uploading} onClick={() => void uploadPending()}>{pending.uploading ? <LoaderCircle className="spin" size={17} /> : pending.error ? <RotateCcw size={17} /> : <FilePlus2 size={17} />}{pending.error ? "다시 시도" : "이 파일 올리기"}</button><button type="button" disabled={pending.uploading} onClick={() => setPending(null)}>취소</button></div>}
    {message && <p className={message.includes("했어요") ? styles.success : styles.error} role="status">{message}</p>}
  </article>;
}
