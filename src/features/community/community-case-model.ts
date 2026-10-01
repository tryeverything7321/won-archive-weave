export const appealStatusCopy: Record<string, string> = {
  received: "접수됨",
  accepted: "수용됨 · 글 복원",
  rejected: "기각됨 · 기존 조치 유지",
};

export function chunkCommunityOwnershipRequests<T>(items: T[], size = 50): T[][] {
  if (!Number.isSafeInteger(size) || size < 1 || size > 50) {
    throw new Error("ownership chunk size must be between 1 and 50");
  }
  return Array.from(
    { length: Math.ceil(items.length / size) },
    (_, index) => items.slice(index * size, (index + 1) * size),
  );
}

export function formatCommunityCaseDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
