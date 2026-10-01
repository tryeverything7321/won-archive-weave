import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { InstagramGlyph } from "../../components/InstagramGlyph";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "../../lib/firebase/client";

type ConnectionStatus = { configured: boolean; connection: null | { accountName: string; status: string; lastSuccessfulSyncAtMs?: number } };
type ImportItem = { id: string; providerId: string; caption: string; permalink?: string; reviewStatus: string; sourceStatus: string; publishedAtMs: number };

export function InstagramAdmin() {
  const services = useMemo(() => getFirebaseServices(), []);
  const [status, setStatus] = useState<ConnectionStatus>({ configured: false, connection: null });
  const [items, setItems] = useState<ImportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const refreshStatus = useCallback(async () => {
    if (!services) return;
    try {
      const response = await httpsCallable(services.functions, "getOfficialInstagramStatus")();
      setStatus(response.data as ConnectionStatus);
    } catch {
      setStatus({ configured: false, connection: null });
    } finally {
      setLoading(false);
    }
  }, [services]);

  useEffect(() => { void Promise.resolve().then(refreshStatus); }, [refreshStatus]);
  useEffect(() => {
    if (!services) return;
    return onSnapshot(query(collection(services.firestore, "socialImports"), orderBy("publishedAtMs", "desc"), limit(50)), (snapshot) => {
      setItems(snapshot.docs.map((document) => ({
        id: document.id,
        providerId: String(document.get("providerId") ?? ""),
        caption: String(document.get("caption") ?? "설명 없는 게시물"),
        permalink: typeof document.get("permalink") === "string" ? document.get("permalink") as string : undefined,
        reviewStatus: String(document.get("reviewStatus") ?? "pending_review"),
        sourceStatus: String(document.get("sourceStatus") ?? "active"),
        publishedAtMs: Number(document.get("publishedAtMs") ?? 0),
      })));
    });
  }, [services]);

  const call = async (key: string, name: string, data: Record<string, unknown> = {}) => {
    if (!services) return;
    setBusy(key);
    setNotice("");
    try {
      await httpsCallable(services.functions, name)(data);
      setNotice("요청을 처리했습니다.");
      await refreshStatus();
    } catch {
      setNotice("요청을 처리하지 못했어요. Meta 앱 설정과 운영 권한을 확인해 주세요.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="instagram-admin-stack">
      <section className="instagram-admin-connection">
        <InstagramGlyph size={32} />
        <div><p>공식 Instagram</p><h2>{loading ? "연결 상태를 확인하고 있어요" : status.connection ? `@${status.connection.accountName}` : "아직 공식 계정을 연결하지 않았어요"}</h2><span>{status.configured ? "Meta 앱과 접근 토큰 설정을 확인했습니다." : "Meta 앱 승인과 Firebase Secret 설정이 끝나면 연결할 수 있습니다."}</span></div>
        <div className="calendar-admin-actions">
          {!status.connection && <button disabled={!status.configured || Boolean(busy)} onClick={() => void call("connect", "connectOfficialInstagramAccount", { consentAccepted: true, consentVersion: "2026-07-22" })}>공식 계정 연결</button>}
          {status.connection?.status === "active" && <button disabled={Boolean(busy)} onClick={() => void call("sync", "syncOfficialInstagramAccount")}><RefreshCw size={16} /> {busy === "sync" ? "가져오는 중" : "새 게시물 가져오기"}</button>}
          {status.connection && <button disabled={Boolean(busy)} onClick={() => void call("disconnect", "disconnectOfficialInstagramAccount")}><Unplug size={16} /> 연결 해제</button>}
        </div>
      </section>
      {notice && <p className="review-notice" role="status">{notice}</p>}
      <section>
        <div className="resource-collection-heading"><div><h2>게시물 검토</h2><p>Instagram에서 가져온 게시물은 확인을 마친 뒤에만 위브에 보여요.</p></div><span>{items.filter((item) => item.reviewStatus === "pending_review").length}건 대기</span></div>
        <div className="calendar-admin-list">
          {items.length === 0 && <p>아직 가져온 게시물이 없습니다.</p>}
          {items.map((item) => <article key={item.id}><InstagramGlyph size={22} /><div><small>{item.sourceStatus} · {item.reviewStatus}</small><h3>{item.caption.slice(0, 80)}</h3><p>{item.publishedAtMs ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(item.publishedAtMs)) : "게시 시각 확인 전"}</p></div><div className="calendar-admin-actions">{item.permalink && <a href={item.permalink} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} /> 원본</a>}{item.reviewStatus === "pending_review" && <><button disabled={Boolean(busy)} onClick={() => void call(item.id, "reviewOfficialInstagramImport", { providerId: item.providerId, decision: "approve" })}>위브에 공개</button><button disabled={Boolean(busy)} onClick={() => void call(item.id, "reviewOfficialInstagramImport", { providerId: item.providerId, decision: "reject" })}>숨기기</button></>}</div></article>)}
        </div>
      </section>
    </div>
  );
}
