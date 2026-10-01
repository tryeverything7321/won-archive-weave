import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable } from "firebase/storage";
import { CalendarPlus, CheckCircle2, CircleAlert, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { getFirebaseServices, isOAuthConfigured } from "../../lib/firebase/client";
import { callableWriteErrorMessage } from "../../lib/firebase/callable-write-error";
import { startOAuthLogin } from "../auth/api";
import { ProviderLoginButton } from "../auth/ProviderLoginButton";
import { AuthoringFlow } from "../authoring/AuthoringFlow";
import authoringStyles from "../authoring/AuthoringFields.module.css";
import { DraftRecoveryPanel } from "../drafts/DraftRecoveryPanel";
import { InstagramPostAttachment } from "../social/InstagramPostAttachment";
import { SelectedEventImagePreview } from "./CalendarEventMedia";
import { eventMediaItemNotice } from "./event-media-notice";
import styles from "./EventEditor.module.css";
import { useFormDraft } from "../drafts/useFormDraft";
import {
  calendarEditorAttemptIsCurrent,
  calendarEventDraftCodec,
  calendarEventDraftIdentity,
  calendarEventDraftNeedsFileReselection,
  savedCalendarEventDraftRevision,
  type CalendarEventDraftValue,
} from "./event-draft";
import {
  emptyEventEditorValue,
  eventEditorDateInputValue,
  eventImageFileError,
  eventEditorSetAllDayDate,
  eventEditorSubmissionFields,
  eventEditorToggleAllDay,
  eventEditorVisibilityIsReady,
  maxEventGalleryImages,
  sanitizeEventImageName,
  validateEventEditorValue,
  type EventEditorValue,
  type EventFileSelection,
  type EventMediaUpload,
} from "./event-editor-model";

type EventEditorProps = {
  eventId?: string;
  draftId?: string;
  returnTo?: string;
  initialValue?: EventEditorValue & { mediaUploads?: EventMediaUpload[]; status?: string; reviewReason?: string };
  onSaved?: (result: { eventId: string; status: "review_queued" | "published" | "updated" | "canceled" }) => void;
  onCancel?: () => void;
};

type EditorStatus = { tone: "idle" | "working" | "success" | "error"; message: string };
type PhotoError = { target: "thumbnail" | "gallery"; message: string };
const eventFlowSteps = [
  { id: "event-core", label: "기본 정보", description: "이름·일시·장소" },
  { id: "event-media", label: "소개·사진", description: "필요한 정보 보강" },
  { id: "event-visibility", label: "공개 확인", description: "대상 확인 후 등록" },
] as const;

function newEventId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `event-${crypto.randomUUID()}`;
  return `event-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function newSelection(role: "thumbnail" | "gallery", file: File): EventFileSelection {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${file.name}`,
    role,
    file,
    alt: "",
  };
}

function initialEditorValue(initialValue: EventEditorProps["initialValue"]): EventEditorValue {
  if (!initialValue) return emptyEventEditorValue();
  return {
    title: initialValue.title,
    summary: initialValue.summary,
    description: initialValue.description,
    startAt: initialValue.startAt,
    endAt: initialValue.endAt,
    allDay: initialValue.allDay,
    timeZone: initialValue.timeZone,
    region: initialValue.region,
    organizerName: initialValue.organizerName,
    locationName: initialValue.locationName,
    address: initialValue.address,
    onlineUrl: initialValue.onlineUrl,
    registrationUrl: initialValue.registrationUrl,
    registrationDeadline: initialValue.registrationDeadline,
    registrationStatus: initialValue.registrationStatus,
    visibility: initialValue.visibility,
    sourceUrl: initialValue.sourceUrl,
    instagramPosts: initialValue.instagramPosts ?? [],
  };
}

