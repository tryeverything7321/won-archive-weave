export type CommunityRecordReference = {
  postId: string;
  commentId: string;
};

export type CommunityOwnershipRequest = {
  postIds?: string[];
  comments?: CommunityRecordReference[];
};

export type CommunityOwnershipResponse = {
  postIds: string[];
  comments: CommunityRecordReference[];
  hiddenPostIds: string[];
  hiddenComments: CommunityRecordReference[];
  canManageAll: boolean;
  commentPolicy: "complete";
};

export class CommunityOwnershipCompatibilityError extends Error {
  readonly name = "CommunityOwnershipCompatibilityError";
  readonly code: "hidden-policy-missing" | "invalid-response";

  constructor(code: "hidden-policy-missing" | "invalid-response") {
    super(code === "hidden-policy-missing"
      ? "댓글 숨김 정책 응답이 없습니다"
      : "작성 권한 응답을 확인할 수 없습니다");
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new CommunityOwnershipCompatibilityError(
      label.startsWith("hidden") ? "hidden-policy-missing" : "invalid-response",
    );
  }
  return [...value];
}

function parseCommentArray(value: unknown, label: string): CommunityRecordReference[] {
  if (!Array.isArray(value)) {
    throw new CommunityOwnershipCompatibilityError(
      label.startsWith("hidden") ? "hidden-policy-missing" : "invalid-response",
    );
  }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.postId !== "string" || !item.postId || typeof item.commentId !== "string" || !item.commentId) {
      throw new CommunityOwnershipCompatibilityError("invalid-response");
    }
    return { postId: item.postId, commentId: item.commentId };
  });
}

function commentKey(value: CommunityRecordReference): string {
  return `${value.postId}\u0000${value.commentId}`;
}

export function commentPolicyRequestKey(
  actorUid: string,
  postId: string,
  comments: CommunityRecordReference[],
): string {
  return [actorUid, postId, ...comments.map(commentKey).sort()].join("\u0001");
}

export function parseCommunityOwnershipResponse(
  value: unknown,
  request: CommunityOwnershipRequest,
): CommunityOwnershipResponse {
  if (!isRecord(value)) throw new CommunityOwnershipCompatibilityError("invalid-response");
  if (!("hiddenComments" in value) || !("hiddenPostIds" in value)) {
    throw new CommunityOwnershipCompatibilityError("hidden-policy-missing");
  }

  const postIds = parseStringArray(value.postIds, "postIds");
  const comments = parseCommentArray(value.comments, "comments");
  const hiddenPostIds = parseStringArray(value.hiddenPostIds, "hiddenPostIds");
  const hiddenComments = parseCommentArray(value.hiddenComments, "hiddenComments");
  if (typeof value.canManageAll !== "boolean") {
    throw new CommunityOwnershipCompatibilityError("invalid-response");
  }

  const requestedPosts = new Set(request.postIds ?? []);
  const requestedComments = new Set((request.comments ?? []).map(commentKey));
  if (
    postIds.some((id) => !requestedPosts.has(id)) ||
    hiddenPostIds.some((id) => !requestedPosts.has(id)) ||
    comments.some((item) => !requestedComments.has(commentKey(item))) ||
    hiddenComments.some((item) => !requestedComments.has(commentKey(item)))
  ) {
    throw new CommunityOwnershipCompatibilityError("invalid-response");
  }

  return {
    postIds,
    comments,
    hiddenPostIds,
    hiddenComments,
    canManageAll: value.canManageAll,
    commentPolicy: "complete",
  };
}

export function projectCommentPolicy<T extends { id: string }>(
  comments: T[],
  policy: {
    ownedCommentIds: Set<string>;
    hiddenCommentIds: Set<string> | null;
  },
): { visibleComments: T[]; policyIncomplete: false } {
  if (!policy.hiddenCommentIds) {
    throw new CommunityOwnershipCompatibilityError("hidden-policy-missing");
  }
  return {
    visibleComments: comments.filter((comment) => !policy.hiddenCommentIds?.has(comment.id)),
    policyIncomplete: false,
  };
}
