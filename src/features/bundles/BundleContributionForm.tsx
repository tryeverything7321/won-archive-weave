import { FieldRequirement } from "../../components/forms/FieldRequirement";
import { onAuthStateChanged, type User } from "firebase/auth";
import { ArrowDown, ArrowUp, CheckCircle2, CircleAlert, FilePlus2, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { getFirebaseServices } from "../../lib/firebase/client";
import { callableWriteErrorMessage } from "../../lib/firebase/callable-write-error";
import { startOAuthLogin } from "../auth/api";
import { ProviderLoginButton } from "../auth/ProviderLoginButton";
import { uploadAccept } from "../uploads/file-policy";
import {
  createMaterialBundle,
  ensureCalendarArchiveEvent,
  finalizeMaterialBundle,
  linkArchiveTarget,
  prepareMaterialBundleFiles,
  sha256File,
  uploadPreparedBundleFile,
  type BundleFileDescriptor,
} from "./bundle-api";
import {
  bundleFileDescriptor,
  bundleSelectionError,
  createBundleRightsRecord,
  createLocalBundleFiles,
  reorderBundleFiles,
  suggestedBundleTitle,
  type BundleRights,
  type BundleVisibility,
  type LocalBundleFile,
} from "./bundle-model";
import styles from "./BundleContributionForm.module.css";

type FormStatus = { tone: "idle" | "working" | "success" | "error"; message: string };
type BundleContributionFormProps = {
  calendarEventId?: string;
  eventLabel?: string;
  returnTo?: string;
  onCompleted?: (result: { bundleId: string; status: "active" }) => void;
};

function safeInternalPath(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    const url = new URL(value, "https://weave.local");
    return url.origin === "https://weave.local" && url.pathname.startsWith("/") && !url.pathname.startsWith("//")
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch { return fallback; }
}

function formatBytes(bytes: number) {
  const safe = Math.max(0, bytes);
  if (safe < 1024) return `${safe.toLocaleString("ko-KR")}B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}KB`;
  return `${(safe / (1024 * 1024)).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}MB`;
}

export function BundleContributionForm(props: BundleContributionFormProps) {
  const services = useMemo(() => getFirebaseServices(), []);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryEventId = searchParams.get("calendarEventId") ?? searchParams.get("eventId") ?? "";
  const rawArchiveEventId = searchParams.get("archiveEventId")?.trim() ?? "";
  const queryArchiveEventId = rawArchiveEventId.length <= 120 && !/[/?#]/u.test(rawArchiveEventId) ? rawArchiveEventId : "";
  const [archiveEventId, setArchiveEventId] = useState(queryArchiveEventId);
  const [calendarEventId, setCalendarEventId] = useState(queryArchiveEventId ? "" : props.calendarEventId ?? queryEventId);
  const returnTo = safeInternalPath(props.returnTo ?? searchParams.get("returnTo"), "/resources");
  const loginReturnTo = `${location.pathname}${location.search}${location.hash}`;
  const [user, setUser] = useState<User | null>(() => services?.auth.currentUser ?? null);
  const [files, setFiles] = useState<LocalBundleFile[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [consentReasons, setConsentReasons] = useState<string[]>([]);
  const consentBasis = consentReasons.join(" · ");
  const [consentError, setConsentError] = useState(false);
  const consentGroup = useRef<HTMLFieldSetElement>(null);
  const [visibility, setVisibility] = useState<BundleVisibility | "">("");
  const [rights, setRights] = useState<BundleRights>("view_only");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [status, setStatus] = useState<FormStatus>({ tone: "idle", message: "" });
  const [bundleId, setBundleId] = useState("");
  const [finalized, setFinalized] = useState(false);
  const [relationState, setRelationState] = useState<"none" | "linked" | "failed">("none");
  const [selectionError, setSelectionError] = useState("");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const createRequestId = useRef(crypto.randomUUID());
  const finalizeRequestId = useRef(crypto.randomUUID());
  const relationRequestId = useRef(crypto.randomUUID());
  const eventRequestId = useRef(crypto.randomUUID());
  const sourceModePath = `/contribute?${new URLSearchParams({
    intent: "material",
    legacy: "1",
    ...(archiveEventId ? { archiveEventId } : calendarEventId ? { calendarEventId } : {}),
    ...(returnTo ? { returnTo } : {}),
  })}`;

  useEffect(() => {
    if (!services) return undefined;
    return onAuthStateChanged(services.auth, (nextUser) => {
      setUser(nextUser);
      const name = nextUser?.displayName?.trim() ?? "";
      if (name) {
        setOwner((current) => current || name);
      }
    });
  }, [services]);

  const addFiles = (incoming: FileList | File[] | null) => {
    if (status.tone === "working" || bundleId) return;
    const selected = [...(incoming ?? [])];
    if (!selected.length) return;
    const error = bundleSelectionError(files, selected);
    if (error) {
      setSelectionError(error);
      return;
    }
    const added = createLocalBundleFiles(selected).map((item, index) => ({ ...item, order: files.length + index }));
    setFiles((current) => [...current, ...added]);
    if (!title.trim()) setTitle(suggestedBundleTitle([...files.map((item) => item.file), ...selected]));
    setSelectionError("");
  };

  const patchFile = (clientFileId: string, patch: Partial<LocalBundleFile>) => {
    setFiles((current) => current.map((item) => item.clientFileId === clientFileId ? { ...item, ...patch } : item));
  };

  const resolveArchiveEvent = async () => {
    if (!calendarEventId) return "";
    return (await ensureCalendarArchiveEvent(calendarEventId, eventRequestId.current)).archiveEventId;
  };

  const uploadRows = async (activeBundleId: string, rows: LocalBundleFile[]) => {
    const descriptors: BundleFileDescriptor[] = [];
    for (const row of rows) {
      patchFile(row.clientFileId, { status: "hashing", progress: 0, error: undefined });
      const sha256 = await sha256File(row.file);
      descriptors.push(bundleFileDescriptor(row, sha256, row.fileId));
    }
    const requestId = crypto.randomUUID();
    const prepared = await prepareMaterialBundleFiles({ bundleId: activeBundleId, requestId, files: descriptors });
    const targets = new Map(prepared.files.map((item) => [item.clientFileId, item]));
    const outcomes = await Promise.all(rows.map(async (row) => {
      const target = targets.get(row.clientFileId);
      if (!target) {
        patchFile(row.clientFileId, { status: "failed", error: "파일 업로드 대상을 확인하지 못했어요." });
        return false;
      }
      patchFile(row.clientFileId, { fileId: target.fileId, revision: target.revision, status: "uploading", progress: 0 });
      try {
        const descriptor = descriptors.find((item) => item.clientFileId === row.clientFileId);
        if (!descriptor) throw new Error("파일 업로드 정보를 확인하지 못했어요.");
        await uploadPreparedBundleFile(activeBundleId, target, row.file, prepared.reservationId, requestId, descriptor.contentType, (progress) => {
          patchFile(row.clientFileId, { progress });
        });
        patchFile(row.clientFileId, { status: "uploaded", progress: 100, error: undefined });
        return true;
      } catch (error) {
        patchFile(row.clientFileId, {
          fileId: target.fileId,
          revision: target.revision,
          status: "failed",
          error: callableWriteErrorMessage(error, "자료·기록"),
        });
        return false;
      }
    }));
    return outcomes;
  };

  const connectEvent = async (activeBundleId: string) => {
    if (!calendarEventId && !archiveEventId) return;
    try {
      const targetArchiveEventId = archiveEventId || await resolveArchiveEvent();
      await linkArchiveTarget({ archiveEventId: targetArchiveEventId, targetType: "bundle", targetId: activeBundleId, requestId: relationRequestId.current });
      setRelationState("linked");
    } catch {
      setRelationState("failed");
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!services || !user) return setStatus({ tone: "error", message: "자료를 올리려면 먼저 로그인해 주세요." });
    if (!files.length) return setStatus({ tone: "error", message: "먼저 올릴 파일을 선택해 주세요." });
    if (!title.trim()) return setStatus({ tone: "error", message: "자료 제목을 입력해 주세요." });
    if (!visibility) return setStatus({ tone: "error", message: "공개 범위를 선택해 주세요." });
    if (!owner.trim()) return setStatus({ tone: "error", message: "권리자를 적어 주세요." });
    if (!consentReasons.length) {
      setConsentError(true);
      consentGroup.current?.querySelector('input')?.focus();
      return;
    }
    if (!rightsConfirmed) return setStatus({ tone: "error", message: "공유 권한과 개인정보 확인을 완료해 주세요." });
    setSelectionError("");
    setStatus({ tone: "working", message: "자료 묶음을 만들고 파일을 올리고 있어요." });
    try {
      let resolvedArchiveEventId = archiveEventId;
      if (!resolvedArchiveEventId && calendarEventId) {
        try { resolvedArchiveEventId = await resolveArchiveEvent(); }
        catch { setRelationState("failed"); }
      }
      const created = bundleId
        ? { bundleId, status: "draft" as const }
        : await createMaterialBundle({
            requestId: createRequestId.current,
            title: title.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            visibility,
            rights: createBundleRightsRecord({ source: source.trim() || "작성자 제공", owner, attribution: owner, redistribution: rights, consentBasis }),
            ...(resolvedArchiveEventId ? { eventId: resolvedArchiveEventId } : {}),
          });
      setBundleId(created.bundleId);
      const outcomes = await uploadRows(created.bundleId, files.filter((item) => item.status !== "uploaded"));
      await finalizeMaterialBundle(created.bundleId, finalizeRequestId.current);
      setFinalized(true);
      await connectEvent(created.bundleId);
      const failed = outcomes.filter((result) => !result).length;
      setStatus({
        tone: "success",
        message: failed
          ? `${files.length - failed}개 파일을 올렸고 ${failed}개는 다시 시도할 수 있어요.`
          : `${files.length}개 파일을 한 묶음으로 올렸어요. 파일별 안전 확인이 끝나면 열 수 있어요.`,
      });
      props.onCompleted?.({ bundleId: created.bundleId, status: "active" });
    } catch (error) {
      setStatus({ tone: "error", message: callableWriteErrorMessage(error, "자료·기록") });
    }
  };

  const retryFile = async (row: LocalBundleFile) => {
    if (!bundleId || !row.fileId) return;
    setStatus({ tone: "working", message: `${row.displayName} 파일만 다시 올리고 있어요.` });
    try {
      const [success] = await uploadRows(bundleId, [row]);
      await finalizeMaterialBundle(bundleId, crypto.randomUUID());
      setStatus(success
        ? { tone: "success", message: `${row.displayName} 파일을 다시 올렸어요. 검사 결과는 자료 화면에서 확인할 수 있어요.` }
        : { tone: "error", message: `${row.displayName} 파일을 다시 올리지 못했어요.` });
    } catch (error) {
      patchFile(row.clientFileId, { status: "failed", error: callableWriteErrorMessage(error, "자료·기록") });
      setStatus({ tone: "error", message: callableWriteErrorMessage(error, "자료·기록") });
    }
  };

  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0);
  const completed = finalized && Boolean(bundleId);

  return (
    <section className={styles.shell} aria-labelledby="bundle-contribution-title">
      <header className={styles.heading}>
        <div>
          <p>자료 묶음</p>
          <h2 id="bundle-contribution-title">파일부터 한 번에 올려요</h2>
          <span>여러 파일에 제목·공개 범위·공유 권한을 한 번만 입력합니다. 본문은 선택 사항입니다.</span>
        </div>
        <Link className={styles.modeLink} to={sourceModePath}>파일 없이 글·링크 공유</Link>
      </header>

      {(archiveEventId || calendarEventId) && (
        <aside className={styles.eventContext} aria-label="연결할 행사">
          <div><strong>{props.eventLabel || "선택한 행사와 연결"}</strong><span>행사 상세에서 시작한 자료입니다. 등록 전에 연결을 해제할 수 있어요.</span></div>
          <div>{returnTo !== "/resources" && <Link to={returnTo}>행사 확인</Link>}<button type="button" onClick={() => { setArchiveEventId(""); setCalendarEventId(""); setRelationState("none"); }}>행사 연결 없이 올리기</button></div>
        </aside>
      )}

      {!services || !user ? (
        <div className={styles.loginState}>
          <p>{services ? "파일을 고르고 등록하려면 로그인해 주세요." : "자료 묶음 기능을 준비하고 있어요."}</p>
          {services && <div className="community-login-actions"><ProviderLoginButton provider="kakao" onClick={() => startOAuthLogin("kakao", loginReturnTo)} /><ProviderLoginButton provider="naver" onClick={() => startOAuthLogin("naver", loginReturnTo)} />
<ProviderLoginButton provider="google" onClick={() => startOAuthLogin("google", loginReturnTo)} /></div>}
        </div>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <fieldset className={styles.section} disabled={status.tone === "working"}>
            <legend><span>1</span> 파일 선택</legend>
            <label className={`${styles.filePicker} ${draggingFiles ? styles.filePickerDragging : ""}`}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault(); dragDepth.current += 1;
                if (status.tone !== "working" && !bundleId) setDraggingFiles(true);
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = status.tone === "working" || bundleId ? "none" : "copy";
              }}
              onDragLeave={(event) => {
                event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDraggingFiles(false);
              }}
              onDrop={(event) => {
                event.preventDefault(); event.stopPropagation();
                dragDepth.current = 0; setDraggingFiles(false);
                if (status.tone === "working" || bundleId) return;
                if ([...event.dataTransfer.items].some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
                  setSelectionError("폴더 안의 파일을 선택해서 놓아 주세요."); return;
                }
                addFiles(event.dataTransfer.files);
              }}>
              <FilePlus2 size={24} aria-hidden="true" />
              <strong>{bundleId ? "파일 선택 완료" : draggingFiles ? "여기에 파일을 놓아 주세요" : files.length ? "파일 더 추가하거나 끌어 놓기" : "파일 선택하거나 끌어 놓기"}</strong>
              <small>최대 10개 · 파일마다 20MB · 모두 합해 100MB</small>
              <input type="file" multiple disabled={Boolean(bundleId)} aria-label="자료 파일 선택" accept={uploadAccept} onChange={(event) => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
            </label>
            {selectionError && <p className={styles.error} role="alert">{selectionError}</p>}
            {files.length > 0 && <p className={styles.selectionSummary}>{files.length}개 · 총 {formatBytes(totalBytes)}</p>}
            <div className={styles.fileList} role="group" aria-label="선택한 파일">
              {files.map((item, index) => (
                <article className={styles.fileRow} key={item.clientFileId}>
                  <div className={styles.fileOrder} aria-label={`${index + 1}번째 파일`}>{index + 1}</div>
                  <div className={styles.fileCopy}>
                    <label>표시 이름<input value={item.displayName} maxLength={160} onChange={(event) => patchFile(item.clientFileId, { displayName: event.target.value })} /></label>
                    <span title={item.file.name}>{item.file.name} · {formatBytes(item.file.size)}</span>
                    {item.status === "hashing" && <small>파일 확인 중</small>}
                    {item.status === "uploading" && <small>업로드 {item.progress}%</small>}
                    {item.status === "uploaded" && <small className={styles.success}>파일 전송 완료</small>}
                    {item.status === "failed" && <small className={styles.error}>{item.error || "이 파일을 올리지 못했어요."}</small>}
                  </div>
                  <div className={styles.fileActions}>
                    <button type="button" disabled={index === 0 || status.tone === "working"} onClick={() => setFiles((current) => reorderBundleFiles(current, index, index - 1))} aria-label={`${item.displayName} 위로 이동`}><ArrowUp size={17} /></button>
                    <button type="button" disabled={index === files.length - 1 || status.tone === "working"} onClick={() => setFiles((current) => reorderBundleFiles(current, index, index + 1))} aria-label={`${item.displayName} 아래로 이동`}><ArrowDown size={17} /></button>
                    <label className={styles.replaceButton}>교체<input type="file" accept={uploadAccept} onChange={(event) => {
                      const replacement = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (!replacement) return;
                      const others = files.filter((file) => file.clientFileId !== item.clientFileId);
                      const error = bundleSelectionError(others, [replacement]);
                      if (error) return setSelectionError(error);
                      patchFile(item.clientFileId, { file: replacement, displayName: suggestedBundleTitle([replacement]), status: "selected", progress: 0, error: undefined });
                    }} /></label>
                    {(item.status === "failed" || item.status === "selected") && item.fileId && <button type="button" onClick={() => void retryFile(item)} aria-label={`${item.displayName} ${item.status === "selected" ? "교체 파일 올리기" : "다시 시도"}`}><RotateCcw size={17} /></button>}
                    {!bundleId && <button type="button" onClick={() => setFiles((current) => current.filter((file) => file.clientFileId !== item.clientFileId).map((file, order) => ({ ...file, order })))} aria-label={`${item.displayName} 삭제`}><Trash2 size={17} /></button>}
                  </div>
                </article>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.section} disabled={status.tone === "working" || completed}>
            <legend><span>2</span> 공통 정보</legend>
            <div className={styles.fields}>
              <label><span>자료 제목 <FieldRequirement /></span><input required value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
              <label><span>자료 출처 <FieldRequirement optional /></span><input value={source} maxLength={160} onChange={(event) => setSource(event.target.value)} placeholder="예: 서울 청년회" /></label>
              <label><span>권리자 <FieldRequirement /></span><input required value={owner} maxLength={160} onChange={(event) => setOwner(event.target.value)} placeholder="예: 홍길동" /></label>
              <fieldset ref={consentGroup} className={`${styles.sharingBasis} ${styles.wide}`} aria-describedby="bundle-consent-help" aria-invalid={consentError || undefined}>
                <legend>공유 근거 <FieldRequirement /></legend>
                <p id="bundle-consent-help">해당하는 항목을 하나 이상 선택해 주세요</p>
                {['내가 만든 자료예요', '만든 사람에게 공유를 허락받았어요', '단체 담당자로 공유할 권한이 있어요'].map(reason => <label className={styles.confirmation} key={reason}><input type="checkbox" checked={consentReasons.includes(reason)} onChange={event => {
                  const next = event.target.checked ? [...consentReasons, reason] : consentReasons.filter(item => item !== reason);
                  setConsentReasons(next);
                  if (next.length) setConsentError(false);
                }} /><span>{reason}</span></label>)}
                {consentError && <p className={styles.error} role="alert">공유 근거를 하나 이상 선택해 주세요</p>}
              </fieldset>
              <label className={styles.wide}><span>설명 또는 본문 <FieldRequirement optional /></span><textarea value={description} maxLength={5000} rows={7} onChange={(event) => setDescription(event.target.value)} placeholder="파일을 이해하는 데 필요한 설명이 있을 때만 적어 주세요" /></label>
              <label><span>공개 범위 <FieldRequirement /></span><select required value={visibility} onChange={(event) => setVisibility(event.target.value as BundleVisibility)}><option value="" disabled>공개 범위를 선택해 주세요</option><option value="공개">누구나 볼 수 있게 공개</option><option value="회원 전용">위브 로그인 이용자에게 공개</option><option value="보류">나만 보관</option></select></label>
              <label>파일 이용 방법<select value={rights} onChange={(event) => setRights(event.target.value as BundleRights)}><option value="view_only">위브에서 보기만 허용</option><option value="download_allowed">원본 내려받기 허용</option></select></label>
              <label className={`${styles.confirmation} ${styles.wide}`}><input required type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span>공유할 권한이 있으며 개인정보나 공개하면 안 되는 내용이 없는지 확인했어요 <FieldRequirement /></span></label>
            </div>
          </fieldset>

          <div className={styles.submitBar}>
            <div><strong>{bundleId ? "파일별 상태를 확인해 주세요" : `${files.length || 0}개 파일을 한 묶음으로 등록`}</strong><span>검사 대기·차단 파일은 열거나 내려받을 수 없습니다.</span></div>
            {!completed && <button className="button button-primary" type="submit" disabled={status.tone === "working" || files.length === 0}>{status.tone === "working" ? <LoaderCircle className="spin" size={18} /> : <FilePlus2 size={18} />}{status.tone === "working" ? "등록 중" : "자료 등록"}</button>}
          </div>
          {status.tone !== "idle" && <div className={`${styles.status} ${styles[status.tone]}`} role={status.tone === "error" ? "alert" : "status"}>{status.tone === "success" ? <CheckCircle2 size={20} /> : status.tone === "working" ? <LoaderCircle className="spin" size={20} /> : <CircleAlert size={20} />}<span>{status.message}</span></div>}
          {completed && <div className={styles.completionActions}><Link className="button button-primary" to={`/bundles/${encodeURIComponent(bundleId)}`} state={{ returnTo }}>자료 묶음 보기</Link><Link className="button button-secondary" to="/profile?tab=activity">내 자료 관리</Link><Link className="button button-secondary" to={returnTo}>이전 화면으로</Link>{relationState === "failed" && <button type="button" className="button button-secondary" onClick={() => void connectEvent(bundleId)}>행사 연결 다시 시도</button>}</div>}
        </form>
      )}
    </section>
  );
}
