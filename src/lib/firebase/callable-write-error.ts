type WriteTarget = "행사" | "커뮤니티 글" | "자료·기록" | "댓글";

function errorFields(error: unknown): { code: string; message: string } {
  if (!error || typeof error !== "object") return { code: "", message: "" };
  const record = error as { code?: unknown; message?: unknown };
  return {
    code: typeof record.code === "string" ? record.code.replace(/^functions\//u, "") : "",
    message: typeof record.message === "string" ? record.message.trim() : "",
  };
}

export function callableWriteErrorMessage(error: unknown, target: WriteTarget): string {
  const { code, message } = errorFields(error);
  if (code === "resource-exhausted") {
    const seconds = error && typeof error === "object" && "details" in error
      ? Number((error.details as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds) : NaN;
    return Number.isFinite(seconds) && seconds > 0 && seconds <= 86400
      ? `등록 요청이 많아요. ${Math.ceil(seconds)}초 뒤 다시 시도해 주세요.`
      : "등록 요청이 많아요. 잠시 기다린 뒤 다시 시도해 주세요.";
  }
  if (code === "unauthenticated") return "로그인이 만료되었어요. 다시 로그인한 뒤 저장해 주세요.";
  if (code === "permission-denied") return "이 내용을 저장할 권한이 없어요. 계정과 공개 범위를 확인해 주세요.";
  if (code === "already-exists") return `${target}이 이미 저장되었을 수 있어요. 내 위브에서 확인한 뒤 다시 시도해 주세요.`;
  if (code === "unavailable" || code === "deadline-exceeded") {
    return `연결이 끊겨 저장 결과를 확인하지 못했어요. 내 위브에서 ${target}이 등록됐는지 먼저 확인해 주세요.`;
  }
  if ((code === "invalid-argument" || code === "failed-precondition")
      && /[가-힣]/u.test(message) && message.length <= 160) {
    return message;
  }
  return `${target}을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요. 계속되면 운영자에게 알려 주세요.`;
}
