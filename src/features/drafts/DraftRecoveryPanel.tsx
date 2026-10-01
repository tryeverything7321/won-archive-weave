import { useId } from "react";
import type { DraftEnvelope } from "./draft-store";
import type { DraftUiState } from "./useFormDraft";
import { draftPolicyCopy, requiresDraftDiscardConfirmation } from "./draft-ui";

const savedFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });

export function DraftRecoveryPanel({
  state,
  recovery,
  onContinue,
  onStartNew,
  onDelete,
  onRetry,
}: {
  state: DraftUiState;
  recovery: DraftEnvelope<unknown> | null;
  onContinue(): void;
  onStartNew(): void;
  onDelete(): void;
  onRetry(): void;
}) {
  const titleId = useId();
  if (recovery) {
    return (
      <aside className="draft-recovery" aria-labelledby={titleId}>
        <h3 id={titleId}>작성 중인 초안이 있어요</h3>
        <p>{savedFormatter.format(recovery.savedAtMs)}에 저장한 내용을 이어서 작성할 수 있어요.</p>
        <p>{draftPolicyCopy.storage}</p>
        {recovery.fileReselectionRequired && <p>{draftPolicyCopy.files}</p>}
        {state.phase === "error" && (
          <p role="alert">저장된 초안을 지우지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.</p>
        )}
        <div className="draft-recovery-actions">
          <button type="button" className="button button-primary" onClick={onContinue}>계속 작성</button>
          <button type="button" className="button button-secondary" onClick={() => {
            if (!requiresDraftDiscardConfirmation("start_new") || window.confirm("저장된 초안을 지우고 새로 작성할까요?")) onStartNew();
          }}>새로 작성</button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              if (window.confirm("저장된 초안을 삭제할까요? 삭제한 초안은 복원할 수 없어요.")) onDelete();
            }}
          >초안 삭제</button>
        </div>
      </aside>
    );
  }

  if (state.phase === "hydrating") return <p role="status">초안을 확인하고 있어요.</p>;
  if (state.phase === "saving") return <p role="status">임시저장 중</p>;
  if (state.phase === "saved") return <p role="status">임시저장됨 · {savedFormatter.format(state.savedAtMs)}</p>;
  if (state.phase === "error") {
    return (
      <div role="alert">
        <p>{state.reason === "quota" ? "저장 공간이 부족해 초안을 저장하지 못했어요." : "초안을 저장하지 못했어요."}</p>
        <button type="button" className="button button-secondary" onClick={onRetry}>임시저장 다시 시도</button>
      </div>
    );
  }
  return null;
}
