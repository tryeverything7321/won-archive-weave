import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, startAfter, type QueryDocumentSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../../lib/firebase/client';
import { createModerationRequestTracker } from '../community/moderation-request';
import { moderationCommand, type ContentAction } from './content-moderation-model';
import styles from './ContentModerationPanel.module.css';

const labels: Record<ContentAction, string> = { warn: '안내 보내기', request_correction: '수정 요청', hold: '긴급 숨김', remove: '안내 후 공개 중단', restore: '공개 복구' };

export function ContentModerationPanel({ kind }: { kind: 'submission' | 'event' }) {
  const services = useMemo(() => getFirebaseServices(), []);
  const requests = useMemo(() => createModerationRequestTracker(), []);
  const [items, setItems] = useState<{ id: string; title: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [action, setAction] = useState<ContentAction>('warn');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [more, setMore] = useState(false);
  const cursor = useRef<QueryDocumentSnapshot | null>(null);
  const load = useCallback(async (append = false) => {
    if (!services) return;
    setBusy(true);
    try {
      const constraints = [orderBy('updatedAt', 'desc'), ...(append && cursor.current ? [startAfter(cursor.current)] : []), limit(20)];
      const snapshot = await getDocs(query(collection(services.firestore, kind === 'submission' ? 'submissions' : 'calendarEventSubmissions'), ...constraints));
      const next = snapshot.docs.map(doc => ({ id: doc.id, title: String(doc.get('title') || '제목 없음') }));
      setItems(current => append ? [...new Map([...current, ...next].map(item => [item.id, item])).values()] : next);
      cursor.current = snapshot.docs.at(-1) ?? null;
      setMore(snapshot.size === 20);
    } catch { setMessage('목록을 불러오지 못했어요. 운영 권한과 연결 상태를 확인해 주세요.'); }
    finally { setBusy(false); }
  }, [kind, services]);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const submit = async () => {
    if (!services || !selected || busy) return;
    if (!window.confirm(`${items.find(item => item.id === selected)?.title ?? '선택한 내용'}에 '${labels[action]}' 조치를 적용할까요? 작성자에게 사유가 표시됩니다.`)) return;
    setBusy(true);
    try {
      const key = JSON.stringify([kind, selected, action, reason.trim()]);
      const command = moderationCommand(kind, selected, action, reason, requests.idFor(key));
      await httpsCallable(services.functions, command.callable)(command.data);
      requests.clear();
      setMessage('처리했습니다. 작성자는 내 위브에서 사유를 확인할 수 있어요.');
      setReason('');
    } catch { setMessage('처리하지 못했어요. 사유와 현재 상태를 확인해 주세요. 공개 중단은 먼저 안내를 보낸 뒤 가능합니다.'); }
    finally { setBusy(false); }
  };
  return <section className={styles.panel} aria-label={kind === 'submission' ? '활동·자료 운영 안내' : '행사 운영 안내'}>
    <h2>{kind === 'submission' ? '활동·자료 운영 안내' : '행사 운영 안내'}</h2>
    <p>일반 등록은 사전 승인하지 않습니다. 문제가 있는 내용에만 사유를 안내하거나 공개를 중단하세요. 원본과 처리 이력은 보존됩니다.</p>
    <label>대상 선택<select value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setReason(''); requests.clear(); }}><option value="">최근 등록·수정된 내용에서 선택</option>{items.map(item => <option key={item.id} value={item.id}>{item.title} · {item.id.slice(-6)}</option>)}</select></label>
    <button type="button" disabled={busy} onClick={() => void load(false)}>목록 새로고침</button>
    {more && <button type="button" disabled={busy} onClick={() => void load(true)}>이전 내용 더 불러오기</button>}
    <label>조치<select value={action} disabled={busy} onChange={event => setAction(event.target.value as ContentAction)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>작성자에게 보낼 사유<textarea value={reason} minLength={2} maxLength={300} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="어떤 내용을 왜 수정해야 하는지 적어 주세요" /></label>
    <button type="button" className="button button-primary" disabled={busy || !selected || reason.trim().length < 2} onClick={() => void submit()}>{busy ? '처리 중' : labels[action]}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
