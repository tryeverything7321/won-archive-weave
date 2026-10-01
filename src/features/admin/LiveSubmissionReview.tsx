import { useCallback, useEffect, useMemo, useState } from "react";
import { createModerationRequestTracker } from '../community/moderation-request';
import {
  AlertTriangle,
  Clock3,
  FileWarning,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  listSubmissionOperatorExceptions,
  runSubmissionOperatorExceptionAction,
} from "./submission-exceptions-api";
import {
  mergeSubmissionExceptionPages,
  submissionExceptionActionCopy,
  submissionExceptionCopy,
  type SubmissionExceptionAction,
  type SubmissionOperatorException,
} from "./submission-exceptions";
import "./LiveSubmissionReview.css";
import { ActionDialog, type ActionDialogRequest } from "./ActionDialog";
import { WeaveBadge } from "../../components/WeaveBadge";
import { workflowBadgeTone } from "../../components/weave-badge-model";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function sourceLabel(sourceMode: SubmissionOperatorException["sourceMode"]) {
  if (sourceMode === "google_drive_link") return "Google 원본";
  if (sourceMode === "instagram_url") return "Instagram 원문";
  return "업로드 파일";
}

const scanStatusLabels: Record<string, string> = {
  pending: "검사 대기",
  clean: "검사 완료",
  blocked: "차단됨",
  error: "검사 오류",
  not_applicable: "검사 대상 아님",
};

const cleanupStateLabels: Record<string, string> = {
  not_required: "회수할 파일 없음",
  pending: "회수 중",
  failed: "재시도 예정",
  dead_letter: "직접 확인 필요",
  completed: "회수 완료",
};

const exceptionStatusLabels: Record<string, string> = {
  open: "확인 필요",
  resolved: "처리 완료",
};

