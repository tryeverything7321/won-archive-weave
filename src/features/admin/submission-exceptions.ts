export const submissionExceptionActions = [
  "retry_scan",
  "request_revision",
  "retry_cleanup",
  "retry_publication",
  "dismiss",
] as const;

export type SubmissionExceptionAction = (typeof submissionExceptionActions)[number];

export type SubmissionOperatorException = {
  id: string;
  submissionId: string;
  type: string;
  status: string;
  title: string;
  kind: string;
  sourceMode: "upload" | "google_drive_link" | "instagram_url";
  scanStatus: string;
  cleanupState: string;
  createdAtMs: number;
  nextActions: SubmissionExceptionAction[];
};

const actionSet = new Set<string>(submissionExceptionActions);

export const submissionExceptionActionCopy: Record<
  SubmissionExceptionAction,
  { label: string; pending: string; confirmation: string }
> = {
  retry_scan: {
    label: "파일 재검사 요청",
    pending: "재검사를 요청하고 있어요",
    confirmation: "이 파일의 안전 검사를 다시 요청할까요?",
  },
  request_revision: {
    label: "제출자에게 보완 요청",
    pending: "보완 요청을 보내고 있어요",
    confirmation: "제출자에게 파일이나 내용을 보완해 달라고 요청할까요?",
  },
  retry_cleanup: {
    label: "공개 파일 회수 재시도",
    pending: "파일 회수를 다시 요청하고 있어요",
    confirmation: "남아 있는 공개 파일의 회수를 다시 시도할까요?",
  },
  retry_publication: {
    label: "공개 처리 재시도",
    pending: "공개 처리를 다시 요청하고 있어요",
    confirmation: "검사를 통과한 자료의 공개 처리를 다시 시도할까요?",
  },
  dismiss: {
    label: "확인 완료로 종결",
    pending: "예외를 종결하고 있어요",
    confirmation: "추가 조치 없이 이 예외를 종결할까요?",
  },
};

const exceptionCopy: Record<string, { label: string; description: string; next: string }> = {
  scan_blocked: {
    label: "파일 차단",
    description: "안전 검사에서 위험하거나 허용되지 않는 파일이 발견됐어요.",
    next: "검사 결과를 확인한 뒤 제출자에게 안전한 파일로 바꿔 달라고 안내해 주세요.",
  },
  scan_failed: {
    label: "검사 오류",
    description: "자동 파일 검사가 끝나지 않아 자료가 비공개로 남아 있어요.",
    next: "일시적인 오류라면 재검사를 요청하고, 반복되면 제출자에게 보완을 요청해 주세요.",
  },
  cleanup_failed: {
    label: "파일 회수 재시도 중",
    description: "공개 중단 뒤 일부 파일을 아직 회수하지 못했어요.",
    next: "generation이 바뀌었는지 확인하고 공개 파일 회수를 다시 시도해 주세요.",
  },
  cleanup_dead_letter: {
    label: "파일 회수 수동 조치 필요",
    description: "자동 재시도 한도를 넘어 공개 파일 회수가 멈췄어요.",
    next: "남은 객체와 generation을 직접 확인한 뒤 회수 작업을 다시 시작해 주세요.",
  },
  automatic_publication_failed: {
    label: "자동 공개 실패",
    description: "검사를 통과했지만 공개 사본을 준비하지 못했어요.",
    next: "검사 증거와 파일 generation이 그대로인지 확인한 뒤 공개를 다시 시도해 주세요.",
  },
  manual_publication_failed: {
    label: "공개 처리 실패",
    description: "운영자가 시작한 공개 작업을 끝내지 못했어요.",
    next: "실패 원인을 확인한 뒤 공개 처리를 다시 시도해 주세요.",
  },
  source_verification_required: {
    label: "원본 링크 확인 필요",
    description: "로그아웃 상태에서 원본 링크를 열 수 있는지 확인해야 해요.",
    next: "시크릿 창에서 원본을 확인한 뒤 제출자에게 필요한 보완을 요청해 주세요.",
  },
};

export function submissionExceptionCopy(type: string) {
  return exceptionCopy[type] ?? {
    label: "운영 확인 필요",
    description: "자동으로 처리하지 못한 제출이에요.",
    next: "현재 상태와 서버가 제안한 다음 행동을 확인해 주세요.",
  };
}

function timestampMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const result = value.toMillis();
    return Number.isFinite(result) ? result : 0;
  }
  return 0;
}

export function parseSubmissionOperatorException(value: unknown): SubmissionOperatorException | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.id !== "string" || !data.id || typeof data.submissionId !== "string" || !data.submissionId) return null;
  const sourceMode = data.sourceMode === "google_drive_link" || data.sourceMode === "instagram_url"
    ? data.sourceMode
    : "upload";
  const nextActions = Array.isArray(data.nextActions)
    ? data.nextActions.filter((action): action is SubmissionExceptionAction =>
        typeof action === "string" && actionSet.has(action))
    : [];
  return {
    id: data.id,
    submissionId: data.submissionId,
    type: typeof data.type === "string" ? data.type : "unknown",
    status: typeof data.status === "string" ? data.status : "open",
    title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : "제목 없는 제출",
    kind: typeof data.kind === "string" ? data.kind : "자료",
    sourceMode,
    scanStatus: typeof data.scanStatus === "string" ? data.scanStatus : "pending",
    cleanupState: typeof data.cleanupState === "string" ? data.cleanupState : "not_required",
    createdAtMs: timestampMillis(data.createdAt),
    nextActions,
  };
}

export function mergeSubmissionExceptionPages(
  current: SubmissionOperatorException[],
  incoming: SubmissionOperatorException[],
) {
  const merged = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort(
    (left, right) => right.createdAtMs - left.createdAtMs || right.id.localeCompare(left.id),
  );
}
