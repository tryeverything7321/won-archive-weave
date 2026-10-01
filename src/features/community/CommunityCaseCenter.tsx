import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, ShieldAlert } from "lucide-react";
import { communityApi, type MyCommunityCases } from "./api";
import "./CommunityCaseCenter.css";
import { ProviderBadge } from "./ProviderBadge";
import { appealStatusCopy, formatCommunityCaseDate } from "./community-case-model";

const reportStatus: Record<string, string> = {
  received: "접수됨",
  urgent_review: "우선 확인 중",
  resolved: "조치 완료",
  dismissed: "확인 후 종결",
};

const moderationStatus: Record<string, string> = {
  warn: "운영 안내",
  request_correction: "수정 요청",
  hold: "임시 숨김",
  remove: "삭제 안내",
  restore: "공개 복원",
  held: "공개 보류",
  removed: "운영상 삭제",
};

export function CommunityCaseCenter() {
  const [cases, setCases] = useState<MyCommunityCases | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [appealPostId, setAppealPostId] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    setState("loading");
    void communityApi.listMyCases()
      .then((result) => {
        setCases(result);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const submitAppeal = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!appealPostId || reason.trim().length < 2) return;
    setNotice("");
    try {
      await communityApi.appeal({ postId: appealPostId, reason: reason.trim() });
      setNotice("이의 제기를 접수했어요. 운영자가 다시 확인한 뒤 결과를 알려 드려요.");
      setAppealPostId("");
      setReason("");
      load();
    } catch {
      setNotice("이의 제기를 접수하지 못했어요. 이미 접수했는지 확인해 주세요.");
    }
  };

  const unblock = async (blockId: string) => {
    setNotice("");
    try {
      await communityApi.unblockAuthor({ blockId });
      setNotice("이용자 숨김을 해제했어요. 새로 불러온 글과 댓글부터 다시 보여요.");
      load();
    } catch {
      setNotice("이용자 숨김을 해제하지 못했어요.");
    }
  };

  if (state === "loading") {
    return <div className="community-notice community-case-state" role="status"><LoaderCircle className="spin" size={17} /> 내 신고와 운영 알림을 확인하고 있어요.</div>;
  }
  if (state === "error") {
    return <div className="community-notice community-case-state" role="alert"><CircleAlert size={17} /> 운영 알림을 불러오지 못했어요. <button type="button" onClick={load}>다시 시도</button></div>;
  }
  return (
    <details className="community-topic-disclosure community-case-center">
      <summary><ShieldAlert size={17} /> 내 신고와 운영 알림</summary>
      <div className="community-case-list" aria-live="polite">
        {!cases?.moderationNotices?.length && !cases?.moderatedPosts.length && !cases?.reports.length && !(cases?.appeals?.length ?? 0) && !cases?.blockedAuthors.length && (
          <p>새로운 신고 처리 결과나 운영 알림이 없어요.</p>
        )}
        {cases?.moderationNotices?.map((item) => (
          <article className="community-case-item" key={item.noticeId}>
            <p><b>{moderationStatus[item.action] ?? "운영 안내"}</b></p>
            <p>{item.reason}</p>
            {item.body && <blockquote>{item.body}</blockquote>}
            <small>{formatCommunityCaseDate(item.createdAtMs)}</small>
          </article>
        ))}
        {cases?.moderatedPosts.map((post) => (
          <article className="community-case-item" key={post.postId}>
            <p><b>{moderationStatus[post.status] ?? post.status}</b>{!cases.moderationNotices?.some((item) => item.targetType === 'post' && item.postId === post.postId) && ` · ${post.reason}`}</p>
            {post.body && !cases.moderationNotices?.some((item) => item.targetType === 'post' && item.postId === post.postId) && <blockquote>{post.body}</blockquote>}
            {!post.appealed && (
              <button className="button button-secondary" type="button" onClick={() => setAppealPostId(post.postId)}>
                다시 확인 요청하기
              </button>
            )}
            {post.appealed && <p><CheckCircle2 size={16} /> 이의 제기를 접수했어요.</p>}
          </article>
        ))}
        {cases?.reports.map((report) => (
          <article className="community-case-item" key={report.reportId}>
            <p><b>내 신고 · {reportStatus[report.status] ?? report.status}</b></p>
            {report.resolution && <p>{report.resolution}</p>}
          </article>
        ))}
        {cases?.appeals?.map((appeal) => {
          const resolvedAt = formatCommunityCaseDate(appeal.resolvedAtMs);
          const createdAt = formatCommunityCaseDate(appeal.createdAtMs);
          return (
            <article className="community-case-item" key={appeal.appealId}>
              <p><b>내 이의 제기 · {appealStatusCopy[appeal.status] ?? appeal.status}</b></p>
              {appeal.resolution && <p>{appeal.resolution}</p>}
              {(resolvedAt || createdAt) && (
                <time dateTime={new Date(appeal.resolvedAtMs || appeal.createdAtMs).toISOString()}>
                  {resolvedAt ? `처리 ${resolvedAt}` : `접수 ${createdAt}`}
                </time>
              )}
            </article>
          );
        })}
        {cases?.blockedAuthors.map((author) => (
          <article className="community-case-item" key={author.blockId}>
            <p>
              <b>숨긴 이용자 · {author.pseudonym}</b>{" "}
              <ProviderBadge provider={author.provider ?? undefined} />
            </p>
            <button type="button" className="button button-secondary" onClick={() => void unblock(author.blockId)}>
              숨김 해제
            </button>
          </article>
        ))}
        {appealPostId && (
          <form className="community-case-appeal" onSubmit={submitAppeal}>
            <label>
              <span>다시 확인이 필요한 이유</span>
              <textarea required minLength={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div>
              <button type="button" className="button button-secondary" onClick={() => setAppealPostId("")}>취소</button>
              <button type="submit" className="button button-primary">이의 제기 접수</button>
            </div>
          </form>
        )}
        {notice && <p className="community-notice" role="status">{notice}</p>}
        <button type="button" className="button button-secondary" onClick={load}>상태 새로고침</button>
      </div>
    </details>
  );
}
