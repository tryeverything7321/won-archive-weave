import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  FileText,
  FileUp,
  LoaderCircle,
  Link2,
  LogIn,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable } from "firebase/storage";
import { topics, type Topic } from "../../content";
import { InstagramGlyph } from "../../components/InstagramGlyph";
import { getFirebaseServices } from "../../lib/firebase/client";
import { callableWriteErrorMessage } from "../../lib/firebase/callable-write-error";
import { startOAuthLogin } from "../auth/api";
import { ProviderLoginButton } from "../auth/ProviderLoginButton";
import { AuthoringFlow } from "../authoring/AuthoringFlow";
import { contributionIntentHref, type NewContributionKind } from "../authoring/authoring-intent";
import { DraftRecoveryPanel } from "../drafts/DraftRecoveryPanel";
import { useFormDraft } from "../drafts/useFormDraft";
import { InstagramPostAttachment } from "../social/InstagramPostAttachment";
import { readInstagramAttachments, type InstagramPostAttachmentValue } from "../social/instagram-url";
import { getMySubmissionDraft, updateSubmissionDraft } from "./api";
import styles from "./ContributionForm.module.css";
import {
  contributionKindOptions,
  contributionReturnTo,
  readContributionEntry,
  type ContributionKind,
} from "./contribution-entry";
import {
  beginContributionSession,
  contributionAttemptIsCurrent,
  contributionCreationNeedsDraftUpdate,
  contributionDraftFingerprint,
  contributionDraftMatches,
  contributionUploadDecision,
  contributionUploadSelectionFingerprint,
  contributionSuccessMessage,
  contributionSuccessPath,
  createContributionSession,
  markContributionPublished,
  reserveContributionCreation,
  reserveContributionUploads,
  resetContributionSession,
  restoreContributionCreation,
  retryContributionSession,
  type ContributionSession,
} from "./contribution-session";
import {
  consumeFileSelection,
  redistributionForSourceSelection,
  sourceModeOptions,
  type SourceMode,
} from "./contribution-source";
import { isHangulDocumentFile, uploadAccept, uploadContentType, uploadFileError } from "./file-policy";
import { TextComposer } from '../content/TextComposer';
import {
  contributionDraftCodec,
  contributionDraftActive,
  contributionDraftFileReselection,
  contributionDraftFields,
  contributionDraftIdentity,
  contributionSubmissionPayload,
  emptyContributionDraftValue,
  savedContributionDraftRevision,
  type ContributionCreateReservation,
  type ContributionDraftValue,
} from "./contribution-draft";

const kindLabels: Record<ContributionKind, string> = {
  "활동 기록": "활동 기록",
  "자료": "자료 나눔",
  "활동 레시피": "활동 운영 노하우",
};
const kindDescriptions: Record<ContributionKind, string> = {
  "활동 기록": "어떤 활동을 했고 무엇이 남았는지 나눠요.",
  "자료": "다른 사람이 읽거나 활용할 내용을 나눠요.",
  "활동 레시피": "기존에 작성한 활동 운영 노하우를 수정해요.",
};
const consentOptions = [
  "내가 만든 자료예요",
  "단체 담당자로 올려요",
  "만든 사람에게 허락받았어요",
] as const;
const contributionFlowSteps = [
  { id: "contribution-content", label: "내용 작성", description: "제목과 본문" },
  { id: "contribution-source", label: "파일·링크", description: "필요한 원문 연결" },
  { id: "contribution-rights", label: "공개·권리", description: "대상과 권한 확인" },
] as const;
type Visibility = "공개" | "회원 전용" | "보류";
type VisibilitySelection = Visibility | null;

type Status = {
  tone: "idle" | "working" | "success" | "error";
  message: string;
};

const contributionTextareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 112,
  resize: "vertical",
  border: "1px solid #c2dce8",
  borderRadius: 12,
  background: "#fff",
  padding: 13,
  color: "#18384b",
  font: "inherit",
  lineHeight: 1.65,
  wordBreak: "keep-all",
  overflowWrap: "normal",
};

export function ContributionForm() {
  const location = useLocation();
  const entry = readContributionEntry(location.search);
  return <ContributionFormSession key={JSON.stringify(entry)} entry={entry} />;
}

