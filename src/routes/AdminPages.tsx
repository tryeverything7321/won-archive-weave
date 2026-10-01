import { useCallback, useEffect, useMemo, useState } from "react";
import { createModerationRequestTracker } from "../features/community/moderation-request";
import {
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { ActionDialog, type ActionDialogRequest } from "../features/admin/ActionDialog";
import { OperationsHome } from "../features/admin/OperationsHome";
import { OperatorAudit } from "../features/admin/OperatorAudit";
import { MembersAdmin } from "../features/admin/MembersAdmin";
import { useOperatorAccess } from "../features/auth/useOperatorAccess";
import { PageFrame } from "../components/PageFrame";
import { LiveSubmissionReview } from "../features/admin/LiveSubmissionReview";
import { ArchiveOrganizerAdmin } from "../features/admin/ArchiveOrganizerAdmin";
import { CalendarSourceAdmin } from "../features/admin/CalendarSourceAdmin";
import { ContentModerationPanel } from "../features/admin/ContentModerationPanel";
import {
  communityApi,
  communityPostPurposes,
  type CommunityAdminCase,
  type CommunityAdminPost,
  type CommunityPostPurpose,
} from "../features/community/api";

type AdminSection = "home" | "members" | "submissions" | "calendar" | "community" | "audit";

export function AdminPage({ section }: { section: AdminSection }) {
  const access = useOperatorAccess();
  return (
    <PageFrame
      eyebrow="운영 센터"
      title={
        <>
          게시물과 운영 알림 관리
        </>
      }
      description="일반 등록은 사전 승인 없이 공개됩니다. 문제가 있는 내용에는 사유를 안내하고, 안전 검사 오류와 신고를 확인하세요."
    >
      <nav className="admin-nav" aria-label="운영 메뉴">
        <NavLink to="/admin" end>운영 현황</NavLink>
        {access.memberRead && <NavLink to="/admin/members">회원 현황</NavLink>}
        <NavLink to="/admin/submissions">활동·자료</NavLink>
        <NavLink to="/admin/calendar">행사 일정</NavLink>
        <NavLink to="/admin/community">커뮤니티</NavLink>
        <NavLink to="/admin/audit">감사 기록</NavLink>
      </nav>
      {section === "submissions" && <><ContentModerationPanel key="submission" kind="submission" /><LiveSubmissionReview /></>}
      {section === "community" && <CommunityAdmin />}
      {section === "calendar" && <><ContentModerationPanel key="event" kind="event" /><CalendarSourceAdmin /><ArchiveOrganizerAdmin /></>}
      {section === "audit" && <OperatorAudit />}
      {section === "home" && <OperationsHome />}
      {section === "members" && <MembersAdmin />}
    </PageFrame>
  );
}

function CommunityAdmin() {
  const [dialogRequest, setDialogRequest] = useState<ActionDialogRequest | null>(null);
  const moderationRequests = useMemo(() => createModerationRequestTracker(), []);
  const [items, setItems] = useState<CommunityAdminPost[]>([]);
  const [cases, setCases] = useState<CommunityAdminCase[]>([]);
  const [queue, setQueue] = useState<"content" | "reports" | "appeals">("reports");
  const [statusFilter, setStatusFilter] = useState("all");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [workingId, setWorkingId] = useState("");
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState("");
  const [body, setBody] = useState("");
  const [purpose, setPurpose] = useState<CommunityPostPurpose>("생각 나눔");
  const [topic, setTopic] = useState("");

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    setState("loading");
    try {
      const result = await communityApi.listAdminPosts({
        queue,
        status: statusFilter,
        cursorId: cursor,
      });
      setItems((current) => append ? [...current, ...result.posts] : result.posts);
      setCases((current) => append ? [...current, ...result.cases] : result.cases);
      setCursorId(result.nextCursorId);
      setHasMore(result.hasMore);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [queue, statusFilter]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const beginEdit = (post: CommunityAdminPost) => {
    setEditingId(post.id);
    setBody(post.body);
    setPurpose(post.purpose);
    setTopic(post.topic ?? "");
    setNotice("");
  };

  const save = async (post: CommunityAdminPost) => {
    if (body.trim().length < 2) return;
    setWorkingId(post.id);
    try {
      await communityApi.editPost({
        postId: post.id,
        body: body.trim(),
        purpose,
        topic: topic || null,
      });
      setEditingId("");
      setNotice("글을 수정했어요.");
      await load(null, false);
    } catch {
      setNotice("글을 수정하지 못했어요.");
    } finally {
      setWorkingId("");
    }
  };

  const moderate = async (post: CommunityAdminPost, action: "warn" | "request_correction" | "hold" | "remove" | "restore") => {
    const label = action === "restore" ? "다시 공개" : action === "hold" ? "숨기기" : action === "remove" ? "삭제" : "안내 보내기";
    setDialogRequest({ title: `게시물 ${label}`, target: post.body.slice(0, 120), description: "사유를 작성하면 해당 게시물에 조치를 적용하고 운영 이력을 남깁니다.", confirmLabel: label, requireReason: true,
      onConfirm: async reason => {
        setWorkingId(post.id);
        try {
          await communityApi.moderatePost({ postId: post.id, action, reason, requestId: moderationRequests.idFor(JSON.stringify([post.id, action, reason])) });
          moderationRequests.clear();
          await load(null, false);
          setNotice(`${label} 처리를 완료했어요.`);
        } finally { setWorkingId(""); }
      },
    });
  };

  const remove = async (post: CommunityAdminPost) => {
    await moderate(post, "remove");
  };

  const resolveCase = async (
    item: CommunityAdminCase,
    action: "dismiss" | "hold" | "remove" | "accept" | "reject",
  ) => {
    const actionCopy = {
      dismiss: {
        question: "콘텐츠 상태를 바꾸지 않고 이 신고를 종결할까요?",
        resolution: "신고 내용을 확인했으며 추가 조치 없이 종결했습니다.",
        notice: "신고를 종결했어요. 콘텐츠 상태는 바뀌지 않았습니다.",
      },
      hold: {
        question: "신고 대상 콘텐츠를 공개 목록에서 숨기고 신고 처리를 마칠까요?",
        resolution: "신고 내용을 확인해 콘텐츠를 공개 목록에서 숨겼습니다.",
        notice: "신고 대상 콘텐츠를 숨기고 처리 결과를 저장했어요.",
      },
      remove: {
        question: "신고 대상 콘텐츠를 운영상 삭제 상태로 바꾸고 신고 처리를 마칠까요?",
        resolution: "신고 내용을 확인해 콘텐츠를 운영상 삭제했습니다.",
        notice: "신고 대상 콘텐츠를 운영상 삭제하고 처리 결과를 저장했어요.",
      },
      accept: {
        question: "이의 제기를 수용하고 글을 다시 공개할까요?",
        resolution: "이의 제기를 받아들여 글을 다시 공개했습니다.",
        notice: "이의 제기를 수용하고 글을 다시 공개했어요.",
      },
      reject: {
        question: "이의 제기를 기각하고 기존 운영 조치를 유지할까요?",
        resolution: "이의 제기를 다시 확인했으나 기존 운영 조치를 유지합니다.",
        notice: "이의 제기를 기각하고 기존 운영 조치를 유지했어요.",
      },
    } as const;
    const copy = actionCopy[action];
    setDialogRequest({ title: "신고·이의 제기 처리", target: item.id, description: copy.question, confirmLabel: "처리하기", requireReason: true,
      onConfirm: async resolution => {
        setWorkingId(item.id); setNotice("");
        try {
          await communityApi.resolveCase({ caseType: item.caseType, caseId: item.id, action, resolution });
          await load(null, false); setNotice(copy.notice);
        } finally { setWorkingId(""); }
      },
    });
  };

  return (
    <div className="community-admin">
      <ActionDialog request={dialogRequest} onClose={() => setDialogRequest(null)} />
      <div className="community-admin-heading">
        <div>
          <p>커뮤니티 운영</p>
          <h2>예외가 생긴 대화부터 확인해요</h2>
          <span>신고와 이의 제기를 먼저 처리하고, 필요할 때 전체 글 상태를 확인합니다.</span>
        </div>
        <button type="button" className="button button-secondary" onClick={() => void load(null, false)} disabled={state === "loading"}>
          <RefreshCw size={17} /> 새로고침
        </button>
      </div>
      <div className="queue-filter" aria-label="커뮤니티 운영 대기함">
        {([
          ["reports", "신고"],
          ["appeals", "이의 제기"],
          ["content", "전체 글"],
        ] as const).map(([value, label]) => (
          <button
            type="button"
            className={queue === value ? "active" : ""}
            aria-pressed={queue === value}
            key={value}
            onClick={() => {
              setQueue(value);
              setStatusFilter("all");
              setCursorId(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label>
        <span>처리 상태</span>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">모든 상태</option>
          {queue === "content" ? (
            <>
              <option value="active">공개</option>
              <option value="held">숨김</option>
              <option value="removed">운영상 삭제</option>
              <option value="deleted">삭제</option>
            </>
          ) : queue === "reports" ? (
            <>
              <option value="urgent_review">우선 확인</option>
              <option value="received">접수됨</option>
              <option value="resolved">조치 완료</option>
              <option value="dismissed">종결</option>
            </>
          ) : (
            <>
              <option value="received">접수됨</option>
              <option value="accepted">수용</option>
              <option value="rejected">기각</option>
            </>
          )}
        </select>
      </label>
      {notice && <p className="community-admin-notice" role="status">{notice}</p>}
      {state === "loading" && <div className="community-admin-state" role="status"><LoaderCircle className="spin" size={22} /> 글을 불러오는 중이에요</div>}
      {state === "error" && <div className="community-admin-state" role="alert">글을 불러오지 못했어요</div>}
      {state === "ready" && items.length === 0 && cases.length === 0 && <div className="community-admin-state">이 조건에 맞는 운영 항목이 없어요</div>}
      {state === "ready" && cases.map((item) => (
        <article className="community-admin-item" key={item.id}>
          <header>
            <div>
              <span className={`community-admin-status is-${item.status}`}>{item.status}</span>
              <b>{item.caseType === "report" ? "신고" : "이의 제기"}</b>
              <small>{item.targetType === "comment" ? "댓글" : "글"} · {item.category}</small>
            </div>
            <time>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(item.createdAtMs)}</time>
          </header>
          <p>{item.details || "운영자에게 전한 추가 내용이 없습니다."}</p>
          {item.resolution && <small className="community-admin-reason">{item.resolution}</small>}
          {(item.status === "received" || item.status === "urgent_review") && (
            <div className="community-admin-actions">
              {item.caseType === "report" ? (
                <>
                  <button type="button" disabled={workingId === item.id} onClick={() => void resolveCase(item, "hold")}><EyeOff size={16} /> 콘텐츠 숨김</button>
                  <button type="button" disabled={workingId === item.id} onClick={() => void resolveCase(item, "remove")}><ShieldAlert size={16} /> 운영상 삭제</button>
                  <button type="button" disabled={workingId === item.id} onClick={() => void resolveCase(item, "dismiss")}><X size={16} /> 신고만 종결</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={workingId === item.id} onClick={() => void resolveCase(item, "accept")}><Check size={16} /> 수용하고 글 복원</button>
                  <button type="button" disabled={workingId === item.id} onClick={() => void resolveCase(item, "reject")}><X size={16} /> 기각하고 조치 유지</button>
                </>
              )}
            </div>
          )}
        </article>
      ))}
      {state === "ready" && items.map((post) => (
        <article className="community-admin-item" key={post.id}>
          <header>
            <div>
              <span className={`community-admin-status is-${post.status}`}>
                {post.status === "active" ? "공개" : post.status === "held" ? "숨김" : post.status === "removed" ? "운영상 삭제" : "삭제"}
              </span>
              <b>{post.pseudonym}</b>
              <small>댓글 {post.commentCount}</small>
            </div>
            <time>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(post.updatedAtMs || post.createdAtMs)}</time>
          </header>
          {editingId === post.id ? (
            <div className="community-admin-editor">
              <textarea minLength={2} maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} aria-label="관리자 글 내용 수정" />
              <div>
                <label>글의 성격<select value={purpose} onChange={(event) => setPurpose(event.target.value as CommunityPostPurpose)}>{communityPostPurposes.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>관심 주제<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="선택 정보" /></label>
              </div>
              <div className="community-admin-actions">
                <button type="button" onClick={() => setEditingId("")}><X size={16} /> 취소</button>
                <button type="button" disabled={workingId === post.id} onClick={() => void save(post)}><Check size={16} /> 저장</button>
              </div>
            </div>
          ) : (
            <p>{post.body || "삭제된 글입니다"}</p>
          )}
          {post.moderationReason && <small className="community-admin-reason">{post.moderationReason}</small>}
          {post.status !== "deleted" && editingId !== post.id && (
            <div className="community-admin-actions">
              <button type="button" onClick={() => beginEdit(post)}><Pencil size={16} /> 수정</button>
              {post.status === "active" ? (
                <button type="button" onClick={() => void moderate(post, "hold")}><EyeOff size={16} /> 숨김</button>
              ) : (
                <button type="button" onClick={() => void moderate(post, "restore")}><Eye size={16} /> 다시 공개</button>
              )}
              {post.status !== "removed" && <button type="button" onClick={() => void moderate(post, "remove")}><ShieldAlert size={16} /> 운영상 삭제</button>}
              <button type="button" onClick={() => void moderate(post, "warn")}>안내 보내기</button>
              <button type="button" onClick={() => void moderate(post, "request_correction")}>수정 요청</button>
              <button type="button" onClick={() => void remove(post)}><Trash2 size={16} /> 안내 후 삭제</button>
            </div>
          )}
        </article>
      ))}
      {state === "ready" && hasMore && cursorId && (
        <button type="button" className="button button-secondary" onClick={() => void load(cursorId, true)}>
          이전 글 더 보기
        </button>
      )}
    </div>
  );
}