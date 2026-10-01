import { callableWriteErrorMessage } from "../../lib/firebase/callable-write-error";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Ban,
  Flag,
  EyeOff,
  LoaderCircle,
  MessageCircleMore,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { getFirebaseServices } from "../../lib/firebase/client";
import { communityApi, communityPostPurposes, type CommunityPostPurpose } from "./api";
import { chunkCommunityOwnershipRequests } from "./community-case-model";
import { DraftRecoveryPanel } from "../drafts/DraftRecoveryPanel";
import { useFormDraft } from "../drafts/useFormDraft";
import {
  communityArticleDraftCodec,
  communityDraftAttemptIsCurrent,
  communityDraftIdentity,
  communityReplyDraftCodec,
  communityDraftSubmissionCapture,
  type CommunityArticleDraft,
  type CommunityReplyDraft,
} from "./community-draft";
import {
  commentPolicyRequestKey,
  CommunityOwnershipCompatibilityError,
  projectCommentPolicy,
} from "./comment-policy-recovery";
import { ProviderBadge } from "./ProviderBadge";
import { createModerationRequestTracker } from "./moderation-request";
import { parseCommunityLoginProvider, type CommunityLoginProvider } from "./provider";

type Services = NonNullable<ReturnType<typeof getFirebaseServices>>;

export type CommunityPostView = {
  id: string;
  body: string;
  topic?: string;
  purpose: CommunityPostPurpose;
  pseudonym: string;
  provider?: CommunityLoginProvider;
  commentCount: number;
  createdAtMs: number;
};

type CommentView = {
  id: string;
  body: string;
  pseudonym: string;
  provider?: CommunityLoginProvider;
  createdAtMs: number;
};

type ReportTarget = { type: "post" | "comment"; id: string; pseudonym: string };

const commentPageSize = 30;

