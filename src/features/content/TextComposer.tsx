import { FieldRequirement } from "../../components/forms/FieldRequirement";
import { useId, useRef, useState } from 'react';
import { MarkdownBody } from './MarkdownBody';
import { importText } from './text-content';
import styles from './TextContent.module.css';

export function TextComposer({ value, onChange, required = false, format, onFormatChange }: { format: 'plain' | 'markdown'; onFormatChange: (format: 'plain' | 'markdown') => void; value: string; onChange: (value: string) => void; required?: boolean }) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  const formatTrigger = useRef<HTMLButtonElement | null>(null);
  const closeExample = () => { setExampleOpen(false); formatTrigger.current?.focus(); };
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  return <section className={styles.composer} aria-label="본문 작성">
    <div className={styles.toolbar}>
      <label htmlFor={id}>내용 <FieldRequirement optional={!required} /></label>
      <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? '작성하기' : '미리보기'}</button>
    </div>
    <div className={styles.formatHelp} onKeyDown={event => { if (event.key === 'Escape' && exampleOpen) { event.preventDefault(); closeExample(); } }}>
      <div className={styles.formatChoices} role="group" aria-label="본문 표시 방식">
        <button type="button" aria-pressed={format === 'plain'} aria-expanded={format === 'plain' && exampleOpen} aria-controls={`${id}-example`} onClick={event => { formatTrigger.current = event.currentTarget; onFormatChange('plain'); setExampleOpen(true); }}>입력한 모양 유지</button>
        <button type="button" aria-pressed={format === 'markdown'} aria-expanded={format === 'markdown' && exampleOpen} aria-controls={`${id}-example`} onClick={event => { formatTrigger.current = event.currentTarget; onFormatChange('markdown'); setExampleOpen(true); }}>제목·목록으로 정리</button>
      </div>
      {exampleOpen && <aside id={`${id}-example`} className={styles.exampleBubble} aria-label="본문 표시 예시">
        <div className={styles.exampleHeader}><strong>{format === 'plain' ? '쓴 모양 그대로 보여요' : '기호가 제목과 목록으로 바뀌어요'}</strong><button type="button" aria-label="예시 닫기" onClick={closeExample}>×</button></div>
        <div className={styles.exampleColumns}>
          <div><span className={styles.exampleLabel}>이렇게 입력하면</span><pre>{format === 'plain' ? '이름    맡은 일\n민규    진행\n\n  준비물 확인하기' : '# 모임 안내\n\n- 노트 가져오기\n- 10분 먼저 도착하기'}</pre></div>
          <div><span className={styles.exampleLabel}>이렇게 보여요</span>{format === 'plain' ? <pre>이름    맡은 일{'\n'}민규    진행{'\n\n'}  준비물 확인하기</pre> : <div className={styles.exampleResult}><h4>모임 안내</h4><ul><li>노트 가져오기</li><li>10분 먼저 도착하기</li></ul></div>}</div>
        </div>
        <p>예시는 작성 중인 내용에 들어가지 않아요.</p>
      </aside>}
    </div>
    <p id={`${id}-help`}>{format === 'plain' ? '띄어쓰기·들여쓰기·줄바꿈을 그대로 보여 줍니다. 긴 줄은 좌우로 스크롤할 수 있어요.' : '줄 앞에 #을 붙이면 제목, -를 붙이면 목록으로 보여 줍니다. 미리보기에서 확인해 보세요.'}</p>
    {preview ? <MarkdownBody format={format} body={value || '아직 적은 내용이 없어요.'} /> : <textarea className={format === "plain" ? styles.plainEditor : undefined} wrap={format === "plain" ? "off" : "soft"} id={id} value={value} required={required} maxLength={50_000}
      aria-describedby={`${id}-help`} onChange={event => onChange(event.target.value)} placeholder="공유할 내용을 적어 주세요" />}
    <div className={styles.toolbar}>
      <label className={styles.importPicker}><span>텍스트 파일 가져오기</span><input ref={importInput} type="file" accept=".txt,.md,text/plain,text/markdown" onClick={event => { event.currentTarget.value = ''; }} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setError('');
        try {
          if (file.size > 1024 * 1024) throw new Error('1MB 이하의 파일을 선택해 주세요.');
          setPending(importText(file.name, await file.arrayBuffer()));
        } catch (e) { setError(e instanceof Error ? e.message : '파일을 읽지 못했어요.'); }
      }} /></label>
      <span>{value.length.toLocaleString()} / 50,000자</span>
    </div>
    <p>TXT·MD는 1MB 이하만 가져올 수 있으며, 가져온 뒤 본문 전체가 50,000자를 넘지 않아야 해요.</p>
    {pending !== null && <div className={styles.importPanel}>
      <p>가져온 내용 ({pending.length.toLocaleString()}자)</p><pre>{pending.slice(0, 1000)}{pending.length > 1000 ? '\n…' : ''}</pre>
      <div className={styles.toolbar}>
        <button type="button" onClick={() => { const next = value ? `${value}\n\n${pending}` : pending; if (next.length > 50_000) { setError('추가하면 50,000자를 넘어요.'); return; } onChange(next); setPending(null); }}>뒤에 추가</button>
        <button type="button" onClick={() => { onChange(pending); setPending(null); }}>본문 교체</button>
        <button type="button" onClick={() => { setPending(null); importInput.current?.focus(); }}>취소</button>
      </div>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
