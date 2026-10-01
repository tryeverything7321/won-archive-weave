import { useId, useRef, useState } from 'react';
import { MarkdownBody } from './MarkdownBody';
import { importText } from './text-content';
import styles from './TextContent.module.css';

export function TextComposer({ value, onChange, required = false }: { value: string; onChange: (value: string) => void; required?: boolean }) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  return <section className={styles.composer} aria-label="본문 작성">
    <div className={styles.toolbar}>
      <label htmlFor={id}>내용{required ? ' (필수)' : ' (선택)'}</label>
      <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? '작성하기' : '미리보기'}</button>
    </div>
    <p id={`${id}-help`}>회의록이나 카카오톡에 적어 둔 내용을 붙여 넣으세요. Markdown도 사용할 수 있어요.</p>
    {preview ? <MarkdownBody body={value || '아직 적은 내용이 없어요.'} /> : <textarea id={id} value={value} required={required} maxLength={50_000}
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
