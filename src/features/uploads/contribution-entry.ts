export type ContributionKind = "활동 기록" | "자료" | "활동 레시피";
export type ContributionEntryIntent = "activity" | "material";

const defaultKind: ContributionKind = "활동 기록";

export function newContributionKinds(): ContributionKind[] {
  return ["활동 기록", "자료"];
}

export function contributionKindOptions(
  editingSubmissionId: string,
  savedKind: ContributionKind,
): ContributionKind[] {
  return editingSubmissionId ? [savedKind] : newContributionKinds();
}

function entryIntent(value: string | null): ContributionEntryIntent | null {
  return value === "activity" || value === "material" ? value : null;
}

export function readContributionEntry(search: string): {
  submissionId: string;
  initialKind: ContributionKind;
} {
  const params = new URLSearchParams(search);
  const submissionId = params.get("submissionId")?.trim() ?? "";
  if (submissionId) return { submissionId, initialKind: defaultKind };

  return {
    submissionId: "",
    initialKind: entryIntent(params.get("intent")) === "material" ? "자료" : defaultKind,
  };
}

export function contributionReturnTo(search: string, hash: string): string {
  const current = new URLSearchParams(search);
  const safe = new URLSearchParams();
  const submissionId = current.get("submissionId")?.trim() ?? "";
  const intent = entryIntent(current.get("intent"));

  if (submissionId && submissionId.length <= 128 && !/[/?#]/u.test(submissionId)) {
    safe.set("submissionId", submissionId);
  }
  if (intent) safe.set("intent", intent);

  const query = safe.size ? `?${safe.toString()}` : "";
  const safeHash = /^#[\p{L}\p{N}_-]{1,64}$/u.test(hash) ? hash : "";
  return `/contribute${query}${safeHash}`;
}
