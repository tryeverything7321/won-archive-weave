import type { ContributionKind } from "./contribution-entry";
import type { SourceMode } from "./contribution-source";

export type ContributionSession = {
  submissionId: string;
  phase: "draft" | "submitting" | "published";
  draftFingerprint: string;
  createReservation?: {
    requestId: string;
    inputFingerprint: string;
  };
  uploadReservation?: {
    requestId: string;
    selectionFingerprint: string;
  };
};

export type ContributionAttempt = { revision: number; uid: string };

export type ContributionUploadDescriptor = {
  name: string;
  size: number;
  contentType: string;
  sha256: string;
};

export function createContributionSession(submissionId = "", draftFingerprint = ""): ContributionSession {
  return { submissionId, phase: "draft", draftFingerprint };
}

export async function beginContributionSession(
  session: ContributionSession,
  createDraft: () => Promise<string>,
  draftFingerprint = session.draftFingerprint,
): Promise<ContributionSession> {
  const submissionId = session.submissionId || await createDraft();
  return { ...session, submissionId, phase: "submitting", draftFingerprint };
}

export function retryContributionSession(session: ContributionSession): ContributionSession {
  return { ...session, phase: "draft" };
}

export function markContributionPublished(session: ContributionSession): ContributionSession {
  return { ...session, phase: "published" };
}

export function resetContributionSession(session?: ContributionSession): ContributionSession {
  return !session || session.phase === "published" ? createContributionSession() : session;
}

export function contributionAttemptIsCurrent(
  attempt: ContributionAttempt,
  revision: number,
  uid: string | undefined,
): boolean {
  return attempt.revision === revision && attempt.uid === uid;
}

export function contributionUploadSelectionFingerprint(files: ContributionUploadDescriptor[]): string {
  return JSON.stringify(files);
}

export function reserveContributionCreation(
  session: ContributionSession,
  inputFingerprint: string,
  createRequestId: () => string,
): ContributionSession {
  if (session.createReservation) return session;
  return {
    ...session,
    createReservation: { requestId: createRequestId(), inputFingerprint },
  };
}

export function restoreContributionCreation(
  session: ContributionSession,
  reservation: { requestId: string; inputFingerprint: string },
): ContributionSession {
  if (session.submissionId || session.createReservation) return session;
  return { ...session, createReservation: { ...reservation } };
}

export function contributionCreationNeedsDraftUpdate(
  session: ContributionSession,
  currentInputFingerprint: string,
): boolean {
  return Boolean(
    session.createReservation
    && session.createReservation.inputFingerprint !== currentInputFingerprint,
  );
}

export function contributionUploadDecision(result: { complete: boolean }): "skip" | "upload" {
  return result.complete ? "skip" : "upload";
}

export function reserveContributionUploads(
  session: ContributionSession,
  selectionFingerprint: string,
  createRequestId: () => string,
): ContributionSession {
  return session.uploadReservation?.selectionFingerprint === selectionFingerprint
    ? session
    : {
        ...session,
        uploadReservation: { requestId: createRequestId(), selectionFingerprint },
      };
}

export function contributionDraftFingerprint(
  submissionFingerprint: string,
  selectionFingerprint = "",
): string {
  return JSON.stringify([submissionFingerprint, selectionFingerprint]);
}

export function contributionDraftMatches(session: ContributionSession, fingerprint: string): boolean {
  return session.draftFingerprint === fingerprint;
}

export function contributionSuccessPath(kind: ContributionKind, session: ContributionSession): string {
  if (session.phase !== "published" || !session.submissionId) return "";
  const collection = kind === "자료" ? "materials" : "activities";
  return `/${collection}/${encodeURIComponent(session.submissionId)}`;
}

export function contributionSuccessMessage(sourceMode: SourceMode, status: string): string {
  if (status !== "published") {
    return "내용을 보관했어요. 내 게시물 관리에서 상태를 확인할 수 있어요.";
  }
  return sourceMode === "upload"
    ? "내용을 올렸어요. 첨부 파일은 안전 확인이 끝난 뒤 열립니다."
    : "내용을 올렸어요. 위브에서 바로 확인할 수 있어요.";
}
