export const submissionStatuses = [
  "draft",
  "review_queued",
  "revision_requested",
  "held",
  "rejected",
  "publishing",
  "publishing_failed",
  "exception_queued",
  "published",
  "change_pending",
  "unpublished",
  "withdrawn",
] as const;

export type SubmissionStatus = (typeof submissionStatuses)[number];
export type SubmissionOwnerAction = "edit" | "withdraw" | "request_revision" | "unpublish" | "restore_private";
export type ModerationNoticeAction = "warn" | "request_correction" | "hold" | "remove" | "restore";

export type ModerationNotice = {
  action: ModerationNoticeAction;
  reason: string;
  createdAtMs: number;
};

export type OwnedSubmission = {
  id: string;
  title: string;
  kind: string;
  status: SubmissionStatus;
  visibility: string;
  sourceMode: "text" | "upload" | "google_drive_link" | "instagram_url";
  createdAtMs?: number;
  updatedAtMs?: number;
  availableActions: SubmissionOwnerAction[];
  scanStatus?: "pending" | "clean" | "blocked" | "error" | "not_applicable";
  attachmentStatus?: "pending" | "clean" | "blocked" | "error" | "not_applicable";
  previewStatus?: "ready" | "not_provided" | "queued" | "failed";
  cleanupState?: "pending" | "failed" | "dead_letter" | "completed";
  nextActionReason?: string;
  moderationNotice?: ModerationNotice;
};

export function canOwnerOpenPrivateAttachment(
  submission: Pick<OwnedSubmission, "status" | "visibility" | "sourceMode" | "attachmentStatus" | "scanStatus">,
): boolean {
  return submission.status === "review_queued"
    && submission.visibility === "보류"
    && submission.sourceMode === "upload"
    && submission.scanStatus === "clean"
    && submission.attachmentStatus === "clean";
}

function hasActiveAttachmentStatus(status: SubmissionStatus): boolean {
  return status === "review_queued"
    || status === "publishing"
    || status === "publishing_failed"
    || status === "exception_queued"
    || status === "published"
    || status === "change_pending";
}

export function submissionAttachmentNotice(
  submission: Pick<OwnedSubmission, "status" | "sourceMode" | "attachmentStatus" | "scanStatus">,
): { label: string; tone: "working" | "success" | "error"; text: string; refresh: boolean } | null {
  if (submission.sourceMode !== "upload" || !hasActiveAttachmentStatus(submission.status)) return null;
  const attachmentStatus = submission.attachmentStatus ?? submission.scanStatus;
  if (attachmentStatus === "error") {
    return {
      label: "서비스 처리 오류",
      tone: "error",
      text: "첨부 검사를 마치지 못했어요. 서버가 자동으로 다시 시도합니다. 상태 새로고침은 현재 결과만 다시 불러오며 검사를 시작하지 않아요.",
      refresh: true,
    };
  }
  if (attachmentStatus === "blocked") {
    return {
      label: "안전 검사 차단",
      tone: "error",
      text: "안전 검사에서 차단된 첨부는 열거나 내려받을 수 없어요. 내용 수정에서 안전한 파일로 교체해 주세요.",
      refresh: false,
    };
  }
  if (attachmentStatus === "pending") {
    return {
      label: "검사 중",
      tone: "working",
      text: "첨부 파일을 확인하고 있어요. 검사를 마치기 전에는 열거나 내려받을 수 없어요.",
      refresh: true,
    };
  }
  if (attachmentStatus === "clean") return {
    label: "검사 완료",
    tone: "success",
    text: "첨부 파일의 안전 검사를 마쳤어요.",
    refresh: false,
  };
  return null;
}

export function submissionPreviewNotice(
  submission: Pick<OwnedSubmission, "status" | "sourceMode" | "attachmentStatus" | "previewStatus">,
): { label: string; tone: "working" | "success" | "error" | "neutral"; text: string } | null {
  if (!hasActiveAttachmentStatus(submission.status) || submission.sourceMode !== "upload" || submission.attachmentStatus !== "clean") return null;
  if (submission.previewStatus === "queued") return { label: "변환 준비 중", tone: "working", text: "미리보기를 준비하고 있어요. 원본 다운로드 권한은 그대로 유지됩니다." };
  if (submission.previewStatus === "failed") return { label: "변환 실패", tone: "error", text: "미리보기 변환을 마치지 못했어요. 미리보기에서 다시 시도할 수 있으며, 허용된 원본 다운로드는 계속 이용할 수 있어요." };
  if (submission.previewStatus === "ready") return { label: "미리보기 준비됨", tone: "success", text: "미리보기를 열 수 있어요." };
  if (submission.previewStatus === "not_provided") return { label: "별도 미리보기 없음", tone: "neutral", text: "지원 형식은 처음 열 때 미리보기를 만들 수 있어요." };
  return null;
}