function formatDate(value: number) {
  if (!value) return "방금 전";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function commentView(item: QueryDocumentSnapshot<DocumentData>): CommentView {
  const data = item.data();
  return {
    id: item.id,
    body: String(data.body ?? ""),
    pseudonym: String(data.pseudonym ?? ""),
    provider: parseCommunityLoginProvider(data.provider),
    createdAtMs:
      typeof data.createdAt?.toMillis === "function"
        ? Number(data.createdAt.toMillis())
        : 0,
  };
}

const reportCategories = [
  ["personal_data", "개인정보 노출"],
  ["harassment", "괴롭힘 또는 혐오"],
  ["crisis", "위기 우려"],
  ["rights", "권리 문제"],
  ["spam", "스팸 또는 사기"],
  ["other", "기타"],
] as const;

function ReportDialog({
  postId,
  target,
  onClose,
  onComplete,
}: {
  postId: string;
  target: ReportTarget;
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [category, setCategory] =
    useState<(typeof reportCategories)[number][0]>("harassment");
  const [details, setDetails] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const result = await communityApi.report({
        targetType: target.type,
        targetId: target.id,
        postId: target.type === "comment" ? postId : undefined,
        category,
        details,
      });
      onComplete(
        result.urgent
          ? "신고를 접수했어요. 안전과 관련된 내용은 운영자가 우선 확인해요."
          : "신고를 접수했어요. 운영자가 내용을 확인한 뒤 필요한 조치를 진행해요.",
      );
    } catch {
      setError("신고를 접수하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="community-report-dialog"
      aria-labelledby="community-report-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form method="dialog" onSubmit={submit}>
        <div className="community-report-heading">
          <div>
            <h2 id="community-report-title">이 내용을 신고할까요</h2>
            <p>
              {target.pseudonym}의 {target.type === "post" ? "글" : "댓글"}을
              운영자에게 전달합니다.
            </p>
          </div>
          <button type="button" aria-label="신고 창 닫기" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <label>
          <span>신고 이유</span>
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as typeof category)
            }
          >
            {reportCategories.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>운영자에게 전할 내용</span>
          <textarea
            maxLength={500}
            aria-describedby="report-details-length"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="확인에 필요한 맥락이 있다면 적어 주세요"
          />
        </label>
        <small id="report-details-length">선택 입력 · 최대 500자 · 현재 {details.length}자</small>
        <p>개인정보 노출과 위기 우려 신고는 운영자가 우선 확인합니다.</p>
        {error && <p role="alert">{error}</p>}
        <div>
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            취소
          </button>
          <button
            className="button button-primary"
            disabled={working}
            type="submit"
          >
            {working && <LoaderCircle className="spin" size={17} />} 신고 접수
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function PostThread({
  post,
  services,
  actorUid,
  ownsPost,
  isAdministrator,
  ownershipLoading,
  ownershipUnavailable,
  topics,
  onBlockComplete,
}: {
  post: CommunityPostView;
  services: Services;
  actorUid: string;
  ownsPost: boolean;
  isAdministrator: boolean;
  ownershipLoading: boolean;
  ownershipUnavailable: boolean;
  topics: readonly string[];
  onBlockComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [recentComments, setRecentComments] = useState<CommentView[]>([]);
  const [olderComments, setOlderComments] = useState<CommentView[]>([]);
  const [oldestCursor, setOldestCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasOlderComments, setHasOlderComments] = useState(false);
  const [loadingOlderComments, setLoadingOlderComments] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [body, setBody] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [moderationOpen, setModerationOpen] = useState(false);
  const [moderationCommentId, setModerationCommentId] = useState<string | null>(null);
  const moderationRequests = useMemo(() => createModerationRequestTracker(), []);
  const [moderationReason, setModerationReason] = useState("");
  const [moderationAction, setModerationAction] = useState<'warn' | 'request_correction' | 'hold' | 'remove'>('warn');
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [editingPost, setEditingPost] = useState(false);
  const [postDraft, setPostDraft] = useState(post.body);
  const [postPurposeDraft, setPostPurposeDraft] = useState<CommunityPostPurpose>(post.purpose);
  const [postTopicDraft, setPostTopicDraft] = useState(post.topic ?? "");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [ownedCommentIds, setOwnedCommentIds] = useState<Set<string>>(() => new Set());
  const [hiddenCommentIds, setHiddenCommentIds] = useState<Set<string> | null>(null);
  const [commentPolicyKey, setCommentPolicyKey] = useState("");
  const [commentPolicyError, setCommentPolicyError] = useState<"compatibility" | "request" | null>(null);
  const [commentPolicyRetry, setCommentPolicyRetry] = useState(0);
  const editingPostRef = useRef(editingPost);
  const editingCommentIdRef = useRef(editingCommentId);
  const postEditGenerationRef = useRef(0);
  const commentEditGenerationRef = useRef(0);
  const replyDraftValue = useMemo<CommunityReplyDraft>(() => ({ body }), [body]);
  const replyDraftValueRef = useRef(replyDraftValue);
  const replyDraftIdentity = useMemo(
    () => communityDraftIdentity({ ownerId: actorUid, mode: "reply", postId: post.id }),
    [actorUid, post.id],
  );
  const replyDraft = useFormDraft({
    identity: replyDraftIdentity,
    value: replyDraftValue,
    codec: communityReplyDraftCodec,
    onRestore: (restored) => setBody(restored.body),
  });
  const postEditDraftValue = useMemo<CommunityArticleDraft>(() => ({
    purpose: postPurposeDraft,
    topic: postTopicDraft,
    body: postDraft,
  }), [postDraft, postPurposeDraft, postTopicDraft]);
  const postEditDraftValueRef = useRef(postEditDraftValue);
  const postEditDraftIdentity = useMemo(
    () => communityDraftIdentity({ ownerId: actorUid, mode: "post-edit", postId: post.id }),
    [actorUid, post.id],
  );
  const postEditDraft = useFormDraft({
    identity: postEditDraftIdentity,
    value: postEditDraftValue,
    codec: communityArticleDraftCodec,
    active: editingPost,
    onRestore: (restored) => {
      setPostPurposeDraft(restored.purpose);
      setPostTopicDraft(restored.topic);
      setPostDraft(restored.body);
    },
  });
  const commentEditDraftValue = useMemo<CommunityReplyDraft>(
    () => ({ body: commentDraft }),
    [commentDraft],
  );
  const commentEditDraftValueRef = useRef(commentEditDraftValue);
  const commentEditDraftIdentity = useMemo(
    () => communityDraftIdentity({
      ownerId: actorUid,
      mode: "comment-edit",
      postId: post.id,
      commentId: editingCommentId ?? "inactive",
    }),
    [actorUid, editingCommentId, post.id],
  );
  const commentEditDraft = useFormDraft({
    identity: commentEditDraftIdentity,
    value: commentEditDraftValue,
    codec: communityReplyDraftCodec,
    active: editingCommentId !== null,
    onRestore: (restored) => setCommentDraft(restored.body),
  });
  useLayoutEffect(() => {
    editingPostRef.current = editingPost;
    editingCommentIdRef.current = editingCommentId;
    replyDraftValueRef.current = replyDraftValue;
    postEditDraftValueRef.current = postEditDraftValue;
    commentEditDraftValueRef.current = commentEditDraftValue;
  }, [commentEditDraftValue, editingCommentId, editingPost, postEditDraftValue, replyDraftValue]);
  const comments = useMemo(() => {
    const unique = new Map<string, CommentView>();
    [...recentComments, ...olderComments].forEach((comment) => unique.set(comment.id, comment));
    return [...unique.values()].sort((a, b) => a.createdAtMs - b.createdAtMs);
  }, [olderComments, recentComments]);
  const commentPolicyGeneration = useMemo(
    () => commentPolicyRequestKey(actorUid, post.id, comments.map((comment) => ({
      postId: post.id,
      commentId: comment.id,
    }))),
    [actorUid, comments, post.id],
  );
  const visibleComments = useMemo(
    () => hiddenCommentIds
      ? projectCommentPolicy(comments, { ownedCommentIds, hiddenCommentIds }).visibleComments
      : [],
    [comments, hiddenCommentIds, ownedCommentIds],
  );
  const commentPolicyLoading = Boolean(comments.length) && commentPolicyKey !== commentPolicyGeneration;

  useEffect(() => {
    if (!comments.length) return;
    let active = true;
    const candidates = comments.map((comment) => ({
      postId: post.id,
      commentId: comment.id,
    }));
    const chunks = chunkCommunityOwnershipRequests(candidates);
    void Promise.all(chunks.map((chunk) => communityApi.ownership({ comments: chunk })))
      .then((results) => {
        if (active) {
          setOwnedCommentIds(new Set(results.flatMap((result) => result.comments.map((item) => item.commentId))));
          setHiddenCommentIds(new Set(results.flatMap((result) => result.hiddenComments.map((item) => item.commentId))));
          setCommentPolicyKey(commentPolicyGeneration);
          setCommentPolicyError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setOwnedCommentIds(new Set());
          setHiddenCommentIds(null);
          setCommentPolicyKey(commentPolicyGeneration);
          setCommentPolicyError(error instanceof CommunityOwnershipCompatibilityError ? "compatibility" : "request");
        }
      });
    return () => {
      active = false;
    };
  }, [commentPolicyGeneration, commentPolicyRetry, comments, post.id]);

  useEffect(() => {
    if (!open) return undefined;
    return onSnapshot(
      query(
        collection(services.firestore, "communityPosts", post.id, "comments"),
        where("status", "==", "active"),
        orderBy("createdAt", "desc"),
        limit(commentPageSize),
      ),
      (snapshot) => {
        setRecentComments(snapshot.docs.map(commentView));
        setOldestCursor(snapshot.docs.at(-1) ?? null);
        setHasOlderComments(snapshot.size === commentPageSize);
        setCommentsLoading(false);
      },
      () => {
        setCommentsLoading(false);
        setNotice("댓글을 불러오지 못했어요. 댓글 영역을 닫았다가 다시 열어 주세요.");
      },
    );
  }, [open, post.id, services.firestore]);

  const loadOlderComments = async () => {
    if (!oldestCursor || loadingOlderComments) return;
    setLoadingOlderComments(true);
    setNotice("");
    try {
      const snapshot = await getDocs(
        query(
          collection(services.firestore, "communityPosts", post.id, "comments"),
          where("status", "==", "active"),
          orderBy("createdAt", "desc"),
          startAfter(oldestCursor),
          limit(commentPageSize),
        ),
      );
      setOlderComments((current) => [...current, ...snapshot.docs.map(commentView)]);
      setOldestCursor(snapshot.docs.at(-1) ?? oldestCursor);
      setHasOlderComments(snapshot.size === commentPageSize);
    } catch {
      setNotice("이전 댓글을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setLoadingOlderComments(false);
    }
  };

  const toggleComments = () => {
    if (open) {
      setRecentComments([]);
      setOlderComments([]);
      setOldestCursor(null);
      setHasOlderComments(false);
      setCommentsLoading(false);
      setOwnedCommentIds(new Set());
      setHiddenCommentIds(null);
      setCommentPolicyKey("");
      setCommentPolicyError(null);
    } else {
      setCommentsLoading(true);
    }
    setOpen((value) => !value);
  };

  const createComment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedValue = { ...replyDraftValueRef.current };
    const submissionCapture = communityDraftSubmissionCapture(replyDraft.capture());
    setWorking(true);
    setNotice(submissionCapture.localSaveUnavailable
      ? "이 기기의 임시저장을 확인하지 못했지만 댓글 등록을 계속하고 있어요."
      : "");
    try {
      await communityApi.createComment({ postId: post.id, body: submittedValue.body });
      const completed = submissionCapture.revision
        ? replyDraft.complete(submissionCapture.revision, { body: "" })
        : "unavailable";
      if (completed === "cleared" && replyDraftValueRef.current.body === submittedValue.body) {
        setBody("");
      }
      setNotice(submissionCapture.localSaveUnavailable
        ? "댓글을 남겼어요. 이 기기의 임시저장은 지우지 않았어요."
        : "댓글을 남겼어요");
    } catch (error) {
      setNotice(callableWriteErrorMessage(error, "댓글") + (submissionCapture.localSaveUnavailable ? " 내용을 복사해 보관해 주세요." : ""));
    } finally {
      setWorking(false);
    }
  };

  const savePost = async () => {
    if (postDraft.trim().length < 2) return;
    const submittedAttempt = {
      identity: postEditDraftIdentity,
      generation: postEditGenerationRef.current,
    };
    const submittedValue = { ...postEditDraftValueRef.current, body: postEditDraftValueRef.current.body.trim() };
    const submissionCapture = communityDraftSubmissionCapture(postEditDraft.capture());
    setWorking(true);
    setNotice(submissionCapture.localSaveUnavailable
      ? "이 기기의 임시저장을 확인하지 못했지만 글 수정을 계속하고 있어요."
      : "");
    try {
      await communityApi.editPost({
        postId: post.id,
        body: submittedValue.body,
        purpose: submittedValue.purpose,
        topic: submittedValue.topic || null,
      });
      const current = postEditDraftValueRef.current;
      const completionIsCurrent = communityDraftAttemptIsCurrent(
        submittedAttempt,
        editingPostRef.current
          ? { identity: postEditDraftIdentity, generation: postEditGenerationRef.current }
          : null,
      );
      const completed = completionIsCurrent && submissionCapture.revision
        ? postEditDraft.complete(submissionCapture.revision)
        : "unavailable";
      if (
        completed === "cleared"
        && current.body.trim() === submittedValue.body
        && current.topic === submittedValue.topic
        && current.purpose === submittedValue.purpose
      ) {
        setWorking(false);
        editingPostRef.current = false;
        setEditingPost(false);
      }
      if (completionIsCurrent) {
        setNotice(submissionCapture.localSaveUnavailable
          ? "글을 수정했어요. 이 기기의 임시저장은 지우지 않았어요."
          : "글을 수정했어요.");
      }
    } catch {
      const completionIsCurrent = communityDraftAttemptIsCurrent(
        submittedAttempt,
        editingPostRef.current
          ? { identity: postEditDraftIdentity, generation: postEditGenerationRef.current }
          : null,
      );
      if (completionIsCurrent) {
        setNotice(submissionCapture.localSaveUnavailable
          ? "글을 수정하지 못했고 이 기기의 임시저장도 확인하지 못했어요. 내용을 복사한 뒤 다시 시도해 주세요."
          : "글을 수정하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      }
    } finally {
      if (communityDraftAttemptIsCurrent(
        submittedAttempt,
        editingPostRef.current
          ? { identity: postEditDraftIdentity, generation: postEditGenerationRef.current }
          : null,
      )) setWorking(false);
    }
  };

  const removePost = async () => {
    if (!window.confirm("이 글과 댓글을 삭제할까요? 삭제한 글은 되돌릴 수 없어요.")) return;
    setWorking(true);
    setNotice("");
    try {
      await communityApi.deletePost({ postId: post.id });
    } catch {
      setNotice("글을 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      setWorking(false);
    }
  };

  const hidePost = async () => {
    if (working || moderationReason.trim().length < 2) return;
    if (!window.confirm("작성자에게 입력한 사유를 전달하고 선택한 조치를 실행할까요?")) return;
    setWorking(true);
    setNotice("");
    try {
      const input = {
        postId: post.id,
        action: moderationAction,
        reason: moderationReason.trim(),
        requestId: moderationRequests.idFor(JSON.stringify([post.id, moderationCommentId, moderationAction, moderationReason.trim()])),
      };
      if (moderationCommentId) await communityApi.moderateComment({ ...input, commentId: moderationCommentId });
      else await communityApi.moderatePost(input);
      moderationRequests.clear();
      setNotice("작성자에게 안내하고 운영 조치를 기록했어요.");
      setModerationOpen(false);
      setModerationReason("");
    } catch {
      setNotice("조치를 완료하지 못했어요. 삭제 전 안내가 필요한지 확인하고 다시 시도해 주세요.");
    } finally {
      setWorking(false);
    }
  };

  const beginCommentEdit = (comment: CommentView) => {
    commentEditGenerationRef.current += 1;
    editingCommentIdRef.current = comment.id;
    setWorking(false);
    setEditingCommentId(comment.id);
    setCommentDraft(comment.body);
  };

  const cancelCommentEdit = () => {
    editingCommentIdRef.current = null;
    setWorking(false);
    setEditingCommentId(null);
  };

  const saveComment = async (commentId: string) => {
    if (commentDraft.trim().length < 2) return;
    const submittedAttempt = {
      identity: commentEditDraftIdentity,
      generation: commentEditGenerationRef.current,
    };
    const submittedValue = { body: commentEditDraftValueRef.current.body.trim() };
    const submissionCapture = communityDraftSubmissionCapture(commentEditDraft.capture());
    setWorking(true);
    setNotice(submissionCapture.localSaveUnavailable
      ? "이 기기의 임시저장을 확인하지 못했지만 댓글 수정을 계속하고 있어요."
      : "");
    try {
      await communityApi.editComment({ postId: post.id, commentId, body: submittedValue.body });
      const applyEdit = (comment: CommentView) =>
        comment.id === commentId ? { ...comment, body: submittedValue.body } : comment;
      setRecentComments((current) => current.map(applyEdit));
      setOlderComments((current) => current.map(applyEdit));
      const currentCommentId = editingCommentIdRef.current;
      const completionIsCurrent = communityDraftAttemptIsCurrent(
        submittedAttempt,
        currentCommentId
          ? {
              identity: communityDraftIdentity({
                ownerId: actorUid,
                mode: "comment-edit",
                postId: post.id,
                commentId: currentCommentId,
              }),
              generation: commentEditGenerationRef.current,
            }
          : null,
      );
      const completed = completionIsCurrent && submissionCapture.revision
        ? commentEditDraft.complete(submissionCapture.revision, { body: "" })
        : "unavailable";
      if (completed === "cleared" && commentEditDraftValueRef.current.body.trim() === submittedValue.body) {
        setWorking(false);
        editingCommentIdRef.current = null;
        setEditingCommentId(null);
        setCommentDraft("");
      }
      if (completionIsCurrent) {
        setNotice(submissionCapture.localSaveUnavailable
          ? "댓글을 수정했어요. 이 기기의 임시저장은 지우지 않았어요."
          : "댓글을 수정했어요.");
      }
    } catch {
      const currentCommentId = editingCommentIdRef.current;
      if (communityDraftAttemptIsCurrent(
        submittedAttempt,
        currentCommentId
          ? {
              identity: communityDraftIdentity({ ownerId: actorUid, mode: "comment-edit", postId: post.id, commentId: currentCommentId }),
              generation: commentEditGenerationRef.current,
            }
          : null,
      )) {
        setNotice(submissionCapture.localSaveUnavailable
          ? "댓글을 수정하지 못했고 이 기기의 임시저장도 확인하지 못했어요. 내용을 복사한 뒤 다시 시도해 주세요."
          : "댓글을 수정하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      }
    } finally {
      const currentCommentId = editingCommentIdRef.current;
      if (communityDraftAttemptIsCurrent(
        submittedAttempt,
        currentCommentId
          ? {
              identity: communityDraftIdentity({ ownerId: actorUid, mode: "comment-edit", postId: post.id, commentId: currentCommentId }),
              generation: commentEditGenerationRef.current,
            }
          : null,
      )) setWorking(false);
    }
  };

  const removeComment = async (commentId: string) => {
    if (!window.confirm("이 댓글을 삭제할까요? 삭제한 댓글은 되돌릴 수 없어요.")) return;
    setWorking(true);
    setNotice("");
    try {
      await communityApi.deleteComment({ postId: post.id, commentId });
      setRecentComments((current) => current.filter((comment) => comment.id !== commentId));
      setOlderComments((current) => current.filter((comment) => comment.id !== commentId));
      setOwnedCommentIds((current) => {
        const next = new Set(current);
        next.delete(commentId);
        return next;
      });
      setNotice("댓글을 삭제했어요.");
    } catch {
      setNotice("댓글을 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setWorking(false);
    }
  };

  const blockAuthor = async (targetType: "post" | "comment", targetId: string) => {
    if (!window.confirm("이 이용자의 글과 댓글을 서로 보이지 않게 할까요? 내 운영 알림에서 다시 해제할 수 있어요.")) return;
    setWorking(true);
    setNotice("");
    try {
      await communityApi.blockAuthor({
        targetType,
        targetId,
        ...(targetType === "comment" ? { postId: post.id } : {}),
      });
      setNotice("이 이용자를 숨겼어요. 서로의 글과 댓글에서 상호작용할 수 없어요.");
      onBlockComplete();
      if (targetType === "comment") {
        setHiddenCommentIds((current) => current ? new Set(current).add(targetId) : null);
      }
    } catch {
      setNotice("이 이용자를 숨기지 못했어요. 이미 숨긴 이용자인지 확인해 주세요.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <article className="community-post">
      <div>
        <div className="community-post-classification">
          <span className="community-purpose-label">{post.purpose}</span>
          {post.topic && <span>{post.topic}</span>}
        </div>
        <div className="community-item-actions">
          {ownershipLoading || ownershipUnavailable ? (
            <button
              type="button"
              disabled
              aria-label={ownershipLoading ? "작성 권한 확인 중" : "작성 권한을 확인하지 못함"}
            >
              <LoaderCircle className={ownershipLoading ? "spin" : undefined} size={15} aria-hidden="true" />
            </button>
          ) : ownsPost || isAdministrator ? (
            <>
              <button
                type="button"
                className="owner-icon-action"
                aria-label="글 수정"
                title="글 수정"
                onClick={() => {
                  postEditGenerationRef.current += 1;
                  editingPostRef.current = true;
                  setWorking(false);
                  setPostDraft(post.body);
                  setPostPurposeDraft(post.purpose);
                  setPostTopicDraft(post.topic ?? "");
                  setEditingPost(true);
                }}
              >
                <Pencil size={18} aria-hidden="true" />
              </button>
              <button type="button" className="owner-icon-action owner-icon-action-danger" aria-label="글 삭제" title="글 삭제" onClick={() => { if (isAdministrator && !ownsPost) { setModerationCommentId(null); setModerationReason(''); moderationRequests.clear(); setModerationAction('remove'); setModerationOpen(true); } else { void removePost(); } }}>
                <Trash2 size={18} aria-hidden="true" />
              </button>
              {isAdministrator && (
                <button type="button" aria-label="관리자 안내 및 조치" onClick={() => { setModerationCommentId(null); setModerationOpen((value) => !value); }}>
                  <EyeOff size={15} />
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" aria-label={`${post.pseudonym} 숨기기`} onClick={() => void blockAuthor("post", post.id)}>
                <Ban size={16} />
              </button>
              <button
                type="button"
                aria-label={`${post.pseudonym}의 글 신고`}
                onClick={() =>
                  setReportTarget({ type: "post", id: post.id, pseudonym: post.pseudonym })
                }
              >
                <Flag size={16} />
              </button>
            </>
          )}
        </div>
      </div>
      {moderationOpen && isAdministrator && (
        <form className="community-inline-editor" onSubmit={(event) => { event.preventDefault(); void hidePost(); }}>
          <strong>{moderationCommentId ? "댓글 운영 안내" : "글 운영 안내"}</strong>
          <label>운영 조치
            <select value={moderationAction} onChange={(event) => setModerationAction(event.target.value as typeof moderationAction)}>
              <option value="warn">안내만 보내기</option>
              <option value="request_correction">수정 요청하기</option>
              <option value="hold">긴급 임시 숨김</option>
              <option value="remove">안내한 글 삭제</option>
            </select>
          </label>
          <label>작성자에게 전달할 사유
            <textarea required minLength={2} maxLength={300} value={moderationReason} onChange={(event) => setModerationReason(event.target.value)} />
          </label>
          <p>일반적인 문제는 먼저 안내하거나 수정을 요청해 주세요. 개인정보 노출 등 긴급한 경우에는 먼저 숨길 수 있어요.</p>
          <button type="submit" disabled={working || moderationReason.trim().length < 2}>안내하고 실행</button>
          <button type="button" onClick={() => { setModerationOpen(false); setModerationCommentId(null); setModerationReason(''); moderationRequests.clear(); }}>취소</button>
        </form>
      )}
      {editingPost ? (
        <div className="community-inline-editor">
          <DraftRecoveryPanel
            state={postEditDraft.state}
            recovery={postEditDraft.recovery}
            onContinue={postEditDraft.continueDraft}
            onStartNew={() => {
              postEditDraft.startNew({
                body: post.body,
                purpose: post.purpose,
                topic: post.topic ?? "",
              });
              setPostDraft(post.body);
              setPostPurposeDraft(post.purpose);
              setPostTopicDraft(post.topic ?? "");
            }}
            onDelete={() => {
              postEditDraft.deleteDraft({
                body: post.body,
                purpose: post.purpose,
                topic: post.topic ?? "",
              });
              setPostDraft(post.body);
              setPostPurposeDraft(post.purpose);
              setPostTopicDraft(post.topic ?? "");
            }}
            onRetry={postEditDraft.retry}
          />
          <div className="community-inline-classification">
            <label>
              <span>글의 성격</span>
              <select
                value={postPurposeDraft}
                onChange={(event) => setPostPurposeDraft(event.target.value as CommunityPostPurpose)}
              >
                {communityPostPurposes.map((purpose) => <option key={purpose}>{purpose}</option>)}
              </select>
            </label>
            <label>
              <span>관심 주제 <small>선택</small></span>
              <select value={postTopicDraft} onChange={(event) => setPostTopicDraft(event.target.value)}>
                <option value="">선택하지 않음</option>
                {topics.map((topic) => <option key={topic}>{topic}</option>)}
              </select>
            </label>
          </div>
          <textarea
            minLength={2}
            maxLength={2000}
            value={postDraft}
            onChange={(event) => setPostDraft(event.target.value)}
            aria-label="글 내용 수정"
            aria-describedby="community-post-edit-length"
          />
          <small id="community-post-edit-length">2~2,000자 · 현재 {postDraft.length.toLocaleString('ko-KR')}자</small>
          <div>
            <button type="button" onClick={() => {
              editingPostRef.current = false;
              setWorking(false);
              setEditingPost(false);
            }}><X size={16} /> 취소</button>
            <button type="button" disabled={working} onClick={() => void savePost()}><Check size={16} /> 저장</button>
          </div>
        </div>
      ) : (
        <p>{post.body}</p>
      )}
      <footer>
        <span className="community-author">
          <b>{post.pseudonym}</b>
          <ProviderBadge provider={post.provider} />
          <time>{formatDate(post.createdAtMs)}</time>
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`comments-${post.id}`}
          onClick={toggleComments}
        >
          <MessageCircleMore size={16} /> 댓글 {post.commentCount}
        </button>
      </footer>
      {notice && (
        <p className="community-notice" aria-live="polite">
          {notice}
        </p>
      )}
      {open && (
        <section
          id={`comments-${post.id}`}
          className="community-comments"
          aria-label={`${post.pseudonym} 글의 댓글`}
        >
          {commentsLoading || commentPolicyLoading ? (
            <p role="status"><LoaderCircle className="spin" size={17} aria-hidden="true" /> {commentPolicyLoading ? "댓글 숨김 설정을 적용하고 있어요" : "댓글을 불러오는 중이에요"}</p>
          ) : commentPolicyError ? (
            <div role="alert">
              <p>{commentPolicyError === "compatibility"
                ? "댓글 숨김 정책의 서버 응답이 현재 화면과 맞지 않아 댓글을 잠시 가렸어요."
                : "댓글 숨김 설정을 확인하지 못해 댓글을 잠시 가렸어요."}</p>
              <button
                type="button"
                className="community-comments-more"
                onClick={() => {
                  setCommentPolicyKey("");
                  setCommentPolicyError(null);
                  setCommentPolicyRetry((value) => value + 1);
                }}
              >
                다시 시도하기
              </button>
            </div>
          ) : visibleComments.length ? (
            <ul>
              {visibleComments.map((comment) => (
                <li key={comment.id}>
                  <div>
                    <span className="community-author">
                      <b>{comment.pseudonym}</b>
                      <ProviderBadge provider={comment.provider} />
                    </span>
                    <span className="community-comment-meta">{formatDate(comment.createdAtMs)}</span>
                    <div className="community-item-actions">
                      {isAdministrator && <button type="button" aria-label={`${comment.pseudonym}의 댓글 운영 안내`} onClick={() => { setModerationCommentId(comment.id); setModerationAction('warn'); setModerationReason(''); setModerationOpen(true); }}>안내·조치</button>}
                      {ownedCommentIds.has(comment.id) ? (
                        <>
                          <button type="button" className="owner-icon-action" aria-label="댓글 수정" title="댓글 수정" onClick={() => beginCommentEdit(comment)}><Pencil size={18} aria-hidden="true" /></button>
                          <button type="button" className="owner-icon-action owner-icon-action-danger" aria-label="댓글 삭제" title="댓글 삭제" onClick={() => void removeComment(comment.id)}><Trash2 size={18} aria-hidden="true" /></button>
                        </>
                      ) : (
                        <>
                          <button type="button" aria-label={`${comment.pseudonym} 숨기기`} onClick={() => void blockAuthor("comment", comment.id)}><Ban size={14} /></button>
                          <button
                            type="button"
                            aria-label={`${comment.pseudonym}의 댓글 신고`}
                            onClick={() => setReportTarget({ type: "comment", id: comment.id, pseudonym: comment.pseudonym })}
                          >
                            <Flag size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingCommentId === comment.id ? (
                    <div className="community-inline-editor compact">
                      <DraftRecoveryPanel
                        state={commentEditDraft.state}
                        recovery={commentEditDraft.recovery}
                        onContinue={commentEditDraft.continueDraft}
                        onStartNew={() => {
                          commentEditDraft.startNew({ body: comment.body });
                          setCommentDraft(comment.body);
                        }}
                        onDelete={() => {
                          commentEditDraft.deleteDraft({ body: comment.body });
                          setCommentDraft(comment.body);
                        }}
                        onRetry={commentEditDraft.retry}
                      />
                      <textarea
                        minLength={2}
                        maxLength={800}
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        aria-label="댓글 내용 수정"
                        aria-describedby={`community-comment-edit-length-${comment.id}`}
                      />
                      <small id={`community-comment-edit-length-${comment.id}`}>2~800자 · 현재 {commentDraft.length}자</small>
                      <div>
                        <button type="button" onClick={cancelCommentEdit}><X size={15} /> 취소</button>
                        <button type="button" disabled={working} onClick={() => void saveComment(comment.id)}><Check size={15} /> 저장</button>
                      </div>
                    </div>
                  ) : (
                    <p>{comment.body}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>아직 댓글이 없어요. 먼저 댓글을 남겨 보세요.</p>
          )}
          {hasOlderComments && (
            <button
              className="community-comments-more"
              disabled={loadingOlderComments}
              type="button"
              onClick={loadOlderComments}
            >
              {loadingOlderComments ? "불러오는 중" : "이전 댓글 더 보기"}
            </button>
          )}
          <form onSubmit={createComment}>
            <DraftRecoveryPanel
              state={replyDraft.state}
              recovery={replyDraft.recovery}
              onContinue={replyDraft.continueDraft}
              onStartNew={() => {
                replyDraft.startNew({ body: "" });
                setBody("");
              }}
              onDelete={() => {
                replyDraft.deleteDraft({ body: "" });
                setBody("");
              }}
              onRetry={replyDraft.retry}
            />
            <label>
              <span>댓글 · 2~800자 · 현재 {body.length}자</span>
              <textarea
                required
                minLength={2}
                maxLength={800}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="서로를 존중하는 댓글을 남겨 주세요"
              />
            </label>
            <button
              className="button button-primary"
              disabled={working}
              type="submit"
            >
              {working ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Send size={17} />
              )}{" "}
              댓글 남기기
            </button>
          </form>
        </section>
      )}
      {reportTarget && (
        <ReportDialog
          postId={post.id}
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onComplete={(message) => {
            setNotice(message);
            setReportTarget(null);
          }}
        />
      )}
    </article>
  );
}
