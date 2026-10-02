import { useOperatorAccess } from "../auth/useOperatorAccess";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { requestSubmissionChange } from "./api";
import { getMaterialLinkImpact } from "./material-links-api";
import { useSubmissionManagement } from "./useSubmissionManagement";

export function OwnedSubmissionActions({ id, returnTo, kind = "material" }: { id: string; returnTo: string; kind?: "material" | "activity" }) {
  const { phase, records, retry } = useSubmissionManagement([id]);
  const record = records.get(id);
  const operator=useOperatorAccess();
  const navigate = useNavigate();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  if (phase === "signed_out" || (phase === "ready" && !record && operator.state !== "allowed")) return null;

  const edit = async () => {
    setWorking(true);
    setError("");
    try {
      if (record?.status === "published") await requestSubmissionChange(id, "request_revision");
      navigate(`/contribute?submissionId=${encodeURIComponent(id)}`);
    } catch {
      setError("수정 화면을 열지 못했어요. 다시 시도해 주세요.");
      setWorking(false);
    }
  };

  const unpublish = async () => {
    setWorking(true);
    setError("");
    try {
      const impact = kind === "material" ? await getMaterialLinkImpact(id) : null;
      const linkedCount = impact ? `${impact.linkedActivityCount}${impact.hasMore ? "개 이상" : "개"}` : "";
      const retention = record?.status === "revision_requested"
        ? "원본은 내 위브에 남습니다. 다시 공개하려면 운영 안내를 확인해 주세요."
        : "원본은 내 위브에 남고 비공개 초안으로 복원할 수 있어요.";
      const question = impact
        ? `이 자료를 삭제할까요? 연결된 활동 ${linkedCount}에서도 보이지 않게 됩니다. ${retention}`
        : `이 활동 기록을 삭제할까요? ${retention}`;
      if (!window.confirm(question)) {
        setWorking(false);
        return;
      }
      await requestSubmissionChange(id, "unpublish");
      navigate(returnTo, { replace: true });
    } catch {
      setError("글을 목록에서 삭제하지 못했어요. 다시 시도해 주세요.");
      setWorking(false);
    }
  };

  return <section className="owned-content-actions" aria-label={kind === "material" ? "내가 올린 자료 관리" : "내가 올린 활동 기록 관리"}>
    <span>{phase === "ready" && record ? (kind === "material" ? "내가 올린 자료" : "내가 올린 활동 기록") : "관리 권한 확인"}</span>
    {phase === "loading" && <p role="status">수정 권한을 확인하고 있어요.</p>}
    {phase === "error" && <p role="alert">수정 권한을 확인하지 못했어요. <button type="button" onClick={retry}>다시 확인</button></p>}
    {phase === "ready" && (record?.availableActions.includes("request_revision") || record?.availableActions.includes("edit")) && <button className="button button-secondary" type="button" onClick={() => void edit()} disabled={working}><Pencil size={16} aria-hidden="true" /> 수정</button>}
    {phase === "ready" && record?.availableActions.includes("unpublish") && <button className="button button-quiet" type="button" onClick={() => void unpublish()} disabled={working}><Trash2 size={16} aria-hidden="true" /> 삭제</button>}
    {phase === "ready" && record && !record.availableActions.includes("request_revision") && !record.availableActions.includes("edit") && <p role="status">현재 상태는 내 위브에서 확인할 수 있어요.</p>}
    {!record && operator.state === "allowed" && <a className="button button-secondary" href="/admin/submissions">운영 센터에서 관리</a>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
