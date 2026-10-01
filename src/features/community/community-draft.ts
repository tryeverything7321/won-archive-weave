import type { DraftCaptureResult, DraftCodec, DraftIdentity } from "../drafts/draft-store";

const communityPurposes = new Set([
  "생각 나눔",
  "질문",
  "경험과 노하우",
  "도움 요청",
  "함께할 사람 찾기",
]);

export type CommunityArticleDraft = {
  purpose: "생각 나눔" | "질문" | "경험과 노하우" | "도움 요청" | "함께할 사람 찾기";
  topic: string;
  body: string;
};

export type CommunityReplyDraft = { body: string };

export type CommunityDraftAttempt = {
  identity: DraftIdentity;
  generation: number;
};

type CommunityDraftScope =
  | { ownerId: string; mode: "article" }
  | { ownerId: string; mode: "reply" | "post-edit"; postId: string }
  | { ownerId: string; mode: "comment-edit"; postId: string; commentId: string };

function boundedPart(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120;
}

export function communityDraftIdentity(scope: CommunityDraftScope): DraftIdentity {
  if (!boundedPart(scope.ownerId)) throw new Error("invalid community draft identity");
  if (scope.mode === "article") {
    return { ownerId: scope.ownerId, kind: "community-article", documentId: "new" };
  }
  if (!boundedPart(scope.postId)) throw new Error("invalid community draft identity");
  if (scope.mode === "reply") {
    return { ownerId: scope.ownerId, kind: "community-reply", documentId: scope.postId };
  }
  if (scope.mode === "post-edit") {
    return { ownerId: scope.ownerId, kind: "community-post-edit", documentId: scope.postId };
  }
  if (scope.mode === "comment-edit" && boundedPart(scope.commentId)) {
    return {
      ownerId: scope.ownerId,
      kind: "community-comment-edit",
      documentId: `${scope.postId}:${scope.commentId}`,
    };
  }
  throw new Error("invalid community draft identity");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid community draft value");
  return value as Record<string, unknown>;
}

function articleValue(value: unknown): CommunityArticleDraft {
  const source = record(value);
  if (
    typeof source.purpose !== "string"
    || !communityPurposes.has(source.purpose)
    || typeof source.topic !== "string"
    || source.topic.length > 80
    || typeof source.body !== "string"
    || source.body.length > 2_000
  ) throw new Error("invalid community draft value");
  return {
    purpose: source.purpose as CommunityArticleDraft["purpose"],
    topic: source.topic,
    body: source.body,
  };
}

function replyValue(value: unknown): CommunityReplyDraft {
  const source = record(value);
  if (typeof source.body !== "string" || source.body.length > 800) {
    throw new Error("invalid community draft value");
  }
  return { body: source.body };
}

export const communityArticleDraftCodec: DraftCodec<CommunityArticleDraft> = {
  encode: articleValue,
  decode: articleValue,
};

export const communityReplyDraftCodec: DraftCodec<CommunityReplyDraft> = {
  encode: replyValue,
  decode: replyValue,
};

export function capturedCommunityDraftRevision(result: DraftCaptureResult | undefined): string | null {
  return result && (result.status === "saved" || result.status === "unchanged") && result.revision
    ? result.revision
    : null;
}

export function communityDraftSubmissionCapture(result: DraftCaptureResult | undefined): {
  revision: string | null;
  localSaveUnavailable: boolean;
} {
  const revision = capturedCommunityDraftRevision(result);
  return { revision, localSaveUnavailable: revision === null };
}

export function communityDraftAttemptIsCurrent(
  submitted: CommunityDraftAttempt,
  current: CommunityDraftAttempt | null,
): boolean {
  return Boolean(
    current
    && submitted.generation === current.generation
    && submitted.identity.ownerId === current.identity.ownerId
    && submitted.identity.kind === current.identity.kind
    && submitted.identity.documentId === current.identity.documentId,
  );
}
