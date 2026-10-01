import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { getFirebaseServices } from '../../lib/firebase/client';
import { FEEDBACK_HREF, isLaunchMember, launchNudgeReady } from './launch-feedback-model';
import styles from './LaunchFeedbackNudge.module.css';

export function LaunchFeedbackNudge() {
  const { pathname } = useLocation();
  const [owner, setOwner] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const progress = useRef({ seconds: 0, pages: new Set<string>(), dismissed: false });
  const path = useRef(pathname);
  useEffect(() => { path.current = pathname; }, [pathname]);

  useEffect(() => {
    const services = getFirebaseServices();
    if (!services) return;
    return onAuthStateChanged(services.auth, user => {
      progress.current = { seconds: 0, pages: new Set(), dismissed: false };
      setVisible(false);
      const eligible = user && isLaunchMember(user.metadata?.creationTime, Date.now());
      const key = eligible ? `weave-launch-feedback-v1:${user.uid}` : null;
      let dismissed = false;
      try { dismissed = Boolean(key && localStorage.getItem(key)); } catch { /* Memory-only dismissal is still available. */ }
      progress.current.dismissed = dismissed;
      setOwner(key && !dismissed ? key : null);
    });
  }, []);

  useEffect(() => {
    if (!owner) return;
    const timer = window.setInterval(() => {
      const current = progress.current;
      if (current.dismissed || document.visibilityState !== 'visible') return;
      const focused = document.activeElement;
      const interrupted = Boolean(!document.querySelector("main h1") || focused?.matches('input,textarea,select,[contenteditable="true"]')
        || document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]'));
      if (interrupted) { setVisible(false); return; }
      current.seconds += 1;
      current.pages.add(path.current);
      if (launchNudgeReady(current.seconds, current.pages.size, false)) setVisible(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [owner]);

  const dismiss = () => {
    progress.current.dismissed = true;
    setVisible(false);
    if (owner) { try { localStorage.setItem(owner, 'dismissed'); } catch { /* Keep closed in this session. */ } }
  };
  if (!visible || pathname === '/community') return null;
  return <aside className={styles.nudge} aria-label="위브 오픈과 피드백 안내">
    <button className={styles.close} type="button" aria-label="피드백 안내 닫기" onClick={dismiss}><X size={18} aria-hidden="true" /></button>
    <p><Sparkles size={18} aria-hidden="true" /> 10월 1일 위브 공식 오픈</p>
    <strong>써보니 어떠셨나요?</strong>
    <span>좋았던 점, 불편했던 점을 함께 알려주세요</span>
    <Link to={FEEDBACK_HREF} onClick={dismiss}>피드백 남기기 <ArrowRight size={17} aria-hidden="true" /></Link>
  </aside>;
}