export function EventEditor({ eventId, draftId, returnTo = "/calendar/new", initialValue, onSaved, onCancel }: EventEditorProps) {
  const services = useMemo(() => getFirebaseServices(), []);
  const [user, setUser] = useState<User | null>(() => services?.auth.currentUser ?? null);
  const [stableEventId] = useState(() => eventId ?? draftId ?? newEventId());
  const [value, setValue] = useState<EventEditorValue>(() => initialEditorValue(initialValue));
  const [existingUploads, setExistingUploads] = useState<EventMediaUpload[]>(() => initialValue?.mediaUploads ?? []);
  const [files, setFiles] = useState<EventFileSelection[]>([]);
  const [visibilitySelected, setVisibilitySelected] = useState(Boolean(eventId));
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<EditorStatus>({ tone: "idle", message: "" });
  const [photoError, setPhotoError] = useState<PhotoError | null>(null);
  const previousUid = useRef(user?.uid ?? null);
  const operationGeneration = useRef(0);

  const initialDraftValue = useCallback((): CalendarEventDraftValue => ({
    ...initialEditorValue(initialValue),
    visibilitySelected: Boolean(eventId),
    existingUploads: initialValue?.mediaUploads ?? [],
  }), [eventId, initialValue]);

  const invalidateOperation = useCallback(() => {
    operationGeneration.current += 1;
    setStatus((current) => current.tone === "working" ? { tone: "idle", message: "" } : current);
  }, []);

  const draftValue = useMemo<CalendarEventDraftValue>(
    () => ({ ...value, visibilitySelected, existingUploads }),
    [existingUploads, value, visibilitySelected],
  );

  const restoreDraft = useCallback((restored: CalendarEventDraftValue) => {
    const { existingUploads: restoredUploads, visibilitySelected: restoredVisibilitySelected, ...restoredValue } = restored;
    operationGeneration.current += 1;
    setValue(restoredValue);
    setExistingUploads(restoredUploads);
    setVisibilitySelected(Boolean(eventId) || restoredVisibilitySelected);
    setFiles([]);
    setProgress(0);
    setStatus({ tone: "idle", message: "" });
    setPhotoError(null);
  }, [eventId]);

  const eventDraft = useFormDraft({
    identity: calendarEventDraftIdentity(user?.uid ?? "signed-out", eventId, draftId ?? stableEventId),
    value: draftValue,
    codec: calendarEventDraftCodec,
    onRestore: restoreDraft,
    fileReselectionRequired: calendarEventDraftNeedsFileReselection(files.length > 0),
    active: Boolean(user),
  });

  useEffect(() => {
    if (!services) return undefined;
    return onAuthStateChanged(services.auth, (nextUser) => {
      const nextUid = nextUser?.uid ?? null;
      if (previousUid.current !== nextUid) {
        operationGeneration.current += 1;
        const baseline = initialDraftValue();
        const { existingUploads: baselineUploads, visibilitySelected: baselineVisibilitySelected, ...baselineValue } = baseline;
        setValue(baselineValue);
        setExistingUploads(baselineUploads);
        setVisibilitySelected(baselineVisibilitySelected);
        setFiles([]);
        setProgress(0);
        setStatus({ tone: "idle", message: "" });
        setPhotoError(null);
        previousUid.current = nextUid;
      }
      setUser(nextUser);
    });
  }, [initialDraftValue, services]);

  useEffect(() => () => { operationGeneration.current += 1; }, []);

  const set = <K extends keyof EventEditorValue>(key: K, next: EventEditorValue[K]) => {
    invalidateOperation();
    setValue((current) => ({ ...current, [key]: next }));
  };

  const chooseThumbnail = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    const error = eventImageFileError(file);
    if (error) return setPhotoError({ target: "thumbnail", message: error });
    setPhotoError(null);
    invalidateOperation();
    setExistingUploads((current) => current.filter((item) => item.role !== "thumbnail"));
    setFiles((current) => [...current.filter((item) => item.role !== "thumbnail"), newSelection("thumbnail", file)]);
  };

  const chooseGallery = (list: FileList | null) => {
    const incoming = [...(list ?? [])];
    const currentGalleryCount = existingUploads.filter((item) => item.role === "gallery").length
      + files.filter((item) => item.role === "gallery").length;
    if (currentGalleryCount + incoming.length > maxEventGalleryImages) {
      return setPhotoError({ target: "gallery", message: "추가 사진은 여덟 장까지 올릴 수 있어요." });
    }
    const error = incoming.map(eventImageFileError).find(Boolean);
    if (error) return setPhotoError({ target: "gallery", message: error });
    setPhotoError(null);
    invalidateOperation();
    setFiles((current) => [...current, ...incoming.map((file) => newSelection("gallery", file))]);
  };

  const uploadSelection = async (selection: EventFileSelection, uid: string): Promise<EventMediaUpload> => {
    if (!services) throw new Error("Firebase is not configured");
    const safeName = sanitizeEventImageName(selection.file.name);
    const storagePath = `quarantined/${uid}/calendar-events/${stableEventId}/${selection.role}-${selection.id}-${safeName}`;
    const upload = uploadBytesResumable(ref(services.storage, storagePath), selection.file, {
      contentType: selection.file.type,
      customMetadata: {
        ownerUid: uid,
        eventId: stableEventId,
        role: selection.role,
        alt: selection.alt.trim(),
        originalName: safeName,
      },
    });
    await new Promise<void>((resolve, reject) => upload.on("state_changed", undefined, reject, resolve));
    return {
      role: selection.role,
      storagePath,
      fileName: safeName,
      contentType: selection.file.type as EventMediaUpload["contentType"],
      size: selection.file.size,
      alt: selection.alt.trim(),
      displayMode: selection.displayMode ?? "contain",
    };
  };

  const submit = async (formEvent: React.FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!services || !user) return setStatus({ tone: "error", message: "행사를 등록하려면 먼저 로그인해 주세요." });
    if (!eventEditorVisibilityIsReady(Boolean(eventId), visibilitySelected)) {
      return setStatus({ tone: "error", message: "행사를 공개할 대상을 선택해 주세요." });
    }
    const valueError = validateEventEditorValue(value);
    if (valueError) return setStatus({ tone: "error", message: valueError });
    if (files.some((item) => item.alt.trim().length < 2)) {
      return setStatus({ tone: "error", message: "선택한 사진마다 내용을 설명하는 글을 적어 주세요." });
    }
    const submittedValue = value;
    const submittedUploads = existingUploads;
    const submittedFiles = files;
    const capturedDraftRevision = savedCalendarEventDraftRevision(eventDraft.capture({
      ...submittedValue,
      visibilitySelected,
      existingUploads: submittedUploads,
    }));
    const attempt = { generation: ++operationGeneration.current, uid: user.uid };
    const attemptIsCurrent = () => calendarEditorAttemptIsCurrent(
      attempt,
      operationGeneration.current,
      services.auth.currentUser?.uid,
    );
    setStatus({ tone: "working", message: submittedFiles.length ? "사진을 안전하게 올리고 있어요." : "행사 내용을 저장하고 있어요." });
    setProgress(0);
    try {
      const uploaded: EventMediaUpload[] = [];
      for (const [index, selection] of submittedFiles.entries()) {
        uploaded.push(await uploadSelection(selection, user.uid));
        if (!attemptIsCurrent()) return;
        setProgress(Math.round(((index + 1) / Math.max(submittedFiles.length, 1)) * 100));
      }
      const callable = httpsCallable<unknown, { eventId: string; status: "review_queued" | "published" | "updated" | "canceled" }>(
        services.functions,
        eventId ? "updateManualEvent" : "createManualEvent",
      );
      const result = await callable({
        ...submittedValue,
        ...eventEditorSubmissionFields(submittedValue),
        eventId: stableEventId,
        mediaUploads: [...submittedUploads, ...uploaded],
      });
      if (!attemptIsCurrent()) return;
      if (capturedDraftRevision) eventDraft.complete(capturedDraftRevision, {
        ...submittedValue,
        visibilitySelected,
        existingUploads: [...submittedUploads, ...uploaded],
      });
      setExistingUploads([...submittedUploads, ...uploaded]);
      setFiles([]);
      setProgress(100);
      const message = result.data.status === "review_queued"
        ? "행사 내용을 공개했어요. 사진은 파일 보안 검사가 끝나면 자동으로 추가됩니다."
        : "행사를 저장하고 일정에 반영했어요.";
      setStatus({ tone: "success", message });
      onSaved?.(result.data);
    } catch (error) {
      if (!attemptIsCurrent()) return;
      setStatus({ tone: "error", message: callableWriteErrorMessage(error, "행사") });
    }
  };

  const mediaRows = [
    ...existingUploads.map((item) => ({ id: item.storagePath, role: item.role, name: item.fileName, alt: item.alt, existing: true, file: undefined as File | undefined, displayMode: item.displayMode ?? "contain" })),
    ...files.map((item) => ({ id: item.id, role: item.role, name: item.file.name, alt: item.alt, existing: false, file: item.file, displayMode: item.displayMode ?? "contain" })),
  ];
  const selectedThumbnail = mediaRows.find((row) => row.role === "thumbnail");
  const selectedGalleryCount = mediaRows.filter((row) => row.role === "gallery").length;

  return (
    <section className="event-editor" aria-labelledby="event-editor-title">
      <header className={`event-editor-heading ${authoringStyles.eventHeading}`}>
        <span className="section-kicker"><CalendarPlus size={18} /> 행사 등록</span>
        <h2 id="event-editor-title">{eventId ? "행사 내용을 다듬어요" : "새로운 만남을 일정에 더해요"}</h2>
        <p>이름과 주최, 지역을 적고 일시·장소를 이어서 입력해 주세요. 소개와 사진은 필요할 때 더할 수 있어요.</p>
      </header>

      {!services || !user ? (
        <div className="event-editor-state" role="status">
          <CircleAlert size={20} />
          <p>{services ? "행사를 등록하려면 먼저 로그인해 주세요." : "행사 등록 기능을 준비하고 있어요."}</p>
          {services && (
            <div className="community-login-actions" aria-label="행사 등록 로그인">
              <ProviderLoginButton
                disabled={!isOAuthConfigured}
                provider="kakao"
                onClick={() => startOAuthLogin("kakao", returnTo)}
              />
              <ProviderLoginButton
                disabled={!isOAuthConfigured}
                provider="naver"
                onClick={() => startOAuthLogin("naver", returnTo)}
              />
            </div>
          )}
          {services && !isOAuthConfigured && <small>로그인 연결을 준비하고 있어요.</small>}
        </div>
      ) : (
        <form className="event-editor-form" onSubmit={submit}>
          <DraftRecoveryPanel
            state={eventDraft.state}
            recovery={eventDraft.recovery}
            onContinue={eventDraft.continueDraft}
            onStartNew={() => {
              const baseline = initialDraftValue();
              eventDraft.startNew(baseline);
              restoreDraft(baseline);
            }}
            onDelete={() => {
              const baseline = initialDraftValue();
              eventDraft.deleteDraft(baseline);
              restoreDraft(baseline);
            }}
            onRetry={eventDraft.retry}
          />
          <AuthoringFlow label="행사 등록 순서" steps={eventFlowSteps} />
          <div className={authoringStyles.eventCore} id="event-core">
            <fieldset className="event-editor-step">
              <legend><span>1</span> 어떤 행사인지 알려 주세요</legend>
              <label className="field-wide">행사 이름 (필수)<input required value={value.title} onChange={(event) => set("title", event.target.value)} maxLength={120} /></label>
              <label>주최 (필수)<input required value={value.organizerName} onChange={(event) => set("organizerName", event.target.value)} maxLength={80} /></label>
              <label>지역 (필수)<input required value={value.region} onChange={(event) => set("region", event.target.value)} maxLength={40} /></label>
            </fieldset>

            <fieldset className="event-editor-step">
              <legend><span>2</span> 언제 어디에서 만나는지 적어 주세요</legend>
              <label>{value.allDay ? "시작일" : "시작"} (필수)<input required type={value.allDay ? "date" : "datetime-local"} value={eventEditorDateInputValue(value.startAt, value.allDay)} onChange={(event) => set("startAt", value.allDay ? eventEditorSetAllDayDate(value.startAt, event.target.value) : event.target.value)} /></label>
              <label>{value.allDay ? "종료일 (이 날까지 포함)" : "종료"} (필수)<input required type={value.allDay ? "date" : "datetime-local"} value={eventEditorDateInputValue(value.endAt, value.allDay)} onChange={(event) => set("endAt", value.allDay ? eventEditorSetAllDayDate(value.endAt, event.target.value) : event.target.value)} /></label>
              <label className="event-check field-wide"><input type="checkbox" checked={value.allDay} onChange={(event) => {
                invalidateOperation();
                setValue((current) => eventEditorToggleAllDay(current, event.target.checked));
              }} /> 하루 종일 이어지는 행사예요</label>
              <label>장소 이름 <small>온라인 행사라면 비워도 돼요</small><input value={value.locationName} onChange={(event) => set("locationName", event.target.value)} maxLength={160} /></label>
              <label>주소<input value={value.address} onChange={(event) => set("address", event.target.value)} maxLength={240} /></label>
              <label className="field-wide">온라인 참여 링크 <small>오프라인 행사라면 비워도 돼요</small><input type="url" value={value.onlineUrl} onChange={(event) => set("onlineUrl", event.target.value)} placeholder="https://" /></label>
              <p className="field-wide event-review-note">장소 이름과 온라인 참여 링크 중 하나는 꼭 입력해 주세요.</p>
            </fieldset>
          </div>

          <fieldset className="event-editor-step" id="event-media">
            <legend><span>3</span> 행사 소개를 더해 주세요 <small>선택 사항</small></legend>
            <label className="field-wide">한 줄 소개 <small>비워 두어도 행사 이름과 일정은 표시돼요</small><input value={value.summary} onChange={(event) => set("summary", event.target.value)} maxLength={240} /></label>
            <label className={`field-wide ${authoringStyles.eventDescription}`}>자세한 안내<textarea value={value.description} onChange={(event) => set("description", event.target.value)} maxLength={5000} rows={9} /></label>
            <p className="field-wide event-review-note" id="event-photo-policy">사진은 선택 사항 · JPG·PNG·WEBP · 한 장당 최대 10MB</p>
            <label className="event-file-picker field-wide">
              <ImagePlus size={20} aria-hidden="true" />
              <span>{selectedThumbnail ? "대표 사진 변경" : "대표 사진 선택"}</span>
              <small>{selectedThumbnail ? `선택됨: ${selectedThumbnail.name}` : "포스터 한 장만 올려도 돼요"}</small>
              <input type="file" aria-describedby={`event-photo-policy${photoError?.target === "thumbnail" ? " event-photo-error" : ""}`} aria-invalid={photoError?.target === "thumbnail" || undefined} accept="image/jpeg,image/png,image/webp" onChange={(event) => { chooseThumbnail(event.currentTarget.files); event.currentTarget.value = ""; }} />
            </label>
              {photoError && <p className="event-photo-error field-wide" id="event-photo-error" role="alert">{photoError.message}</p>}
              {mediaRows.length > 0 && (
                <div className="event-media-list field-wide" aria-label="선택한 행사 사진">
                  {mediaRows.map((row) => (
                    <div className={`event-media-row ${styles.mediaRow}`} key={row.id}>
                      {row.file ? <div className={styles.preview}><SelectedEventImagePreview file={row.file} displayMode={row.displayMode} /></div> : <div className={styles.savedPreview}><ImagePlus size={22} aria-hidden="true" /><em>저장된 사진</em></div>}
                      <div className={styles.identity}><span>{row.role === "thumbnail" ? "대표" : "추가"}</span><b>{row.name}</b></div>
                      <small className={styles.state}>{row.existing ? eventMediaItemNotice(initialValue ?? {}) : "아직 업로드하지 않음"}</small>
                      <label className={styles.displayControl}><span>사진 표시</span><select value={row.displayMode} onChange={event => {
                        invalidateOperation();
                        const displayMode = event.target.value === "cover" ? "cover" : "contain";
                        if (row.existing) setExistingUploads(current => current.map(item => item.storagePath === row.id ? { ...item, displayMode } : item));
                        else setFiles(current => current.map(item => item.id === row.id ? { ...item, displayMode } : item));
                      }}><option value="contain">전체 보기 (포스터 권장)</option><option value="cover">화면 채우기 (일부 잘림)</option></select></label>
                      {row.existing ? <small className={styles.description}>{row.alt}</small> : (
                        <input
                          className={styles.description}
                          aria-label={`${row.name} 사진 설명 (필수)`}
                          required
                          placeholder="사진 설명 (필수)"
                          value={row.alt}
                          onChange={(event) => {
                            invalidateOperation();
                            setFiles((current) => current.map((item) => item.id === row.id ? { ...item, alt: event.target.value } : item));
                          }}
                          maxLength={180}
                        />
                      )}
                      <button
                        type="button"
                        className={`icon-button ${styles.remove}`}
                        aria-label={`${row.name} 제거`}
                        onClick={() => {
                          invalidateOperation();
                          if (row.existing) setExistingUploads((current) => current.filter((item) => item.storagePath !== row.id));
                          else setFiles((current) => current.filter((item) => item.id !== row.id));
                          setPhotoError(null);
                        }}
                      ><Trash2 size={17} /></button>
                    </div>
                  ))}
                </div>
              )}
          </fieldset>

          <details className="event-editor-more">
            <summary>추가 사진·신청·홍보 링크 <small>필요할 때만</small></summary>
            <fieldset className="event-editor-step">
              <legend>추가 설정</legend>
              <label className="event-file-picker field-wide">
                <ImagePlus size={20} aria-hidden="true" />
                <span>추가 사진 선택</span>
                <small>{selectedGalleryCount > 0 ? `${selectedGalleryCount}장 선택됨 · 최대 8장` : "필요한 경우 최대 8장"}</small>
                <input type="file" multiple aria-describedby={`event-photo-policy${photoError?.target === "gallery" ? " event-photo-error" : ""}`} aria-invalid={photoError?.target === "gallery" || undefined} accept="image/jpeg,image/png,image/webp" onChange={(event) => { chooseGallery(event.currentTarget.files); event.currentTarget.value = ""; }} />
              </label>
              <label>신청 상태<select value={value.registrationStatus} onChange={(event) => set("registrationStatus", event.target.value as EventEditorValue["registrationStatus"])}>
                <option value="open">신청 가능</option><option value="closing_soon">곧 마감</option><option value="closed">신청 마감</option><option value="not_required">신청 없음</option>
              </select></label>
              {value.registrationStatus !== "not_required" && <>
                <label>신청 마감<input type="datetime-local" value={value.registrationDeadline} onChange={(event) => set("registrationDeadline", event.target.value)} /></label>
                <label className="field-wide">신청 링크<input type="url" value={value.registrationUrl} onChange={(event) => set("registrationUrl", event.target.value)} placeholder="https://" /></label>
              </>}
              <label>원문 또는 안내 링크<input type="url" value={value.sourceUrl} onChange={(event) => set("sourceUrl", event.target.value)} placeholder="https://" /></label>
            </fieldset>
            <InstagramPostAttachment value={value.instagramPosts} onChange={next => set("instagramPosts", next)} />
          </details>

          <fieldset className="event-editor-step event-editor-step-visibility" id="event-visibility">
            <legend><span>4</span> 공개 범위를 확인해 주세요</legend>
            <label className="field-wide">공개 범위 (필수)
              <select
                required
                value={visibilitySelected ? value.visibility : ""}
                onChange={(event) => {
                  invalidateOperation();
                  setValue((current) => ({ ...current, visibility: event.target.value as EventEditorValue["visibility"] }));
                  setVisibilitySelected(true);
                }}
              >
                <option value="" disabled>공개 범위를 선택해 주세요</option>
                <option value="public">누구나 볼 수 있게 공개</option>
                <option value="member_only">위브 로그인 이용자에게 공개</option>
              </select>
            </label>
            <p className="field-wide event-review-note">행사는 바로 공개됩니다. 사진은 파일 보안 검사를 마친 뒤 표시돼요.</p>
          </fieldset>

          {status.message && <div className={`event-editor-message ${status.tone} ${authoringStyles.statusBar}`} role="status">
            {status.tone === "working" ? <LoaderCircle className="spin" size={18} /> : status.tone === "success" ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
            <span>{status.message}</span>
          </div>}
          {status.tone === "working" && files.length > 0 && <progress value={progress} max={100}>{progress}%</progress>}
          <div className="event-editor-actions">
            {onCancel && <button type="button" className="button button-secondary" onClick={onCancel}>돌아가기</button>}
            <button type="submit" className="button button-primary" disabled={status.tone === "working"}>
              {eventId ? "수정 내용 저장하기" : "행사 등록하기"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
