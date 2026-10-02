import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, X, Frown, Lightbulb, Heart, MessagesSquare } from 'lucide-react';
import styles from './LaunchFeedbackNudge.module.css';

const choices = [
  { kind: 'problem', label: '불편해요', icon: Frown },
  { kind: 'idea', label: '이런 기능 원해요', icon: Lightbulb },
  { kind: 'thanks', label: '좋았어요', icon: Heart },
];
export function LaunchFeedbackNudge() {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const container = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem('weave-feedback-hint-v2') === '1'; } catch { /* Optional visual hint. */ }
    if (seen) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible' || document.querySelector('dialog[open]')) return;
      setHighlight(true);
      try { localStorage.setItem('weave-feedback-hint-v2', '1'); } catch { /* No persistent storage. */ }
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    container.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);
  return <aside ref={container} className={`${styles.widget} weave-feedback-widget`} aria-label="위브 의견 보내기" onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } }}>
    {open && <section className={styles.panel} id="weave-feedback-panel" aria-labelledby="weave-feedback-title">
      <button type="button" className={styles.close} aria-label="의견 보내기 닫기" onClick={close}><X size={20} aria-hidden="true" /></button>
      <h2 id="weave-feedback-title">어떤 이야기를 나눌까요?</h2>
      <p>커뮤니티에 공개되는 의견입니다.<br />다른 이용자도 댓글로 함께 이야기할 수 있어요.</p>
      <div className={styles.choices}>{choices.map(({kind,label,icon:Icon})=><Link key={kind} to={`/community?compose=1&feedback=launch&feedbackType=${kind}`} onClick={close}><Icon size={20} aria-hidden="true" />{label}</Link>)}</div>
      <Link className={styles.browse} to="/community?feedback=launch&view=feedback" onClick={close}><MessagesSquare size={18} aria-hidden="true" />다른 의견과 댓글 보기</Link>
    </section>}
    <button ref={trigger} className={`${styles.trigger} ${highlight ? styles.highlight : ''}`} type="button" aria-expanded={open} aria-controls="weave-feedback-panel" onClick={()=>{setOpen(!open);setHighlight(false);}}><MessageCircle size={19} aria-hidden="true" />의견 보내기</button>
  </aside>;
}
