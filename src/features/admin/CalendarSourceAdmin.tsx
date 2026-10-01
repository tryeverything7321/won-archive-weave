import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, ExternalLink, RefreshCw } from "lucide-react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref } from "firebase/storage";
import { getFirebaseServices } from "../../lib/firebase/client";
import { createModerationRequestTracker } from '../community/moderation-request';
import { CalendarImportChanges } from './CalendarImportChanges';

type CalendarSource = {
  id: string;
  name: string;
  organizerName: string;
  sourceType: string;
  status: string;
  feedUrl?: string;
  publicUrl?: string;
  lastSyncCount?: number;
};

type CalendarCandidate = {
  id: string;
  title: string;
  organizerName: string;
  startAt?: { toDate?: () => Date };
  sourceUrl?: string;
  status: string;
  sourceChangeStatus?: string;
};

type ManualEventReview = {
  id: string;
  title: string;
  organizerName: string;
  region: string;
  visibility: string;
  reviewReason: string;
  mediaScanStatus: string;
  mediaUploads: { storagePath: string; alt: string; role: string }[];
  updatedAt?: { toDate?: () => Date };
};

function reviewReasonLabel(reason: string) {
  return {
    media_scan_blocked: "사진 안전 검사에서 차단됨",
    automatic_media_scan_failed: "사진 안전 검사를 완료하지 못함",
    automatic_publication_failed: "자동 공개를 완료하지 못함",
  }[reason] ?? "자동 처리 예외";
}

function EventReviewMedia({ uploads }: { uploads: ManualEventReview["mediaUploads"] }) {
  const services = useMemo(() => getFirebaseServices(), []);
  const [items, setItems] = useState<{ url: string; alt: string; role: string }[]>([]);
  useEffect(() => {
    if (!services || uploads.length === 0) return;
    let active = true;
    void Promise.all(uploads.map(async (item) => ({
      url: await getDownloadURL(ref(services.storage, item.storagePath)),
      alt: item.alt,
      role: item.role,
    }))).then((next) => {
      if (active) setItems(next);
    }).catch(() => {
      if (active) setItems([]);
    });
    return () => { active = false; };
  }, [services, uploads]);
  if (!items.length) return null;
  return <div className="calendar-admin-media" aria-label="확인이 필요한 행사 사진">
    {items.map((item) => <figure key={item.url}><img src={item.url} alt={item.alt} /><figcaption>{item.role === "thumbnail" ? "대표 사진" : "추가 사진"} · {item.alt}</figcaption></figure>)}
  </div>;
}

