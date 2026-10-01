import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "../../lib/firebase/client";
import { listArchiveOrganizers, newArchiveRequestId } from "../event-archive/event-archive-api";
import styles from "../event-archive/EventArchive.module.css";

type Organizer = { id: string; displayName: string; aliases?: string[]; activityRegion?: string };

export function ArchiveOrganizerAdmin() {
  const [items, setItems] = useState<Organizer[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [region, setRegion] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requestId = useRef(newArchiveRequestId());
  const load = useCallback(async (next?: string) => {
    setLoading(true); setLoadError("");
    try {
      const result = await listArchiveOrganizers({ limit: 50, cursor: next });
      setItems((current) => [...(next ? current : []), ...result.items]); setCursor(result.nextCursor);
    } catch { setLoadError("주최 목록을 불러오지 못했어요."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  const select = (value: string) => {
    const item = items.find((candidate) => candidate.id === value);
    setId(value); setName(item?.displayName ?? ""); setAliases(item?.aliases?.join("\n") ?? ""); setRegion(item?.activityRegion ?? ""); setMessage(""); requestId.current = newArchiveRequestId();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); const services = getFirebaseServices(); if (!services) return;
    setSaving(true); setMessage("");
    try {
      const result = await httpsCallable<unknown, { organizer: Organizer }>(services.functions, "upsertArchiveOrganizer")({ requestId: requestId.current, ...(id ? { organizerId: id } : {}), displayName: name.trim(), aliases: aliases.split("\n").map((value) => value.trim()).filter(Boolean), activityRegion: region.trim() });
      const saved = result.data.organizer;
      setItems((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      setId(saved.id); setName(saved.displayName); setAliases(saved.aliases?.join("\n") ?? ""); setRegion(saved.activityRegion ?? "");
      requestId.current = newArchiveRequestId(); setMessage("주최 정보를 저장했어요.");
    } catch { setMessage("저장하지 못했어요. 관리자 권한과 입력 내용을 확인한 뒤 다시 시도해 주세요."); }
    finally { setSaving(false); }
  };
  return <section className={styles.section} aria-labelledby="organizer-admin-title">
    <h2 id="organizer-admin-title">주최 이름 관리</h2>
    <p>같은 조직의 표시 이름과 다른 표기를 정리합니다. 자료의 작성자·권리자나 조직 관리 권한은 바뀌지 않습니다.</p>
    <form className={styles.form} onSubmit={save}>
      <label>관리할 주최<select value={id} disabled={saving} onChange={(event) => select(event.target.value)}><option value="">새 주최 등록</option>{items.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      {(cursor || loadError) && <button type="button" disabled={loading} onClick={() => void load(cursor)}>{loadError ? "목록 다시 확인" : "주최 더 보기"}</button>}
      {loading && <p role="status">주최 목록을 불러오는 중</p>}{loadError && <p role="alert">{loadError}</p>}
      <label>표시 이름<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={saving} /></label>
      <label>다른 표기<textarea value={aliases} onChange={(event) => setAliases(event.target.value)} disabled={saving} placeholder="한 줄에 하나씩, 최대 30개" /></label>
      <label>주최의 활동 지역<input maxLength={80} value={region} onChange={(event) => setRegion(event.target.value)} disabled={saving} /></label>
      <button className="button button-primary" disabled={saving} type="submit">{saving ? "저장하는 중" : "주최 정보 저장"}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </section>;
}
