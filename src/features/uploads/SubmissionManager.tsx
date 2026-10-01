import { PencilLine, RefreshCw, RotateCcw, Undo2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listMySubmissions, requestSubmissionChange, withdrawSubmission } from "./api";
import {
  mergeOwnedSubmissionPages,
  canOwnerOpenPrivateAttachment,
  moderationNoticeCopy,
  submissionManagementPresentation,
  type OwnedSubmission,
  type SubmissionOwnerAction,
} from "./submission-model";
import styles from "./SubmissionManager.module.css";
import { WeaveBadge } from "../../components/WeaveBadge";
import { workflowBadgeTone } from "../../components/weave-badge-model";
import { MaterialLinkPicker } from './MaterialLinkPicker';
import { getMaterialLinkImpact } from './material-links-api';
import { OwnerAttachmentActions } from './OwnerAttachmentActions';
import { materialVisibilityLabel } from '../../data/material-access';

const dateFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" });
type StatusTone = "working" | "success" | "error" | "neutral";
type StatusLineValue = { label: string; tone: StatusTone; text: string; refresh?: boolean };

function actionCopy(action: SubmissionOwnerAction) {
  if (action === "edit") return { label: "수정", Icon: PencilLine };
  if (action === "withdraw") return { label: "올리기 취소", Icon: Undo2 };
  if (action === "request_revision") return { label: "수정", Icon: PencilLine };
  if (action === "restore_private") return { label: "비공개 초안으로 복원", Icon: RotateCcw };
  return { label: "삭제", Icon: Trash2 };
}

function processingCopy(
  submission: OwnedSubmission,
  attachment: ReturnType<typeof submissionManagementPresentation>["attachment"],
): StatusLineValue | null {
  if (submission.cleanupState === "dead_letter") {
    return { label: "파일 회수 확인 필요", tone: "error", text: "공개 파일 자동 회수를 마치지 못해 운영자 조치가 필요해요. 원본은 공개 화면에서 먼저 숨겨졌습니다." };
  }
  if (submission.cleanupState === "failed") {
    return { label: "파일 회수 재처리 중", tone: "error", text: "공개 파일 회수에 실패해 운영자가 다시 처리하고 있어요. 원본은 공개 화면에서 먼저 숨겨졌습니다." };
  }
  if (submission.cleanupState === "pending") {
    return { label: "파일 회수 중", tone: "working", text: "공개 파일을 회수하고 있어요. 잠시 뒤 새로고침해 주세요.", refresh: true };
  }
  return attachment;
}

function publicationTone(submission: Pick<OwnedSubmission, "status" | "visibility">): StatusTone {
  if (submission.status === "review_queued" && submission.visibility === "보류") return "neutral";
  const { status } = submission;
  if (status === "published") return "success";
  if (status === "publishing" || status === "change_pending" || status === "review_queued") return "working";
  if (status === "publishing_failed" || status === "rejected" || status === "exception_queued") return "error";
  return "neutral";
}

function StatusLine({
  label,
  tone,
  text,
  onRefresh,
}: {
  label: string;
  tone: StatusTone;
  text: string;
  onRefresh?: () => void;
}) {
  return (
    <div className={`${styles.statusLine} ${styles[tone]}`} role={tone === "error" ? "alert" : tone === "working" ? "status" : undefined}>
      <div>
        <strong>{label}</strong>
        <p>{text}</p>
      </div>
      {onRefresh && (
        <button type="button" className="button button-secondary" onClick={onRefresh}>
          <RefreshCw size={16} aria-hidden="true" /> 상태 새로고침
        </button>
      )}
    </div>
  );
}