export function CalendarSourceAdmin() {
  const requests = useMemo(() => createModerationRequestTracker(), []);
  const services = useMemo(() => getFirebaseServices(), []);
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [candidates, setCandidates] = useState<CalendarCandidate[]>([]);
  const [manualEvents, setManualEvents] = useState<ManualEventReview[]>([]);
  const [note, setNote] = useState("공개 범위와 주최 정보를 확인했습니다");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!services) return;
    const stopSources = onSnapshot(
      query(collection(services.firestore, "calendarSources"), orderBy("updatedAt", "desc"), limit(50)),
      (snapshot) => setSources(snapshot.docs.map((item) => ({
        id: item.id,
        name: String(item.get("name") ?? "이름 없는 캘린더"),
        organizerName: String(item.get("organizerName") ?? "운영 주체 확인 전"),
        sourceType: String(item.get("sourceType") ?? "ics"),
        status: String(item.get("status") ?? "review_queued"),
        ...(typeof item.get("feedUrl") === "string" ? { feedUrl: item.get("feedUrl") as string } : {}),
        ...(typeof item.get("publicUrl") === "string" ? { publicUrl: item.get("publicUrl") as string } : {}),
        ...(typeof item.get("lastSyncCount") === "number" ? { lastSyncCount: item.get("lastSyncCount") as number } : {}),
      }))),
    );
    const stopCandidates = onSnapshot(
      query(collection(services.firestore, "calendarImportCandidates"), orderBy("updatedAt", "desc"), limit(50)),
      (snapshot) => setCandidates(snapshot.docs.map((item) => ({
        id: item.id,
        title: String(item.get("title") ?? "제목 없는 일정"),
        organizerName: String(item.get("organizerName") ?? "주최 확인 전"),
        status: String(item.get("status") ?? "pending_review"),
        sourceChangeStatus: String(item.get("sourceChangeStatus") ?? "none"),
        ...(item.get("startAt") ? { startAt: item.get("startAt") as CalendarCandidate["startAt"] } : {}),
        ...(typeof item.get("sourceUrl") === "string" ? { sourceUrl: item.get("sourceUrl") as string } : {}),
      }))),
    );
    const stopManualEvents = onSnapshot(
      query(collection(services.firestore, "calendarEventSubmissions"), orderBy("updatedAt", "desc"), limit(50)),
      (snapshot) => setManualEvents(snapshot.docs
        .filter((item) => item.get("status") === "publishing_failed")
        .map((item) => ({
          id: item.id,
          title: String(item.get("title") ?? "제목 없는 행사"),
          organizerName: String(item.get("organizerName") ?? "주최 확인 전"),
          region: String(item.get("region") ?? "지역 확인 전"),
          visibility: String(item.get("visibility") ?? "public"),
          reviewReason: String(item.get("reviewReason") ?? "운영 확인 필요"),
          mediaScanStatus: String(item.get("mediaScanStatus") ?? "pending"),
          mediaUploads: Array.isArray(item.get("mediaUploads"))
            ? (item.get("mediaUploads") as Record<string, unknown>[]).flatMap((media) => (
                typeof media.storagePath === "string" && typeof media.alt === "string"
                  ? [{ storagePath: media.storagePath, alt: media.alt, role: String(media.role ?? "gallery") }]
                  : []
              ))
            : [],
          ...(item.get("updatedAt") ? { updatedAt: item.get("updatedAt") as ManualEventReview["updatedAt"] } : {}),
        }))),
    );
    return () => { stopSources(); stopCandidates(); stopManualEvents(); };
  }, [services]);

  const run = async (key: string, name: string, data: Record<string, unknown>) => {
    if (!services || !note.trim()) return;
    const reason = name === 'reviewManualEvent' && data.decision === 'reject'
      ? window.prompt('작성자에게 보낼 수정 사유를 적어 주세요 (2~300자).')?.trim() : undefined;
    if (name === 'reviewManualEvent' && data.decision === 'reject' && (!reason || reason.length < 2 || reason.length > 300)) return;
    setBusy(key);
    setNotice("");
    try {
      await httpsCallable(services.functions, name)({ ...data, note: reason ?? note.trim(), ...(reason ? { requestId: requests.idFor(JSON.stringify([key, name, reason])) } : {}) });
      requests.clear();
      setNotice("요청을 처리했습니다. 목록에 반영되기까지 잠시 걸릴 수 있어요.");
    } catch {
      setNotice("요청을 처리하지 못했어요. 운영 권한과 원본 공개 설정을 확인해 주세요.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="calendar-admin-stack">
      <label className="calendar-admin-note"><span>처리 메모</span><input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
      {notice && <p className="review-notice" role="status">{notice}</p>}
      <section>
        <div className="resource-collection-heading"><div><h2>행사 자동 처리 예외</h2><p>사진 검사나 자동 공개를 완료하지 못한 행사만 이곳에서 확인합니다.</p></div><span>{manualEvents.length}건</span></div>
        <div className="calendar-admin-list">
          {manualEvents.length === 0 && <p>확인이 필요한 행사가 없습니다.</p>}
          {manualEvents.map((event) => (
            <article key={event.id}>
              <CalendarCheck2 size={22} />
              <div>
                <small>{event.region} · {event.visibility === "member_only" ? "위브 로그인 이용자 공개" : "전체 공개"} · 사진 {event.mediaUploads.length}장</small>
                <h3>{event.title}</h3>
                <p>{event.organizerName} · {reviewReasonLabel(event.reviewReason)}</p>
                {event.mediaUploads.length > 0 && event.mediaScanStatus !== "clean" && <p className="review-notice">사진 안전 검사가 끝나면 공개할 수 있어요.</p>}
                <EventReviewMedia uploads={event.mediaUploads} />
              </div>
              <div className="calendar-admin-actions">
                <button disabled={Boolean(busy) || (event.mediaUploads.length > 0 && event.mediaScanStatus !== "clean")} onClick={() => void run(`manual-${event.id}`, "reviewManualEvent", { eventId: event.id, decision: "approve" })}>행사 공개</button>
                <button disabled={Boolean(busy)} onClick={() => void run(`manual-${event.id}`, "reviewManualEvent", { eventId: event.id, decision: "reject" })}>보완 요청</button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <div className="resource-collection-heading"><div><h2>캘린더 연결 요청</h2><p>공개 주소와 운영 주체를 확인한 뒤 연결을 승인해 주세요.</p></div><span>{sources.length}건</span></div>
        <div className="calendar-admin-list">
          {sources.length === 0 && <p>아직 캘린더 연결 요청이 없습니다.</p>}
          {sources.map((source) => (
            <article key={source.id}>
              <div><small>{source.sourceType} · {source.status}</small><h3>{source.name}</h3><p>{source.organizerName}</p></div>
              <div className="calendar-admin-actions">
                {(source.feedUrl || source.publicUrl) && <a href={source.feedUrl ?? source.publicUrl} target="_blank" rel="noopener noreferrer" aria-label={`${source.name} 원본 열기`}><ExternalLink size={17} /> 원본</a>}
                {source.status === "review_queued" && <><button disabled={Boolean(busy)} onClick={() => void run(`source-${source.id}`, "reviewCalendarSource", { sourceId: source.id, decision: "activate" })}>연결 승인</button><button disabled={Boolean(busy)} onClick={() => void run(`source-${source.id}`, "reviewCalendarSource", { sourceId: source.id, decision: "reject" })}>반려</button></>}
                {source.status === "active" && source.sourceType === "google_public_ics" && <button disabled={Boolean(busy)} onClick={() => void run(`sync-${source.id}`, "syncGooglePublicCalendarSource", { sourceId: source.id })}><RefreshCw size={16} /> {busy === `sync-${source.id}` ? "가져오는 중" : "일정 가져오기"}</button>}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <div className="resource-collection-heading"><div><h2>가져온 일정 검토</h2><p>내용을 확인한 일정만 전국 행사 캘린더에 공개됩니다.</p></div><span>{candidates.filter((item) => item.status === "pending_review").length}건 대기</span></div>
        <div className="calendar-admin-list">
          {candidates.length === 0 && <p>아직 가져온 일정이 없습니다.</p>}
          {candidates.map((candidate) => (
            <article key={candidate.id}>
              <CalendarCheck2 size={22} />
              <div><small>{candidate.status}</small><h3>{candidate.title}</h3><p>{candidate.organizerName}{candidate.startAt?.toDate ? ` · ${new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(candidate.startAt.toDate())}` : ""}</p></div>
              <div className="calendar-admin-actions">
                {candidate.sourceUrl && <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} /> 원본</a>}
                {candidate.status === "pending_review" && <><button disabled={Boolean(busy)} onClick={() => void run(`candidate-${candidate.id}`, "reviewCalendarImportCandidate", { candidateId: candidate.id, decision: "publish" })}>캘린더에 공개</button><button disabled={Boolean(busy)} onClick={() => void run(`candidate-${candidate.id}`, "reviewCalendarImportCandidate", { candidateId: candidate.id, decision: "reject" })}>반려</button></>}
              </div>
              {candidate.status === "published" && candidate.sourceChangeStatus === "pending" && <CalendarImportChanges key={candidate.id} candidateId={candidate.id} />}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