function ContributionFormSession({ entry }: { entry: ReturnType<typeof readContributionEntry> }) {
  const navigate = useNavigate();
  const services = useMemo(() => getFirebaseServices(), []);
  const editingSubmissionId = entry.submissionId;
  const [user, setUser] = useState<User | null>(
    () => services?.auth.currentUser ?? null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewFileInput = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("text");
  const [body, setBody] = useState('');
  const previousUid = useRef(user?.uid);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const attemptRevision = useRef(0);
  const initialCreatePayload = useRef<{
    requestId: string;
    submission: Record<string, unknown>;
  } | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [sourceLinkUrl, setSourceLinkUrl] = useState("");
  const [instagramAttachments, setInstagramAttachments] = useState<InstagramPostAttachmentValue[]>([]);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [kind, setKind] = useState<ContributionKind>(entry.initialKind);
  const [activityTopic, setActivityTopic] = useState<Topic>(topics[0]);
  const [activityType, setActivityType] = useState("");
  const [activityDate, setActivityDate] = useState("");
  const [activityPlace, setActivityPlace] = useState("");
  const [activitySummary, setActivitySummary] = useState("");
  const [activityStory, setActivityStory] = useState("");
  const [activityOutcome, setActivityOutcome] = useState("");
  const [activityNextAction, setActivityNextAction] = useState("");
  const [recipePurpose, setRecipePurpose] = useState("");
  const [recipePreparation, setRecipePreparation] = useState("");
  const [recipePromotion, setRecipePromotion] = useState("");
  const [recipeLessons, setRecipeLessons] = useState("");
  const [visibility, setVisibility] = useState<VisibilitySelection>(null);
  const [visibilityExplicit, setVisibilityExplicit] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [attribution, setAttribution] = useState("");
  const [consentBasis, setConsentBasis] = useState<(typeof consentOptions)[number]>(consentOptions[0]);
  const [redistribution, setRedistribution] = useState<
    "download_allowed" | "view_only" | "source_link_only"
  >("view_only");
  const [sensitiveDataReviewed, setSensitiveDataReviewed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<Status>({ tone: "idle", message: "" });
  const [editLoad, setEditLoad] = useState<"loading" | "ready" | "error">(
    editingSubmissionId ? "loading" : "ready",
  );
  const [editLoadMessage, setEditLoadMessage] = useState("");
  const [existingFileCount, setExistingFileCount] = useState(0);
  const [submissionSession, setSubmissionSession] = useState<ContributionSession>(
    () => createContributionSession(editingSubmissionId),
  );
  const [draftCreateReservation, setDraftCreateReservation] = useState<ContributionCreateReservation | null>(null);
  const hasActivityDetails = kind === "활동 기록" || kind === "활동 레시피";
  const hasRecipeDetails = kind === "활동 레시피";
  const selectedSource = sourceModeOptions.find(({ value }) => value === sourceMode) ?? sourceModeOptions[0];
  const selectedSourceDescription = selectedSource.value === "text"
    ? "추가 자료를 연결하지 않고 위에서 작성한 본문만 게시해요."
    : selectedSource.description;
  const availableKinds = contributionKindOptions(editingSubmissionId, kind);
  const successPath = contributionSuccessPath(kind, submissionSession);
  const contributionDraftValue = useMemo<ContributionDraftValue>(() => ({
    sourceMode,
    body,
    sourceLinkUrl,
    instagramAttachments,
    title,
    source,
    owner,
    kind,
    activityTopic,
    activityType,
    activityDate,
    activityPlace,
    activitySummary,
    activityStory,
    activityOutcome,
    activityNextAction,
    recipePurpose,
    recipePreparation,
    recipePromotion,
    recipeLessons,
    visibility,
    visibilityExplicit,
    consentConfirmed,
    attribution,
    consentBasis,
    redistribution,
    sensitiveDataReviewed,
    ...(draftCreateReservation ? { createReservation: draftCreateReservation } : {}),
  }), [
    activityDate,
    activityNextAction,
    activityOutcome,
    activityPlace,
    activityStory,
    activitySummary,
    activityTopic,
    activityType,
    attribution,
    body,
    consentBasis,
    consentConfirmed,
    draftCreateReservation,
    instagramAttachments,
    kind,
    owner,
    recipeLessons,
    recipePreparation,
    recipePromotion,
    recipePurpose,
    redistribution,
    sensitiveDataReviewed,
    source,
    sourceLinkUrl,
    sourceMode,
    title,
    visibility,
    visibilityExplicit,
  ]);

  const restoreContributionDraft = useCallback((draft: ContributionDraftValue) => {
    setSourceMode(draft.sourceMode);
    setBody(draft.body);
    setSourceLinkUrl(draft.sourceLinkUrl);
    setInstagramAttachments(draft.instagramAttachments);
    setTitle(draft.title);
    setSource(draft.source);
    setOwner(draft.owner);
    setKind(editingSubmissionId ? draft.kind : entry.initialKind);
    setActivityTopic(topics.includes(draft.activityTopic as Topic) ? draft.activityTopic as Topic : topics[0]);
    setActivityType(draft.activityType);
    setActivityDate(draft.activityDate);
    setActivityPlace(draft.activityPlace);
    setActivitySummary(draft.activitySummary);
    setActivityStory(draft.activityStory);
    setActivityOutcome(draft.activityOutcome);
    setActivityNextAction(draft.activityNextAction);
    setRecipePurpose(draft.recipePurpose);
    setRecipePreparation(draft.recipePreparation);
    setRecipePromotion(draft.recipePromotion);
    setRecipeLessons(draft.recipeLessons);
    setVisibility(draft.visibilityExplicit ? draft.visibility : null);
    setVisibilityExplicit(draft.visibilityExplicit);
    setConsentConfirmed(draft.consentConfirmed);
    setAttribution(draft.attribution);
    setConsentBasis(draft.consentBasis);
    setRedistribution(draft.redistribution);
    setSensitiveDataReviewed(draft.sensitiveDataReviewed);
    setDraftCreateReservation(draft.createReservation ?? null);
    setFile(null);
    setPreviewFile(null);
    setComposerKey((current) => current + 1);
  }, [editingSubmissionId, entry.initialKind]);

  const contributionDraft = useFormDraft({
    identity: contributionDraftIdentity(user?.uid ?? "signed-out", entry.initialKind, editingSubmissionId),
    value: contributionDraftValue,
    codec: contributionDraftCodec,
    onRestore: restoreContributionDraft,
    fileReselectionRequired: contributionDraftFileReselection(sourceMode, Boolean(file || previewFile)),
    active: contributionDraftActive(Boolean(user), Boolean(editingSubmissionId), editLoad),
  });

  const resetForm = useCallback((nextOwner = "") => {
    attemptRevision.current += 1;
    initialCreatePayload.current = null;
    setBody("");
    setTitle("");
    setOwner(nextOwner);
    setSource("");
    setFile(null);
    setPreviewFile(null);
    setSourceMode("text");
    setSourceLinkUrl("");
    setInstagramAttachments([]);
    setKind(entry.initialKind);
    setActivityTopic(topics[0]);
    setActivityType("");
    setActivityDate("");
    setActivityPlace("");
    setActivityStory("");
    setActivitySummary("");
    setActivityOutcome("");
    setActivityNextAction("");
    setRecipePurpose("");
    setRecipePreparation("");
    setRecipePromotion("");
    setRecipeLessons("");
    setVisibility(null);
    setVisibilityExplicit(false);
    setConsentConfirmed(false);
    setAttribution("");
    setConsentBasis(consentOptions[0]);
    setRedistribution("view_only");
    setSensitiveDataReviewed(false);
    setDraftCreateReservation(null);
    setProgress(0);
    setStatus({ tone: "idle", message: "" });
    setEditLoad(editingSubmissionId ? "loading" : "ready");
    setEditLoadMessage("");
    setExistingFileCount(0);
    setSubmissionSession(resetContributionSession());
    setComposerKey((current) => current + 1);
  }, [editingSubmissionId, entry.initialKind]);

  const startNewContribution = useCallback(() => {
    const nextOwner = user?.displayName?.trim() ?? "";
    if (contributionDraft.startNew(emptyContributionDraftValue(nextOwner, entry.initialKind, topics[0]))) {
      resetForm(nextOwner);
    }
  }, [contributionDraft, entry.initialKind, resetForm, user]);

  const selectSourceMode = (nextMode: SourceMode) => {
    setSourceMode(nextMode);
    setRedistribution((current) => redistributionForSourceSelection(
      Boolean(editingSubmissionId),
      nextMode,
      current,
    ));
    if (nextMode !== "upload") {
      setFile(null);
      setPreviewFile(null);
    }
    if (nextMode !== "google_drive_link") setSourceLinkUrl("");
    if (nextMode !== "instagram_url") setInstagramAttachments([]);
  };

  const selectContributionKind = (nextKind: ContributionKind) => {
    if (editingSubmissionId || nextKind === entry.initialKind || nextKind === "활동 레시피") return;
    contributionDraft.flush();
    navigate(contributionIntentHref(nextKind as NewContributionKind));
  };

  useEffect(() => {
    if (!services) return undefined;
    return onAuthStateChanged(services.auth, (nextUser) => {
      if (previousUid.current !== nextUser?.uid) {
        resetForm(nextUser?.displayName?.trim() ?? "");
      }
      previousUid.current = nextUser?.uid;
      setUser(nextUser);
      const displayName = nextUser?.displayName?.trim();
      if (displayName) setOwner((current) => current || displayName);
    });
  }, [resetForm, services]);

  useEffect(() => {
    if (!editingSubmissionId || !user) return undefined;
    let active = true;
    void getMySubmissionDraft(editingSubmissionId)
      .then((draft) => {
        if (!active) return;
        setSourceMode(draft.sourceMode);
        setBody(draft.textContent?.body ?? '');
        setTitle(draft.title);
        setSource(draft.source);
        setOwner(draft.owner);
        setKind(draft.kind);
        setVisibility(draft.visibility);
        setVisibilityExplicit(true);
        setAttribution(draft.attribution);
        setConsentBasis(
          consentOptions.includes(draft.consentBasis as (typeof consentOptions)[number])
            ? draft.consentBasis as (typeof consentOptions)[number]
            : consentOptions[0],
        );
        setRedistribution(draft.redistribution);
        setConsentConfirmed(draft.consentConfirmed);
        setSensitiveDataReviewed(draft.sensitiveDataReviewed);
        setSourceLinkUrl(draft.sourceLinkUrl ?? "");
        setInstagramAttachments(readInstagramAttachments(draft.instagramAttachments));
        setExistingFileCount(draft.existingFileCount);
        const activity = draft.activity;
        if (activity) {
          if (typeof activity.topic === "string" && topics.includes(activity.topic as Topic)) setActivityTopic(activity.topic as Topic);
          setActivityType(typeof activity.type === "string" ? activity.type : "");
          setActivityDate(typeof activity.date === "string" ? activity.date : "");
          setActivityPlace(typeof activity.place === "string" ? activity.place : "");
          setActivitySummary(typeof activity.summary === "string" ? activity.summary : "");
          setActivityStory(typeof activity.story === "string" ? activity.story : "");
          setActivityOutcome(typeof activity.outcome === "string" ? activity.outcome : "");
          setActivityNextAction(typeof activity.nextAction === "string" ? activity.nextAction : "");
        }
        const recipe = draft.recipe;
        if (recipe) {
          setRecipePurpose(typeof recipe.purpose === "string" ? recipe.purpose : "");
          setRecipePreparation(typeof recipe.preparation === "string" ? recipe.preparation : "");
          setRecipePromotion(typeof recipe.promotion === "string" ? recipe.promotion : "");
          setRecipeLessons(typeof recipe.lessons === "string" ? recipe.lessons : "");
        }
        setEditLoad("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setEditLoadMessage(error instanceof Error ? error.message : "수정할 내용을 불러오지 못했어요.");
        setEditLoad("error");
      });
    return () => {
      active = false;
    };
  }, [editingSubmissionId, user]);

  useEffect(() => {
    if (status.tone === "success") successHeading.current?.focus();
  }, [status.tone]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!services || !user) {
      setStatus({
        tone: "error",
        message: "먼저 네이버 또는 카카오로 로그인해 주세요.",
      });
      return;
    }
    const needsUploadFile = sourceMode === "upload" && (!editingSubmissionId || existingFileCount === 0);
    if (sourceMode === 'text' && !body.trim()) {
      setStatus({ tone: 'error', message: '공유할 내용을 적어 주세요.' }); return;
    }
    if (needsUploadFile && !file) {
      setStatus({ tone: "error", message: "올릴 파일을 선택해 주세요." });
      return;
    }
    if (sourceMode === "google_drive_link" && !sourceLinkUrl.trim()) {
      setStatus({ tone: "error", message: "Google Drive 또는 Google Docs 링크를 입력해 주세요." });
      return;
    }
    if (sourceMode === "instagram_url" && instagramAttachments.length === 0) {
      setStatus({ tone: "error", message: "Instagram 게시물이나 릴 링크를 하나 이상 연결해 주세요." });
      return;
    }
    const fileError = file ? uploadFileError(file) : null;
    if (fileError) {
      setStatus({ tone: "error", message: fileError });
      return;
    }
    if (previewFile && (previewFile.type !== "application/pdf" || previewFile.size <= 0 || previewFile.size > 20 * 1024 * 1024)) {
      setStatus({ tone: "error", message: "미리보기 파일은 20MB 이하의 PDF로 올려 주세요." });
      return;
    }
    if (!visibility || !visibilityExplicit) {
      setStatus({ tone: "error", message: "공개 범위를 선택해 주세요." });
      return;
    }
    if (!consentConfirmed || !sensitiveDataReviewed) {
      setStatus({
        tone: "error",
        message: "공유 권한과 개인정보 확인 항목을 모두 확인해 주세요.",
      });
      return;
    }
    let capturedDraftRevision = savedContributionDraftRevision(contributionDraft.capture());
    const attempt = { revision: attemptRevision.current, uid: user.uid };
    const attemptIsCurrent = () => contributionAttemptIsCurrent(
      attempt,
      attemptRevision.current,
      services.auth.currentUser?.uid,
    );
    setStatus({
      tone: "working",
      message: sourceMode === "upload"
        ? "내용을 저장하고 파일을 올리고 있어요."
        : sourceMode === 'text' ? '내용을 게시하고 있어요.' : "내용과 원문 링크를 저장하고 있어요.",
    });
    setProgress(0);
    let activeSession = draftCreateReservation
      ? restoreContributionCreation(submissionSession, draftCreateReservation)
      : submissionSession;
    if (draftCreateReservation && !initialCreatePayload.current) {
      initialCreatePayload.current = {
        requestId: draftCreateReservation.requestId,
        submission: contributionSubmissionPayload(draftCreateReservation.firstValue),
      };
    }
    try {
      const submission = contributionSubmissionPayload(contributionDraftValue);
      const uploadFiles: Array<{
        file: File;
        descriptor: { name: string; size: number; contentType: string; sha256: string };
      }> = [];
      if (sourceMode === "upload" && file) {
        const sanitizedName = file.name.replace(/[^\p{L}\p{N}._-]/gu, "_");
        const selections = [
          { file, name: sanitizedName },
          ...(previewFile
            ? [{
                file: previewFile,
                name: `__preview__-${previewFile.name.replace(/[^\p{L}\p{N}._-]/gu, "_")}`,
              }]
            : []),
        ];
        for (const selection of selections) {
          const bytes = await selection.file.arrayBuffer();
          if (!attemptIsCurrent()) return;
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          if (!attemptIsCurrent()) return;
          const sha256 = [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          uploadFiles.push({
            file: selection.file,
            descriptor: {
              name: selection.name,
              size: selection.file.size,
              contentType: uploadContentType(selection.file),
              sha256,
            },
          });
        }
      }
      const uploadSelectionFingerprint = contributionUploadSelectionFingerprint(
        uploadFiles.map(({ descriptor }) => descriptor),
      );
      const draftFingerprint = contributionDraftFingerprint(
        JSON.stringify(submission),
        uploadSelectionFingerprint,
      );
      let payload: { submissionId: string };
      if (editingSubmissionId) {
        await updateSubmissionDraft(editingSubmissionId, submission);
        if (!attemptIsCurrent()) return;
        payload = { submissionId: editingSubmissionId };
      } else {
        const createDraft = httpsCallable<Record<string, unknown>, { submissionId: string }>(services.functions, "createSubmission");
        if (activeSession.submissionId) {
          try {
            await getMySubmissionDraft(activeSession.submissionId);
            if (!attemptIsCurrent()) return;
            await updateSubmissionDraft(activeSession.submissionId, submission);
            if (!attemptIsCurrent()) return;
          } catch (error) {
            if (!attemptIsCurrent()) return;
            const code = error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "";
            if (code !== "functions/failed-precondition" && code !== "failed-precondition") throw error;
            if (!contributionDraftMatches(activeSession, draftFingerprint)) {
              throw new Error(
                "이미 게시된 글에는 이번 수정이 반영되지 않았어요. 내 게시물 관리에서 수정해 주세요.",
                { cause: error },
              );
            }
          }
        }
        const recoveringCreate = !activeSession.submissionId;
        let createReservation = activeSession.createReservation;
        if (recoveringCreate) {
          activeSession = reserveContributionCreation(
            activeSession,
            draftFingerprint,
            () => crypto.randomUUID(),
          );
          setSubmissionSession(activeSession);
          createReservation = activeSession.createReservation;
          if (!createReservation) throw new Error("글 저장 예약을 만들지 못했어요.");
          if (!draftCreateReservation) {
            const persistedReservation: ContributionCreateReservation = {
              requestId: createReservation.requestId,
              inputFingerprint: createReservation.inputFingerprint,
              firstValue: contributionDraftFields(contributionDraftValue),
            };
            setDraftCreateReservation(persistedReservation);
            const persistedCapture = savedContributionDraftRevision(contributionDraft.capture({
              ...contributionDraftValue,
              createReservation: persistedReservation,
            }));
            if (persistedCapture) capturedDraftRevision = persistedCapture;
          }
          if (!initialCreatePayload.current) {
            const firstValue = draftCreateReservation?.firstValue ?? contributionDraftFields(contributionDraftValue);
            initialCreatePayload.current = {
              requestId: createReservation.requestId,
              submission: contributionSubmissionPayload(firstValue),
            };
          }
        }
        const createPayload = initialCreatePayload.current;
        activeSession = await beginContributionSession(activeSession, async () => {
          if (!createReservation || !createPayload || createPayload.requestId !== createReservation.requestId) {
            throw new Error("글 저장 예약을 확인하지 못했어요. 새 글 작성을 눌러 다시 시작해 주세요.");
          }
          const draft = await createDraft({
            ...createPayload.submission,
            clientRequestId: createReservation.requestId,
          });
          if (!attemptIsCurrent()) throw new Error("로그인 계정이 바뀌어 저장을 중단했어요.");
          return draft.data.submissionId;
        }, draftFingerprint);
        if (!attemptIsCurrent()) return;
        if (recoveringCreate && contributionCreationNeedsDraftUpdate(activeSession, draftFingerprint)) {
          await updateSubmissionDraft(activeSession.submissionId, submission);
          if (!attemptIsCurrent()) return;
        }
        setSubmissionSession(activeSession);
        payload = { submissionId: activeSession.submissionId };
      }
      if (sourceMode === "upload" && uploadFiles.length) {
          activeSession = reserveContributionUploads(
            activeSession,
            uploadSelectionFingerprint,
            () => crypto.randomUUID(),
          );
          setSubmissionSession(activeSession);
          const reservation = activeSession.uploadReservation;
          if (!reservation) throw new Error("파일 업로드 예약을 만들지 못했어요.");
          const prepare = httpsCallable<
            {
              submissionId: string;
              requestId: string;
              files: Array<{ name: string; size: number; contentType: string; sha256: string }>;
            },
            { requestId: string; reservationId: string; expiresAtMs: number; files: Array<{ name: string; targetName: string; sha256: string }> }
          >(services.functions, "prepareSubmissionUploads");
          const prepared = await prepare({
            submissionId: payload.submissionId,
            requestId: reservation.requestId,
            files: uploadFiles.map(({ descriptor }) => descriptor),
          });
          if (!attemptIsCurrent()) return;
          if (prepared.data.requestId !== reservation.requestId || !prepared.data.reservationId || prepared.data.expiresAtMs <= Date.now()) {
            throw new Error("파일 업로드 예약이 바뀌었어요. 다시 시도해 주세요.");
          }
          const targets = new Map(prepared.data.files.map((item) => [item.name, item.targetName]));
          const reconcile = httpsCallable<
            { submissionId: string; requestId: string; targetName: string },
            { complete: boolean }
          >(services.functions, "reconcileSubmissionUpload");
          const totalBytes = uploadFiles.reduce((sum, selection) => sum + selection.file.size, 0);
          let completedBytes = 0;
          for (const selection of uploadFiles) {
            const targetName = targets.get(selection.descriptor.name);
            if (!targetName) throw new Error("파일 업로드 경로를 확인하지 못했어요.");
            const reconciled = await reconcile({
              submissionId: payload.submissionId,
              requestId: reservation.requestId,
              targetName,
            });
            if (!attemptIsCurrent()) return;
            if (contributionUploadDecision(reconciled.data) === "skip") {
              completedBytes += selection.file.size;
              setProgress(Math.round((completedBytes / totalBytes) * 100));
              continue;
            }
            const upload = uploadBytesResumable(
              ref(services.storage, `quarantined/${user.uid}/${payload.submissionId}/${targetName}`),
              selection.file,
              { contentType: selection.descriptor.contentType, customMetadata: { reservationId: prepared.data.reservationId, requestId: reservation.requestId, weaveSha256: selection.descriptor.sha256 } },
            );
            await new Promise<void>((resolve, reject) =>
              upload.on(
                "state_changed",
                (snapshot) => {
                  if (attemptIsCurrent()) setProgress(
                    Math.round(
                      ((completedBytes + snapshot.bytesTransferred) / totalBytes) * 100,
                    ),
                  );
                },
                reject,
                () => resolve(),
              ),
            );
            if (!attemptIsCurrent()) return;
            completedBytes += selection.file.size;
          }
          if (attemptIsCurrent() && completedBytes === totalBytes) setProgress(100);
      }
      const submit = httpsCallable<{ submissionId: string }, { status: string }>(services.functions, "submitSubmission");
      const result = await submit({ submissionId: payload.submissionId });
      if (!attemptIsCurrent()) return;
      const draftCompletion = capturedDraftRevision
        ? contributionDraft.complete(capturedDraftRevision, {
            ...contributionDraftValue,
            sourceLinkUrl: "",
            instagramAttachments: [],
            createReservation: undefined,
          })
        : "unavailable";
      setSubmissionSession(result.data.status === "published"
        ? markContributionPublished(activeSession)
        : activeSession);
      setStatus({
        tone: "success",
        message: contributionSuccessMessage(sourceMode, result.data.status),
      });
      if (draftCompletion === "cleared") {
        setFile(null);
        setPreviewFile(null);
        setSourceLinkUrl("");
        setInstagramAttachments([]);
        setDraftCreateReservation(null);
      }
      setProgress(100);
    } catch (error) {
      if (!attemptIsCurrent()) return;
      setSubmissionSession(retryContributionSession(activeSession));
      setStatus({
        tone: "error",
        message: error instanceof Error && !('code' in error) && /[가-힣]/u.test(error.message)
          ? error.message
          : callableWriteErrorMessage(error, "자료·기록"),
      });
    }
  };

  return (
    <section
      className="live-contribution"
      aria-labelledby="live-contribution-title"
    >
      <div className={`live-contribution-heading ${styles.compactHeading}`}>
        <div>
          <p>{editingSubmissionId ? "내용 수정" : user ? kindLabels[kind] : "시작하기"}</p>
          <h2 id="live-contribution-title">
            {editingSubmissionId
              ? "내용을 고쳐 다시 올려요"
              : user
                ? "활동과 자료를 나눠요"
                : "로그인하면 바로 시작할 수 있어요"}
          </h2>
          <span>
            {editingSubmissionId
              ? "바꾸고 싶은 내용을 고친 뒤 다시 올려 주세요."
              : user
                ? "종류를 고른 뒤 제목부터 바로 적어 주세요."
                : "무엇을 남길지 먼저 고르고, 로그인한 뒤 이어서 작성할 수 있어요."}
          </span>
        </div>
        {user ? (
          <div className="contribution-session">
            <CheckCircle2 size={17} />
            <span><b>로그인됨</b>바로 작성할 수 있어요</span>
          </div>
        ) : (
          <div className="contribution-session muted">
            <LogIn size={17} />
            <span><b>로그인 필요</b>내용을 올리려면 로그인해 주세요</span>
          </div>
        )}
      </div>
      <fieldset className={styles.kindChooser} aria-describedby="contribution-kind-help">
        <legend>{editingSubmissionId ? "수정 중인 게시물" : "무엇을 남길까요"}</legend>
        <p id="contribution-kind-help">
          {editingSubmissionId ? "수정 중에는 게시물 종류를 바꿀 수 없어요." : "선택한 종류별로 초안을 따로 보관해요."}
        </p>
        <div className={styles.kindOptions}>
          {availableKinds.map((item) => (
            <label className={styles.kindOption} key={item}>
              <input
                type="radio"
                name="contribution-kind"
                value={item}
                checked={(editingSubmissionId ? kind : entry.initialKind) === item}
                disabled={Boolean(editingSubmissionId)}
                onChange={() => selectContributionKind(item)}
              />
              <span>
                <b>{kindLabels[item]}</b>
                <small>{kindDescriptions[item]}</small>
              </span>
            </label>
          ))}
          {!editingSubmissionId && (
            <a className={styles.eventChoice} href="/calendar/new">
              <b>앞으로 열 행사</b>
              <small>날짜와 장소가 있는 새 일정을 등록해요</small>
            </a>
          )}
        </div>
      </fieldset>
      {!services ? (
        <div className="contribution-message error">
          <CircleAlert size={18} />
          <span>로그인 기능을 준비하고 있어요.</span>
        </div>
      ) : !user ? (
        <div className="community-login-actions" aria-label="활동 기록 또는 자료 등록 로그인">
          <ProviderLoginButton
            provider="kakao"
            onClick={() => startOAuthLogin("kakao", contributionReturnTo(window.location.search, window.location.hash))}
          />
          <ProviderLoginButton
            provider="naver"
            onClick={() => startOAuthLogin("naver", contributionReturnTo(window.location.search, window.location.hash))}
          />
        </div>
      ) : editingSubmissionId && editLoad === "loading" ? (
        <div className="contribution-message working" role="status">
          <LoaderCircle className="spin" size={18} />
          <span>수정할 내용을 불러오고 있어요.</span>
        </div>
      ) : editingSubmissionId && editLoad === "error" ? (
        <div className="contribution-message error" role="alert">
          <CircleAlert size={18} />
          <span>{editLoadMessage || "수정할 내용을 불러오지 못했어요."} <a href="/profile">내 위브로 돌아가기</a></span>
        </div>
      ) : status.tone === "success" ? (
        <section className={styles.successView} role="status" aria-live="polite" aria-labelledby="contribution-success-title">
          <CheckCircle2 size={28} aria-hidden="true" />
          <div>
            <p className={styles.successEyebrow}>{editingSubmissionId ? "수정 완료" : "게시 완료"}</p>
            <h3 ref={successHeading} id="contribution-success-title" tabIndex={-1}>{status.message}</h3>
            <p>이제 올린 내용을 확인하거나 내 게시물에서 공개 범위와 첨부 상태를 관리할 수 있어요.</p>
          </div>
          <div className={styles.successActions}>
            {successPath ? (
              <a className={styles.successPrimary} href={successPath}>게시물 보기</a>
            ) : (
              <a className={styles.successPrimary} href="/profile?tab=activity">내 게시물 관리</a>
            )}
            {successPath && <a className={styles.successSecondary} href="/profile?tab=activity">내 게시물 관리</a>}
            {!editingSubmissionId && (
              <button className={styles.successSecondary} type="button" onClick={startNewContribution}>새 글 작성</button>
            )}
          </div>
        </section>
      ) : (
        <form className={`contribution-form ${styles.form}`} onSubmit={onSubmit}>
          <DraftRecoveryPanel
            state={contributionDraft.state}
            recovery={contributionDraft.recovery}
            onContinue={contributionDraft.continueDraft}
            onStartNew={() => {
              const nextOwner = user.displayName?.trim() ?? "";
              if (contributionDraft.startNew(emptyContributionDraftValue(nextOwner, entry.initialKind, topics[0]))) resetForm(nextOwner);
            }}
            onDelete={() => {
              const nextOwner = user.displayName?.trim() ?? "";
              if (contributionDraft.deleteDraft(emptyContributionDraftValue(nextOwner, entry.initialKind, topics[0]))) resetForm(nextOwner);
            }}
            onRetry={contributionDraft.retry}
          />
          <AuthoringFlow label="작성 순서" steps={contributionFlowSteps} />
          <fieldset className="contribution-step" id="contribution-content">
            <legend>기본 내용</legend>
            <p>제목과 만든 사람을 먼저 적어 주세요.</p>
            <div className="contribution-fields">
              <label>
                <span>제목 (필수)</span>
                <input id="contribution-first-input" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 청년 정기훈련 회고 자료" />
              </label>
              <label>
                <span>만든 사람 또는 단체 (필수)</span>
                <input required maxLength={160} value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="예: 서울 청년회" />
              </label>
            </div>
          </fieldset>

          {hasActivityDetails && (
            <details className="contribution-optional">
              <summary>활동 이야기를 조금 더 들려주기 <span>선택</span></summary>
              <fieldset className="contribution-step">
              <legend>활동 정보</legend>
              <p id="activity-details-help">
                한 줄 소개만 적어도 괜찮아요. 날짜와 장소는 기억나는 만큼 더해 주세요.
              </p>
              <div
                className="contribution-fields"
                aria-describedby="activity-details-help"
              >
                <label>
                  <span>관심 주제</span>
                  <select
                    value={activityTopic}
                    onChange={(event) => setActivityTopic(event.target.value as Topic)}
                  >
                    {topics.map((topic) => <option key={topic}>{topic}</option>)}
                  </select>
                </label>
                <label>
                  <span>활동 방식</span>
                  <input
                    maxLength={60}
                    value={activityType}
                    onChange={(event) => setActivityType(event.target.value)}
                    placeholder="예: 대화 모임, 현장 방문, 실천 캠페인"
                  />
                </label>
                <label>
                  <span>활동한 날</span>
                  <input
                    type="date"
                    value={activityDate}
                    onChange={(event) => setActivityDate(event.target.value)}
                  />
                </label>
                <label>
                  <span>활동한 곳</span>
                  <input
                    maxLength={120}
                    value={activityPlace}
                    onChange={(event) => setActivityPlace(event.target.value)}
                    placeholder="예: 서울교구 청년회관 또는 온라인"
                  />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  <span>한 줄 소개</span>
                  <input
                    maxLength={180}
                    value={activitySummary}
                    onChange={(event) => setActivitySummary(event.target.value)}
                    placeholder="무엇을 위해 어떤 활동을 했는지 짧게 적어 주세요"
                  />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  <span>시작하게 된 계기</span>
                  <textarea
                    maxLength={600}
                    rows={4}
                    value={activityStory}
                    onChange={(event) => setActivityStory(event.target.value)}
                    placeholder="어떤 고민이나 필요에서 시작했는지 들려 주세요"
                    style={contributionTextareaStyle}
                  />
                </label>
                <label>
                  <span>활동 뒤 남은 것</span>
                  <input
                    maxLength={240}
                    value={activityOutcome}
                    onChange={(event) => setActivityOutcome(event.target.value)}
                    placeholder="예: 진행 순서와 회고 질문을 남겼어요"
                  />
                </label>
                <label>
                  <span>다음에 해 볼 일</span>
                  <input
                    maxLength={160}
                    value={activityNextAction}
                    onChange={(event) => setActivityNextAction(event.target.value)}
                    placeholder="예: 다음 모임에서 대화 가이드 활용하기"
                  />
                </label>
              </div>
              </fieldset>
            </details>
          )}

          {hasRecipeDetails && (
            <details className="contribution-optional">
              <summary>다른 지역에 도움이 될 운영 팁 더하기 <span>선택</span></summary>
              <fieldset className="contribution-step">
              <legend>활동 운영 노하우</legend>
              <p id="activity-recipe-help">
                다른 지역에서도 시작할 수 있도록 준비와 운영의 핵심을 남겨 주세요.
              </p>
              <div
                className="contribution-fields"
                aria-describedby="activity-recipe-help"
              >
                <label>
                  <span>활동의 목적</span>
                  <textarea
                    maxLength={300}
                    rows={4}
                    value={recipePurpose}
                    onChange={(event) => setRecipePurpose(event.target.value)}
                    placeholder="이 활동으로 만들고 싶은 변화를 적어 주세요"
                    style={contributionTextareaStyle}
                  />
                </label>
                <label>
                  <span>준비 방법</span>
                  <textarea
                    maxLength={500}
                    rows={4}
                    value={recipePreparation}
                    onChange={(event) => setRecipePreparation(event.target.value)}
                    placeholder="필요한 사람, 자료, 공간과 준비 순서를 적어 주세요"
                    style={contributionTextareaStyle}
                  />
                </label>
                <label>
                  <span>알리는 방법</span>
                  <textarea
                    maxLength={400}
                    rows={4}
                    value={recipePromotion}
                    onChange={(event) => setRecipePromotion(event.target.value)}
                    placeholder="누구에게 어떤 말로 알렸는지 적어 주세요"
                    style={contributionTextareaStyle}
                  />
                </label>
                <label>
                  <span>다음에 바꾸고 싶은 점</span>
                  <textarea
                    maxLength={500}
                    rows={4}
                    value={recipeLessons}
                    onChange={(event) => setRecipeLessons(event.target.value)}
                    placeholder="해 보니 알게 된 점과 다음에 고칠 점을 적어 주세요"
                    style={contributionTextareaStyle}
                  />
                </label>
              </div>
              </fieldset>
            </details>
          )}

          <fieldset className="contribution-step">
            <legend>본문 작성</legend>
            <p>직접 적거나 TXT·MD 파일의 내용을 가져오세요. 본문을 쓴 뒤에도 첨부 파일이나 원문 링크를 함께 연결할 수 있어요.</p>
            <TextComposer key={`${user?.uid ?? 'guest'}-${composerKey}`} value={body} onChange={setBody} required={sourceMode === 'text'} />
          </fieldset>

          <fieldset className="contribution-step" id="contribution-source">
            <legend>첨부 또는 원문 연결</legend>
            <p>본문과 별개로 원본 파일이나 공개 링크를 연결할 수 있어요. 추가할 자료가 없다면 ‘연결 안 함’을 선택하세요.</p>
            <div
              className={styles.sourceModes}
              role="radiogroup"
              aria-label="첨부 또는 원문 연결 방법"
              aria-describedby="source-mode-guidance"
            >
              {sourceModeOptions.map((option) => (
                <label className={styles.sourceOption} key={option.value}>
                  <input
                    className={styles.sourceRadio}
                    type="radio"
                    name="source-mode"
                    value={option.value}
                    disabled={Boolean(editingSubmissionId)}
                    checked={sourceMode === option.value}
                    onChange={() => selectSourceMode(option.value)}
                  />
                  {option.value === 'text' ? <FileText size={18} aria-hidden="true" /> : option.value === "upload" ? (
                    <FileCheck2 size={18} aria-hidden="true" />
                  ) : option.value === "google_drive_link" ? (
                    <Link2 size={18} aria-hidden="true" />
                  ) : (
                    <InstagramGlyph size={18} />
                  )}
                  <span className={styles.sourceLabel}>{option.value === "text" ? "연결 안 함" : option.label}</span>
                </label>
              ))}
            </div>
            <p className={styles.sourceGuidance} id="source-mode-guidance">{selectedSourceDescription}</p>
            {editingSubmissionId && (
              <p className="source-link-notice">
                수정 중에는 자료 연결 방법을 바꿀 수 없어요. 다른 방식으로 나누려면 <a href="/profile">내 위브에서 현재 공개를 중단</a>하고 새로 올려 주세요.
              </p>
            )}
            {sourceMode === "upload" ? (
              <>
                <div className={styles.filePickerGroup}>
                  <label className="file-field">
                    <FileCheck2 size={22} aria-hidden="true" />
                    <span>{file ? "다른 첨부 파일 선택" : existingFileCount > 0 ? "기존 첨부 파일 교체" : "첨부 파일 선택 (필수)"}</span>
                    <input
                      ref={fileInput}
                      required={!file && (!editingSubmissionId || existingFileCount === 0)}
                      type="file"
                      accept={uploadAccept}
                      onChange={(event) => {
                        const selected = consumeFileSelection(event.currentTarget);
                        setFile(selected);
                        if (!selected || !isHangulDocumentFile(selected)) {
                          setPreviewFile(null);
                          if (previewFileInput.current) previewFileInput.current.value = "";
                        }
                        const error = selected ? uploadFileError(selected) : null;
                        setStatus(error ? { tone: "error", message: error } : { tone: "idle", message: "" });
                      }}
                    />
                    <small>한글(HWP·HWPX), PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, JPG, PNG, WEBP · 최대 20MB</small>
                  </label>
                  {file ? (
                    <div className={styles.selectedFile} aria-live="polite">
                      <div><b>{file.name}</b><span>{Math.ceil(file.size / 1024).toLocaleString()}KB · 첨부 준비됨</span></div>
                      <button type="button" onClick={() => {
                        setFile(null);
                        setPreviewFile(null);
                        if (fileInput.current) fileInput.current.value = "";
                        if (previewFileInput.current) previewFileInput.current.value = "";
                        setStatus({ tone: "idle", message: "" });
                        fileInput.current?.focus();
                      }}>선택 해제</button>
                    </div>
                  ) : existingFileCount > 0 ? (
                    <p className={styles.existingFileNotice}>기존 파일 {existingFileCount}개를 유지합니다. 새 파일을 고르면 기존 첨부 전체를 교체해요.</p>
                  ) : null}
                </div>
                {file && isHangulDocumentFile(file) && (
                  <div className={styles.filePickerGroup}>
                    <label className="file-field file-field-preview">
                      <FileCheck2 size={22} aria-hidden="true" />
                      <span>{previewFile ? "다른 미리보기 PDF 선택" : "미리보기 PDF 선택"}</span>
                      <input
                        ref={previewFileInput}
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={(event) => {
                          const selected = consumeFileSelection(event.currentTarget);
                          setPreviewFile(selected);
                          const error = selected && (selected.type !== "application/pdf" || selected.size <= 0 || selected.size > 20 * 1024 * 1024)
                            ? "미리보기 파일은 20MB 이하의 PDF로 올려 주세요."
                            : "";
                          setStatus(error ? { tone: "error", message: error } : { tone: "idle", message: "" });
                        }}
                      />
                      <small>선택 사항 · 한글 문서와 함께 올리면 화면에서 바로 미리볼 수 있어요</small>
                    </label>
                    {previewFile && (
                      <div className={styles.selectedFile} aria-live="polite">
                        <div><b>{previewFile.name}</b><span>{Math.ceil(previewFile.size / 1024).toLocaleString()}KB · 미리보기용 PDF</span></div>
                        <button type="button" onClick={() => {
                          setPreviewFile(null);
                          if (previewFileInput.current) previewFileInput.current.value = "";
                          setStatus({ tone: "idle", message: "" });
                          previewFileInput.current?.focus();
                        }}>선택 해제</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : sourceMode === "google_drive_link" ? (
              <label className="source-link-field">
                <span>Google Drive 또는 Docs 링크 (필수)</span>
                <input
                  required
                  type="url"
                  inputMode="url"
                  value={sourceLinkUrl}
                  onChange={(event) => setSourceLinkUrl(event.target.value)}
                  placeholder="https://docs.google.com/document/d/.../edit"
                />
                <small>‘링크가 있는 모든 사용자 · 뷰어’로 설정한 공개 링크만 연결해 주세요.</small>
              </label>
            ) : sourceMode === 'instagram_url' ? (
              <p className="source-link-notice">
                아래에서 Instagram 원문을 연결해 주세요. 위브는 게시물 내용을 복사하거나 계정에 로그인하지 않고 공개 링크만 보관합니다.
              </p>
            ) : null}
          </fieldset>

          {sourceMode === "instagram_url" && (
            <InstagramPostAttachment
              value={instagramAttachments}
              onChange={setInstagramAttachments}
              required
            />
          )}

          <div className={styles.sharingSection}>
          <fieldset className="contribution-step" id="contribution-rights">
            <legend>공개 범위</legend>
            <p>이 내용을 처음 올리기 전에 누가 볼 수 있는지 직접 선택해 주세요.</p>
            <div className="contribution-fields">
              <label>
                <span>누가 볼 수 있나요 (필수)</span>
                <select
                  required
                  value={visibility ?? ""}
                  onChange={(event) => {
                    const nextVisibility = event.target.value as Visibility;
                    setVisibility(nextVisibility);
                    setVisibilityExplicit(true);
                  }}
                >
                  <option value="" disabled>공개 범위를 선택해 주세요</option>
                  <option value="회원 전용">위브 로그인 이용자에게만 공개</option>
                  <option value="공개">누구나 볼 수 있게 공개</option>
                  <option value="보류">나만 보관</option>
                </select>
                <small>{editingSubmissionId ? "현재 공개 범위를 유지하거나 여기서 변경할 수 있어요." : "선택하기 전에는 게시되지 않아요."}</small>
              </label>
            </div>
          </fieldset>

          <fieldset className="contribution-step contribution-rights">
            <legend>공유 권한 확인</legend>
            <p>이 내용을 나눌 수 있는 이유를 골라 주세요.</p>
            <div className="contribution-fields">
              <label>
                <span>내용과의 관계</span>
                <select
                  value={consentBasis}
                  onChange={(event) => setConsentBasis(event.target.value as (typeof consentOptions)[number])}
                >
                  {consentOptions.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
            </div>
            <div className="contribution-confirmations">
              <label className="consent-field">
                <input
                  required
                  type="checkbox"
                  checked={consentConfirmed && sensitiveDataReviewed}
                  onChange={(event) => {
                    setConsentConfirmed(event.target.checked);
                    setSensitiveDataReviewed(event.target.checked);
                  }}
                />
                <span>공유할 권한이 있으며 개인정보나 공개하면 안 되는 내용이 없는지 확인했어요 (필수)</span>
              </label>
            </div>
          </fieldset>

          </div>

          <details className="contribution-optional">
            <summary>출처와 이용 방법 바꾸기 <span>선택</span></summary>
            <fieldset className="contribution-step">
              <legend>세부 출처 설정</legend>
              <div className="contribution-fields">
                <label>
                  <span>화면에 표시할 출처</span>
                  <input maxLength={160} value={attribution} onChange={(event) => setAttribution(event.target.value)} placeholder={owner || "만든 사람이나 단체와 같게 표시"} />
                </label>
                <label>
                  <span>자료를 가져온 곳</span>
                  <input maxLength={160} value={source} onChange={(event) => setSource(event.target.value)} placeholder="비워 두면 연결 방식으로 표시해요" />
                </label>
                {sourceMode === "upload" && (
                  <label>
                    <span>이용 방법</span>
                    <select value={redistribution} onChange={(event) => setRedistribution(event.target.value as typeof redistribution)}>
                      <option value="view_only">위브에서 보기만 허용</option>
                      <option value="download_allowed">파일 내려받기 허용</option>
                    </select>
                    <small>
                      {redistribution === "download_allowed"
                        ? "파일은 안전 확인 후 내려받을 수 있어요."
                        : "별도 미리보기 PDF가 없으면 게시글 내용만 보이고 첨부 파일은 직접 볼 수 없어요."}
                    </small>
                  </label>
                )}
              </div>
              {sourceMode === "google_drive_link" && (
                <p className="source-link-notice">
                  Google 파일은 ‘링크가 있는 모든 사용자 · 뷰어’로 설정해야 다른 사람도 열 수 있어요.
                </p>
              )}
            </fieldset>
          </details>

          <div className={`contribution-submit ${styles.submitBar}`}>
            <ShieldCheck size={22} aria-hidden="true" />
            <p>
              <b>{editingSubmissionId ? "수정한 내용으로 다시 올려요" : "이 내용으로 게시할까요"}</b>
              <span>
                {sourceMode === "upload"
                  ? "첨부 파일은 안전 검사 후 이용할 수 있어요."
                  : sourceMode === "text"
                    ? "작성한 글을 선택한 공개 범위로 저장해요."
                    : "작성한 글과 원문 링크를 함께 저장해요."}
                {visibility && ` 공개 범위: ${visibility === "회원 전용" ? "위브 로그인 이용자" : visibility === "보류" ? "나만 보관" : "누구나"}`}
              </span>
            </p>
            <button className="button button-primary" type="submit" disabled={status.tone === "working"}>
              {status.tone === "working" ? <LoaderCircle className="spin" size={18} /> : <UploadCloud size={18} />}
              {status.tone === "working" ? "저장 중" : editingSubmissionId ? "수정 저장" : "게시하기"}
            </button>
          </div>
          {status.tone === "working" && (
            <div className="upload-progress" aria-label={`업로드 ${progress}%`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
          {status.tone !== "idle" && (
            <div
              className={`contribution-message ${status.tone} ${styles.statusBar}`}
              role={status.tone === "error" ? "alert" : "status"}
              aria-live={status.tone === "error" ? "assertive" : "polite"}
            >
              <FileUp size={18} />
              <span>
                {status.message}
              </span>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
