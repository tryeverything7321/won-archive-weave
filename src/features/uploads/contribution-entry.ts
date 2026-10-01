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
  calendarEventId: string;
  archiveEventId: string;
  returnTo: string;
} {
  const params = new URLSearchParams(search);
  const submissionId = params.get("submissionId")?.trim() ?? "";
  const rawEventId = (params.get("calendarEventId") ?? params.get("eventId") ?? "").trim();
  const calendarEventId = rawEventId.length <= 120 && !/[/?#]/u.test(rawEventId) ? rawEventId : "";
  const rawArchiveEventId = params.get("archiveEventId")?.trim() ?? "";
  const archiveEventId = rawArchiveEventId.length <= 120 && !/[/?#]/u.test(rawArchiveEventId) ? rawArchiveEventId : "";
  const rawReturnTo = params.get("returnTo")?.trim() ?? "";
  const returnTo = rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//") ? rawReturnTo : "";
  if (submissionId) return { submissionId, initialKind: defaultKind, calendarEventId: archiveEventId ? "" : calendarEventId, archiveEventId, returnTo };

  return {
    submissionId: "",
    initialKind: entryIntent(params.get("intent")) === "material" ? "자료" : defaultKind,
    calendarEventId: archiveEventId ? "" : calendarEventId,
    archiveEventId,
    returnTo,
  };
}

export function contributionReturnTo(search: string, hash: string): string {
  const current = new URLSearchParams(search);
  const safe = new URLSearchParams();
  const submissionId = current.get("submissionId")?.trim() ?? "";
  const intent = entryIntent(current.get("intent"));
  const calendarEventId = (current.get("calendarEventId") ?? current.get("eventId") ?? "").trim();
  const archiveEventId = current.get("archiveEventId")?.trim() ?? "";
  const returnTo = current.get("returnTo")?.trim() ?? "";

  if (submissionId && submissionId.length <= 128 && !/[/?#]/u.test(submissionId)) {
    safe.set("submissionId", submissionId);
  }
  if (intent) safe.set("intent", intent);
  if (archiveEventId && archiveEventId.length <= 120 && !/[/?#]/u.test(archiveEventId)) safe.set("archiveEventId", archiveEventId);
  else if (calendarEventId && calendarEventId.length <= 120 && !/[/?#]/u.test(calendarEventId)) safe.set("calendarEventId", calendarEventId);
  if (returnTo.startsWith("/") && !returnTo.startsWith("//") && returnTo.length <= 500) safe.set("returnTo", returnTo);

  const query = safe.size ? `?${safe.toString()}` : "";
  const safeHash = /^#[\p{L}\p{N}_-]{1,64}$/u.test(hash) ? hash : "";
  return `/contribute${query}${safeHash}`;
}
