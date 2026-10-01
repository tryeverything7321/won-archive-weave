import { useEffect, useId, useRef, useState } from 'react';
import styles from './ActionDialog.module.css';

export type ActionDialogRequest = {
  title: string;
  target: string;
  description: string;
  confirmLabel: string;
  requireReason?: boolean;
  initialReason?: string;
  onConfirm: (reason: string) => Promise<void>;
};

export function ActionDialog({ request, onClose }: { request: ActionDialogRequest | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  useEffect(() => {
    const node = dialog.current;
    if (!request || !node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReason(request.initialReason ?? '');
    setError('');
    setWorking(false);
    inFlight.current = false;
    node.showModal();
    if (request.requireReason) field.current?.focus();
    return () => {
      node.close();
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>('.admin-nav a, main h1')?.focus();
    };
  }, [request]);
  if (!request) return null;
  const submit = async () => {
    if (inFlight.current) return;
    const value = reason.trim();
    if (request.requireReason && (value.length < 2 || value.length > 300)) {
      setError('사유를 2~300자로 입력해 주세요'); field.current?.focus(); return;
    }
    inFlight.current = true; setWorking(true); setError('');
    try { await request.onConfirm(value); onClose(); }
    catch { setError('처리를 완료하지 못했어요. 입력한 사유를 확인하고 다시 시도해 주세요. 다른 운영자가 처리한 경우 목록을 새로고침해 주세요.'); }
    finally { inFlight.current = false; setWorking(false); }
  };
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); if (!inFlight.current) onClose(); }}>
    <h2 id={titleId}>{request.title}</h2>
    <p className={styles.target}>{request.target}</p>
    <p id={descriptionId}>{request.description}</p>
    {request.requireReason && <label className={styles.field}>처리 사유<textarea ref={field} value={reason} onChange={event => setReason(event.target.value)} maxLength={300} rows={4} disabled={working} aria-invalid={Boolean(error) || undefined} /><span>{reason.length}/300</span></label>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <button type="button" className="button button-secondary" onClick={onClose} disabled={working}>취소</button>
      <button type="button" className="button button-primary" onClick={() => void submit()} disabled={working}>{working ? '처리 중' : request.confirmLabel}</button>
    </div>
  </dialog>;
}