export type EditableSubmissionDraft = {
  textContent?: { schemaVersion: 1; format: "markdown"; body: string };
  id: string;
  status: "draft" | "revision_requested";
  sourceMode: "text" | "upload" | "google_drive_link" | "instagram_url";
  title: string;
  kind: "활동 기록" | "자료" | "활동 레시피";
  source: string;
  owner: string;
  visibility: "공개" | "회원 전용" | "보류";
  attribution: string;
  consentBasis: string;
  redistribution: "download_allowed" | "view_only" | "source_link_only";
  consentConfirmed: boolean;
  sensitiveDataReviewed: boolean;
  sourceLinkUrl?: string;
  instagramAttachments?: unknown[];
  activity?: Record<string, unknown>;
  recipe?: Record<string, unknown>;
  existingFileCount: number;
};

export const submissionStatusCopy: Record<SubmissionStatus, { label: string; description: string }> = {
  draft: { label: "작성 중", description: "내용을 마저 적은 뒤 바로 올릴 수 있어요." },
  review_queued: { label: "게시 준비 중", description: "선택한 공개 범위로 게시를 준비하고 있어요." },
  revision_requested: { label: "수정 필요", description: "운영 안내를 확인하고 필요한 내용을 고쳐 주세요." },
  held: { label: "게시 보류", description: "권리나 개인정보 확인이 끝날 때까지 게시가 보류됩니다." },
  rejected: { label: "게시 제한", description: "운영 안내에 따라 게시할 수 없어요." },
  publishing: { label: "게시 중", description: "선택한 공개 범위를 적용하고 있어요." },
  publishing_failed: { label: "게시 오류", description: "게시를 마치지 못해 자동으로 다시 시도하고 있어요." },
  exception_queued: { label: "게시 확인 필요", description: "게시 처리 중 확인이 필요한 문제가 생겼어요." },
  published: { label: "게시됨", description: "선택한 공개 범위에서 본문을 볼 수 있어요." },
  change_pending: { label: "수정 반영 중", description: "현재 게시본은 유지하고 새 수정 내용을 반영하고 있어요." },
  unpublished: { label: "공개 중단", description: "기록은 보관되지만 공개 화면에서는 보이지 않아요." },
  withdrawn: { label: "철회", description: "올리기를 취소해 공개되지 않았어요." },
};

export function submissionLifecycleCopy(
  submission: Pick<OwnedSubmission, "status" | "sourceMode" | "visibility">,
): { label: string; description: string } {
  if (
    submission.status === "review_queued"
    && submission.visibility === "보류"
  ) {
    return { label: "나만 보관", description: "다른 이용자에게 보이지 않으며 언제든 내용을 이어서 수정할 수 있어요." };
  }
  return submissionStatusCopy[submission.status];
}

export function submissionManagementPresentation(
  submission: Pick<OwnedSubmission, "status" | "sourceMode" | "visibility" | "attachmentStatus" | "scanStatus" | "previewStatus">,
) {
  return {
    lifecycle: submissionLifecycleCopy(submission),
    attachment: submissionAttachmentNotice(submission),
    preview: submissionPreviewNotice(submission),
  };
}

export const moderationNoticeCopy: Record<ModerationNoticeAction, { label: string; description: string }> = {
  warn: { label: "운영 안내", description: "안내 내용을 확인해 주세요." },
  request_correction: { label: "수정 요청", description: "현재 공개 상태를 확인하고 필요한 부분을 수정해 주세요." },
  hold: { label: "공개 보류 안내", description: "확인이 끝날 때까지 공개가 보류됩니다." },
  remove: { label: "공개 중단 안내", description: "운영 기준에 따라 공개가 중단됐습니다." },
  restore: { label: "공개 복구 안내", description: "확인을 마쳐 다시 공개됐습니다." },
};

function isStatus(value: unknown): value is SubmissionStatus {
  return typeof value === "string" && submissionStatuses.includes(value as SubmissionStatus);
}

const actions = new Set<SubmissionOwnerAction>(["edit", "withdraw", "request_revision", "unpublish", "restore_private"]);
const moderationActions = new Set<ModerationNoticeAction>(["warn", "request_correction", "hold", "remove", "restore"]);

function parseModerationNotice(value: unknown): ModerationNotice | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  if (
    !moderationActions.has(data.action as ModerationNoticeAction)
    || !reason
    || reason.length > 500
    || typeof data.createdAtMs !== "number"
    || !Number.isFinite(data.createdAtMs)
    || data.createdAtMs <= 0
  ) return null;
  return {
    action: data.action as ModerationNoticeAction,
    reason,
    createdAtMs: data.createdAtMs,
  };
}