export function LiveSubmissionReview() {
  const [dialogRequest, setDialogRequest] = useState<ActionDialogRequest | null>(null);
  const requests = useMemo(() => createModerationRequestTracker(), []);
  const [items, setItems] = useState<SubmissionOperatorException[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [workingAction, setWorkingAction] = useState<SubmissionExceptionAction | null>(null);
  const [notice, setNotice] = useState("");

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0],
    [items, selectedId],
  );

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    if (append) setLoadingMore(true);
    else setState("loading");
    setNotice("");
    try {
      const page = await listSubmissionOperatorExceptions(cursor);
      setItems((current) => append ? mergeSubmissionExceptionPages(current, page.items) : page.items);
      setNextCursor(page.nextCursor);
      setSelectedId((current) => current || page.items[0]?.id || "");
      setState("ready");
    } catch {
      setState("error");
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const runAction = async (action: SubmissionExceptionAction) => {
    if (!selected || workingAction) return;
    const copy = submissionExceptionActionCopy[action];
    const target = selected;
    setDialogRequest({ title: copy.label, target: target.title || target.submissionId, description: copy.confirmation, confirmLabel: copy.label, requireReason: action === 'request_revision',
      onConfirm: async reason => {
        setWorkingAction(action); setNotice("");
        try {
          await runSubmissionOperatorExceptionAction({ exceptionId: target.id, submissionId: target.submissionId, action,
            ...(reason ? { reason, requestId: requests.idFor(JSON.stringify([target.id, action, reason])) } : {}),
          });
          requests.clear(); setSelectedId(""); await load();
          setNotice(`${copy.label} 작업을 접수했고 최신 상태를 불러왔어요.`);
        } finally { setWorkingAction(null); }
      },
    });
  };

  if (state === "loading") {
    return (
      <div className="resource-status operator-exception-state" role="status">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        확인이 필요한 자료를 불러오고 있어요.
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="resource-status operator-exception-state" role="alert">
        <AlertTriangle size={20} aria-hidden="true" />
        <span>확인이 필요한 자료를 불러오지 못했어요.</span>
        <button type="button" className="button button-secondary" onClick={() => void load()}>
          <RefreshCw size={17} aria-hidden="true" /> 다시 불러오기
        </button>
      </div>
    );
  }

  if (!selected) {
    return (
      <section className="operator-exception-empty" aria-labelledby="live-submission-review-title">
        <FileWarning size={28} aria-hidden="true" />
        <h2 id="live-submission-review-title">지금 확인할 자료가 없어요</h2>
        <p>검사를 통과한 자료는 자동으로 공개되며 이곳에 나타나지 않습니다.</p>
        <button type="button" className="button button-secondary" onClick={() => void load()}>
          <RefreshCw size={17} aria-hidden="true" /> 새로고침
        </button>
      </section>
    );
  }

  const detail = submissionExceptionCopy(selected.type);

  return (
    <section className="operator-exception-review" aria-labelledby="live-submission-review-title">
      <ActionDialog request={dialogRequest} onClose={() => setDialogRequest(null)} />
      <div className="resource-collection-heading">
        <div>
          <h2 id="live-submission-review-title">확인이 필요한 자료</h2>
          <p>자동 처리가 멈춘 자료만 모았습니다. 검사 차단, 공개 오류, 파일 회수 실패를 여기서 확인할 수 있어요.</p>
        </div>
        <span>현재 {items.length}건</span>
      </div>

      <div className="operations-layout operator-exception-layout">
        <aside className="submission-queue operator-exception-queue" aria-label="자료 운영 예외 목록">
          <div>
            <p>최근순</p>
            <h2>최근 들어온 자료</h2>
          </div>
          {items.map((item) => {
            const copy = submissionExceptionCopy(item.type);
            return (
              <button
                type="button"
                key={item.id}
                className={selected.id === item.id ? "is-selected" : ""}
                aria-current={selected.id === item.id ? "true" : undefined}
                onClick={() => {
                  setSelectedId(item.id);
                  setNotice("");
                }}
              >
                <span>{item.kind} · {sourceLabel(item.sourceMode)}</span>
                <b>{item.title}</b>
                <small>{item.createdAtMs ? dateFormatter.format(item.createdAtMs) : "접수 시간 확인 전"}</small>
                <em>{copy.label}</em>
              </button>
            );
          })}
          {nextCursor && (
            <button
              type="button"
              className="button button-secondary operator-exception-more"
              disabled={loadingMore}
              onClick={() => void load(nextCursor, true)}
            >
              {loadingMore
                ? <><LoaderCircle className="spin" size={17} aria-hidden="true" /> 불러오는 중</>
                : <><RotateCcw size={17} aria-hidden="true" /> 이전 예외 더 보기</>}
            </button>
          )}
        </aside>

        <section className="review-detail operator-exception-detail" aria-live="polite" aria-busy={Boolean(workingAction)}>
          <div className="review-heading">
            <div>
              <p>{selected.kind} · {sourceLabel(selected.sourceMode)}</p>
              <h2>{selected.title}</h2>
              <span>{detail.description}</span>
            </div>
            <WeaveBadge family="workflow" tone={workflowBadgeTone(selected.status === "resolved" ? "resolved" : selected.scanStatus)} icon={<Clock3 size={15} />} className="status-pill">{detail.label}</WeaveBadge>
          </div>

          <dl className="operator-exception-facts">
            <div><dt>검사 상태</dt><dd>{scanStatusLabels[selected.scanStatus] ?? "확인 전"}</dd></div>
            <div><dt>파일 회수</dt><dd>{cleanupStateLabels[selected.cleanupState] ?? "확인 전"}</dd></div>
            <div><dt>처리 상태</dt><dd>{exceptionStatusLabels[selected.status] ?? "확인 전"}</dd></div>
          </dl>

          <section className="operator-exception-guidance">
            <h3>다음 확인</h3>
            <p>{detail.next}</p>
          </section>

          {selected.nextActions.length ? (
            <div className="review-actions operator-exception-actions" aria-label={`${selected.title} 처리`}>
              {selected.nextActions.map((action) => {
                const copy = submissionExceptionActionCopy[action];
                return (
                  <button
                    type="button"
                    key={action}
                    disabled={Boolean(workingAction)}
                    onClick={() => void runAction(action)}
                  >
                    {workingAction === action
                      ? <LoaderCircle className="spin" size={17} aria-hidden="true" />
                      : <RefreshCw size={17} aria-hidden="true" />}
                    {workingAction === action ? copy.pending : copy.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="review-notice">지금 바로 실행할 수 있는 작업이 없어요. 새로고침한 뒤 다시 확인해 주세요.</p>
          )}

          {notice && <p className="review-notice" role="status">{notice}</p>}
        </section>
      </div>
    </section>
  );
}