export function SubmissionManager({ onEdit }: { onEdit?: (submission: OwnedSubmission) => void }) {
  const [items, setItems] = useState<OwnedSubmission[]>([]);
  const [state, setState] = useState<"loading" | "success" | "limited" | "error">("loading");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      const page = await listMySubmissions();
      setItems(page.submissions);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setState(page.migrationRequired ? "limited" : "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "내 기록을 불러오지 못했어요.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listMySubmissions()
      .then((page) => {
        if (!active) return;
        setItems(page.submissions);
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setState(page.migrationRequired ? "limited" : "success");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "내 기록을 불러오지 못했어요.");
        setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMessage("");
    try {
      const page = await listMySubmissions(nextCursor);
      setItems((current) => mergeOwnedSubmissionPages(current, page.submissions));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      if (page.migrationRequired) setState("limited");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이전 기록을 더 불러오지 못했어요.");
    } finally {
      setLoadingMore(false);
    }
  };

  const runAction = async (submission: OwnedSubmission, action: SubmissionOwnerAction) => {
    if (action === "edit") {
      if (onEdit) onEdit(submission);
      else window.location.assign(`/contribute?submissionId=${encodeURIComponent(submission.id)}`);
      return;
    }
    setBusyId(submission.id);
    setMessage("");
    try {
      let completionMessage = "";
      if (action === "withdraw") {
        await withdrawSubmission(submission.id);
      } else {
        if (action === 'unpublish') {
          const impact = submission.kind === '자료' ? await getMaterialLinkImpact(submission.id) : null;
          const count = impact ? `${impact.linkedActivityCount}${impact.hasMore ? '개 이상' : '개'}` : '';
          const retention = submission.status === 'revision_requested'
            ? '원본은 내 위브에 남습니다. 다시 공개하려면 운영 안내를 확인해 주세요.'
            : '원본은 내 위브에 남고 비공개 초안으로 복원할 수 있어요.';
          const question = impact
            ? `이 자료를 삭제할까요? 연결된 활동 ${count}에서도 보이지 않게 됩니다. ${retention}`
            : `이 기록을 삭제할까요? ${retention}`;
          if (!window.confirm(question)) return;
        }
        const result = await requestSubmissionChange(submission.id, action);
        if (action === "request_revision" || action === "restore_private") {
          const nextStatus = action === "restore_private" ? "draft" : "revision_requested";
          if (onEdit) onEdit({ ...submission, status: nextStatus, ...(action === "restore_private" ? { visibility: "보류" } : {}) });
          else window.location.assign(`/contribute?submissionId=${encodeURIComponent(submission.id)}`);
          return;
        }
        if (action === "unpublish") {
          completionMessage = result.cleanupState === "failed"
            ? "공개는 중단했지만 파일 회수에 실패해 운영자가 다시 처리하고 있어요."
            : result.cleanupState === "pending"
              ? "공개를 중단했고 파일을 회수하고 있어요."
              : "공개를 중단하고 공개 파일 회수를 마쳤어요.";
        }
      }
      await load();
      if (completionMessage) setMessage(completionMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했어요.");
    } finally {
      setBusyId("");
    }
  };

  const listReady = state === "success" || state === "limited";

  return (
    <section className="submission-manager" aria-labelledby="submission-manager-title" aria-busy={state === "loading"}>
      <div className="submission-manager-heading">
        <div>
          <h2 id="submission-manager-title">기록·자료</h2>
          <p>게시 상태를 확인하고 내용을 수정하거나 공개를 중단할 수 있어요.</p>
        </div>
        <button type="button" className="button button-secondary" onClick={() => void load()} disabled={state === "loading"}>
          <RefreshCw size={17} aria-hidden="true" /> 새로고침
        </button>
      </div>

      {message && <p className="submission-manager-message" role="alert">{message}</p>}
      {state === "loading" && <div className="submission-manager-state" role="status">내 기록을 불러오고 있어요.</div>}
      {state === "error" && (
        <div className="submission-manager-state">
          <p>지금은 내 기록을 불러오지 못했어요.</p>
          <button type="button" className="button button-secondary" onClick={() => void load()}>다시 불러오기</button>
        </div>
      )}
      {state === "limited" && (
        <div className="submission-manager-state" role="status">
          <p><b>기록 목록을 안전하게 정리하고 있어요</b></p>
          <p>지금은 확인 가능한 기록을 최대 100건까지 보여 드려요. 정리가 끝나면 이전 기록까지 이어서 볼 수 있어요.</p>
        </div>
      )}
      {state === "success" && items.length === 0 && (
        <div className="submission-manager-state">
          <p>아직 올린 기록이나 자료가 없어요.</p>
          <a className="button button-primary" href="/contribute">첫 기록 남기기</a>
        </div>
      )}
      {listReady && items.length > 0 && (
        <>
          <div className="submission-manager-list">
            {items.map((submission) => {
            const presentation = submissionManagementPresentation(submission);
            const copy = presentation.lifecycle;
            const processing = processingCopy(submission, presentation.attachment);
            const preview = presentation.preview;
            const date = submission.updatedAtMs ?? submission.createdAtMs;
            const moderationNotice = submission.moderationNotice;
            const noticeCopy = moderationNotice ? moderationNoticeCopy[moderationNotice.action] : null;
            return (
              <article className="submission-manager-item" key={submission.id}>
                <div className="submission-manager-item-copy">
                  <div className="submission-manager-meta badge-row" data-badge-primary-count="1" data-badge-secondary-count="2">
                    <WeaveBadge family="workflow" tone={workflowBadgeTone(submission.status)} size="compact">{copy.label}</WeaveBadge>
                    <WeaveBadge family="classification" size="compact">{submission.kind}</WeaveBadge>
                    <WeaveBadge family="access" tone={submission.visibility === "공개" ? "public" : "restricted"} size="compact">{materialVisibilityLabel(submission.visibility)}</WeaveBadge>
                    {date && <time dateTime={new Date(date).toISOString()}>{dateFormatter.format(date)}</time>}
                  </div>
                  <h3>{submission.title}</h3>
                  {submission.status === 'published' && <a href={submission.kind === '자료' ? `/materials/${encodeURIComponent(submission.id)}` : `/activities/${encodeURIComponent(submission.id)}`}>올린 내용 보기</a>}
                  <div className={styles.statusGroup} aria-label="처리 상태">
                    <StatusLine label="게시 상태" tone={publicationTone(submission)} text={copy.description} />
                    {processing && (
                      <StatusLine
                        label={processing.label}
                        tone={processing.tone}
                        text={processing.text}
                        onRefresh={processing.refresh ? () => void load() : undefined}
                      />
                    )}
                    {preview && <StatusLine label={preview.label} tone={preview.tone} text={preview.text} />}
                    {submission.status === "withdrawn" && (
                      <p className={styles.withdrawalNote}>철회는 공개를 멈추는 기능이며 영구 삭제가 아닙니다. 비공개 초안으로 복원해 다시 수정할 수 있어요.</p>
                    )}
                  </div>
                  {canOwnerOpenPrivateAttachment(submission) && (
                    <div className={styles.ownerAttachment}>
                      <strong>나만 보관한 첨부</strong>
                      <p>안전 검사를 마친 파일입니다. 작성자 본인만 미리보거나 원본을 내려받을 수 있어요.</p>
                      <OwnerAttachmentActions submissionId={submission.id} title={submission.title} />
                    </div>
                  )}
                  {moderationNotice && noticeCopy && (
                    <aside className={styles.moderationNotice} aria-label={noticeCopy.label}>
                      <div className={styles.moderationNoticeHeader}>
                        <strong>{noticeCopy.label}</strong>
                        <time dateTime={new Date(moderationNotice.createdAtMs).toISOString()}>
                          {dateFormatter.format(moderationNotice.createdAtMs)}
                        </time>
                      </div>
                      <p className={styles.moderationNoticeReason}>{moderationNotice.reason}</p>
                      <p>{noticeCopy.description}</p>
                    </aside>
                  )}
                </div>
                {submission.availableActions.length > 0 && (
                  <div className="submission-manager-actions" aria-label={`${submission.title} 관리`}>
                    {submission.availableActions.filter((action) => !(submission.status === 'revision_requested' && action === 'withdraw')).map((action) => {
                      const { label, Icon } = actionCopy(action);
                      const compact = action === "edit" || action === "request_revision" || action === "unpublish";
                      return (
                        <button
                          type="button"
                          className={compact ? `owner-icon-action${action === "unpublish" ? " owner-icon-action-danger" : ""}` : "button button-secondary"}
                          key={action}
                          title={compact ? `${submission.title} ${label}` : undefined}
                          aria-label={compact ? `${submission.title} ${label}` : undefined}
                          disabled={busyId === submission.id}
                          onClick={() => void runAction(submission, action)}
                        >
                          <Icon size={compact ? 18 : 17} aria-hidden="true" /> {compact ? <span className="sr-only">{label}</span> : label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {submission.status === 'published' && submission.kind !== '자료' && <MaterialLinkPicker activityId={submission.id} />}
              </article>
            );
            })}
          </div>
          {hasMore && nextCursor && (
            <div className="submission-manager-pagination">
              <button
                type="button"
                className="button button-secondary"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                <RefreshCw size={17} aria-hidden="true" />
                {loadingMore ? "이전 기록을 불러오는 중" : "이전 기록 더 보기"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
