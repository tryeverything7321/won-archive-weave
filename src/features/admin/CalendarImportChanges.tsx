import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../../lib/firebase/client';
import {
  readCalendarImportComparison,
  type CalendarImportChange,
  type CalendarImportComparison,
} from './calendar-import-changes-model';
import './CalendarImportChanges.css';

function display(value: CalendarImportChange['currentValue']) {
  if (value === null || value === '') return '내용 없음';
  if (typeof value === 'boolean') return value ? '예' : '아니요';
  if (value === 'member_only') return '위브 로그인 이용자에게 공개';
  if (value === 'public') return '누구나 공개';
  return value;
}

export function CalendarImportChanges({ candidateId }: { candidateId: string }) {
  const services = useMemo(() => getFirebaseServices(), []);
  const generation = useRef(0);
  const [comparison, setComparison] = useState<CalendarImportComparison>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!services) return;
    const stop = onAuthStateChanged(services.auth, () => {
      generation.current += 1;
      setComparison(undefined); setSelected([]); setNotice(''); setBusy(false);
    });
    return () => { generation.current += 1; stop(); };
  }, [services, candidateId]);
  const load = async () => {
    if (!services || busy) return;
    const turn = ++generation.current;
    setBusy(true); setNotice(''); setComparison(undefined); setSelected([]);
    try {
      const result = await httpsCallable(services.functions, 'getCalendarImportChange')({ candidateId });
      if (turn !== generation.current) return;
      const next = readCalendarImportComparison(result.data);
      if (next.candidateId !== candidateId) throw Error('wrong candidate');
      setComparison(next);
    } catch {
      if (turn === generation.current) setNotice('변경 내용을 불러오지 못했어요. 다시 확인해 주세요.');
    } finally { if (turn === generation.current) setBusy(false); }
  };
  const apply = async () => {
    if (!services || !comparison || busy || !selected.length || comparison.sourceStatus !== 'active') return;
    const turn = ++generation.current;
    setBusy(true); setNotice('');
    try {
      await httpsCallable(services.functions, 'applyCalendarImportChange')({
        candidateId, expectedSourceRevision: comparison.sourceRevision,
        expectedEventRevision: comparison.eventRevision, fields: selected,
      });
      if (turn !== generation.current) return;
      setComparison(undefined); setSelected([]);
      setNotice('선택한 변경을 적용했어요. 남은 변경은 다시 비교해 주세요.');
    } catch {
      if (turn !== generation.current) return;
      setComparison(undefined); setSelected([]);
      setNotice('적용을 완료하지 못했어요. 원본이나 위브 내용이 바뀌었을 수 있으니 다시 비교해 주세요.');
    } finally { if (turn === generation.current) setBusy(false); }
  };
  return <section className="calendar-import-changes" aria-label="원본 변경 비교">
    <button className="button button-secondary" type="button" disabled={busy} onClick={() => void load()}>{busy ? '처리 중' : '원본 변경 비교'}</button>
    {notice && <p role="status">{notice}</p>}
    {comparison && <div>
      <p>위브에 반영할 항목만 선택해 주세요. 선택하지 않은 내용은 그대로 유지됩니다.</p>
      {comparison.sourceStatus === 'disconnected' && <p role="status">연결이 해제되어 비교만 할 수 있어요. 위브에 등록된 일정은 유지됩니다.</p>}
      {comparison.changes.length === 0 ? <p>반영할 원본 변경이 없어요.</p> : <fieldset disabled={busy || comparison.sourceStatus !== 'active'}>
        <legend>반영할 변경 선택</legend>
        {comparison.changes.map(change => <div className="calendar-import-change" key={change.field}>
          <label><input type="checkbox" checked={selected.includes(change.field)} onChange={event => setSelected(current => event.target.checked ? [...current, change.field] : current.filter(field => field !== change.field))} />{change.label}</label>
          <dl><div><dt>현재 위브</dt><dd>{display(change.currentValue)}</dd></div><div><dt>바뀐 원본</dt><dd>{display(change.sourceValue)}</dd></div></dl>
        </div>)}
        <button className="button" type="button" disabled={!selected.length || busy} onClick={() => void apply()}>선택한 {selected.length}개 변경 적용</button>
      </fieldset>}
    </div>}
  </section>;
}