export function parseOwnedSubmission(value: unknown): OwnedSubmission | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.id !== "string" || !data.id || typeof data.title !== "string" || !isStatus(data.status)) return null;
  const availableActions = Array.isArray(data.availableActions)
    ? data.availableActions.filter((action): action is SubmissionOwnerAction => actions.has(action as SubmissionOwnerAction))
    : [];
  const moderationNotice = parseModerationNotice(data.moderationNotice);
  return {
    id: data.id,
    title: data.title,
    kind: typeof data.kind === "string" ? data.kind : "자료",
    status: data.status,
    visibility: typeof data.visibility === "string" ? data.visibility : "보류",
    sourceMode: data.sourceMode === "text" || data.sourceMode === "google_drive_link" || data.sourceMode === "instagram_url"
      ? data.sourceMode
      : "upload",
    ...(typeof data.createdAtMs === "number" ? { createdAtMs: data.createdAtMs } : {}),
    ...(typeof data.updatedAtMs === "number" ? { updatedAtMs: data.updatedAtMs } : {}),
    ...(data.attachmentStatus === "pending" || data.attachmentStatus === "clean" || data.attachmentStatus === "blocked" || data.attachmentStatus === "error" || data.attachmentStatus === "not_applicable"
      ? { attachmentStatus: data.attachmentStatus } : {}),
    ...(data.previewStatus === "ready" || data.previewStatus === "not_provided" || data.previewStatus === "queued" || data.previewStatus === "failed"
      ? { previewStatus: data.previewStatus } : {}),
    ...(data.scanStatus === "pending" || data.scanStatus === "clean" || data.scanStatus === "blocked" || data.scanStatus === "error" || data.scanStatus === "not_applicable"
      ? { scanStatus: data.scanStatus }
      : {}),
    ...(data.cleanupState === "pending" || data.cleanupState === "failed" || data.cleanupState === "dead_letter" || data.cleanupState === "completed"
      ? { cleanupState: data.cleanupState }
      : {}),
    ...(typeof data.nextActionReason === "string" ? { nextActionReason: data.nextActionReason } : {}),
    ...(moderationNotice ? { moderationNotice } : {}),
    availableActions: data.status === "withdrawn"
      ? availableActions.filter((action) => action === "restore_private")
      : availableActions,
  };
}

export function parseOwnedSubmissions(value: unknown): OwnedSubmission[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseOwnedSubmission).filter((item): item is OwnedSubmission => item !== null);
}

export function mergeOwnedSubmissionPages(
  current: OwnedSubmission[],
  next: OwnedSubmission[],
): OwnedSubmission[] {
  const byId = new Map(current.map((submission) => [submission.id, submission]));
  next.forEach((submission) => byId.set(submission.id, submission));
  return [...byId.values()].sort((left, right) => {
    const leftDate = left.updatedAtMs ?? left.createdAtMs ?? 0;
    const rightDate = right.updatedAtMs ?? right.createdAtMs ?? 0;
    return rightDate - leftDate || right.id.localeCompare(left.id);
  });
}

export function parseEditableSubmissionDraft(value: unknown): EditableSubmissionDraft {
  if (!value || typeof value !== "object") throw new Error("수정할 내용을 불러오지 못했어요.");
  const data = value as Record<string, unknown>;
  let textContent: EditableSubmissionDraft["textContent"];
  if (data.textContent !== undefined && data.textContent !== null) {
    const text = data.textContent as Record<string, unknown>;
    if (typeof text !== "object" || Array.isArray(text)
      || text.schemaVersion !== 1 || text.format !== "markdown"
      || typeof text.body !== "string" || text.body.length > 50_000) {
      throw new Error("지원하지 않는 본문 형식이에요.");
    }
    textContent = { schemaVersion: 1, format: "markdown", body: text.body };
  }
  if (
    typeof data.id !== "string"
    || (data.status !== "draft" && data.status !== "revision_requested")
    || (data.sourceMode !== "text" && data.sourceMode !== "upload" && data.sourceMode !== "google_drive_link" && data.sourceMode !== "instagram_url")
    || (data.kind !== "활동 기록" && data.kind !== "자료" && data.kind !== "활동 레시피")
    || (data.visibility !== "공개" && data.visibility !== "회원 전용" && data.visibility !== "보류")
  ) throw new Error("지금은 이 내용을 수정할 수 없어요.");
  return {
    id: data.id,
    status: data.status,
    sourceMode: data.sourceMode,
    title: typeof data.title === "string" ? data.title : "",
    kind: data.kind,
    source: typeof data.source === "string" ? data.source : "",
    owner: typeof data.owner === "string" ? data.owner : "",
    visibility: data.visibility,
    attribution: typeof data.attribution === "string" ? data.attribution : "",
    consentBasis: typeof data.consentBasis === "string" ? data.consentBasis : "",
    redistribution: data.redistribution === "view_only" || data.redistribution === "source_link_only"
      ? data.redistribution
      : "download_allowed",
    consentConfirmed: data.consentConfirmed === true,
    sensitiveDataReviewed: data.sensitiveDataReviewed === true,
    ...(typeof data.sourceLinkUrl === "string" ? { sourceLinkUrl: data.sourceLinkUrl } : {}),
    ...(Array.isArray(data.instagramAttachments) ? { instagramAttachments: data.instagramAttachments } : {}),
    ...(data.activity && typeof data.activity === "object" ? { activity: data.activity as Record<string, unknown> } : {}),
    ...(data.recipe && typeof data.recipe === "object" ? { recipe: data.recipe as Record<string, unknown> } : {}),
    existingFileCount: typeof data.existingFileCount === "number" && data.existingFileCount > 0
      ? Math.floor(data.existingFileCount)
      : 0,
    ...(textContent ? { textContent } : {}),
  };
}
