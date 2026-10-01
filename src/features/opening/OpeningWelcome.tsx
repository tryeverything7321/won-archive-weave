import { OPENING_HREF } from "../community/opening-community-model";
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { WeaveLogoLockup } from '../../components/WeaveLogoLockup';
import styles from './OpeningWelcome.module.css';

const seenKey = 'weave-opening-v1-seen';
let dismissedInSession = false;
// The operator chose a dedicated community board instead of a single post.
const encouragementHref = OPENING_HREF;
const features = [
  { title: '필요한 자료를 찾아요', description: '다른 모임의 자료를 다음 활동에 활용해 보세요', href: '/resources', action: '자료 나눔으로 가기' },
  { title: '행사와 기록을 함께 봐요', description: '함께할 행사와 그 자리에서 남긴 자료·후기를 만나 보세요', href: '/calendar', action: '행사 일정으로 가기' },
  { title: '우리 자료도 함께 나눠요', description: '여러 파일을 묶어 올리고 생각과 경험을 남겨 보세요', href: '/contribute?kind=material', action: '자료 올리러 가기' },
];

export function OpeningWelcome() {
  const dialog = useRef<HTMLDialogElement>(null);
  const reopen = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(-1);
  const feature = features[step];
  const remember = () => {
    dismissedInSession = true;
    try { localStorage.setItem(seenKey, '1'); } catch { /* Keep dismissal for this session. */ }
  };
  const close = () => { remember(); dialog.current?.close(); reopen.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    let seen = dismissedInSession;
    try { seen ||= localStorage.getItem(seenKey) === '1'; } catch { /* Storage may be unavailable. */ }
    const node = dialog.current;
    if (!seen) node?.showModal();
    return () => { node?.close(); };
  }, []);
  const encouragement = encouragementHref
    ? <Link to={encouragementHref} onClick={close}>응원의 한마디 남기기 <ArrowRight size={16} aria-hidden="true" /></Link>
    : <span className={styles.pending} aria-disabled="true">응원의 한마디 남기기 <small>준비 중</small></span>;
  return <>
    <div className={styles.entry}><button ref={reopen} type="button" onClick={() => { setStep(-1); dialog.current?.showModal(); }}>위브 오픈 안내 다시 보기 <ArrowRight size={16} aria-hidden="true" /></button></div>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="weave-opening-title" onCancel={event => { event.preventDefault(); close(); }}>
      <button className={styles.close} type="button" aria-label="오픈 안내 닫기" onClick={close}><X size={22} aria-hidden="true" /></button>
      <WeaveLogoLockup className={styles.logo} />
      {step === -1 ? <>
        <h2 id="weave-opening-title">위브의 첫 문을 열었습니다</h2>
        <div className={styles.message}>
          <p>여러 채널에 흩어진 행사 소식,<br />행사가 끝나면 다시 찾기 어려운 자료들.</p>
          <p>우리의 기록이 다음 만남의 시작이 되도록,<br />원불교 청년회가 위브를 마련했습니다.</p>
          <p>함께할 행사를 찾고, 자료와 생각을 자유롭게 나눠 보세요.</p>
        </div>
        <div className={styles.actions}><button className={styles.primary} type="button" onClick={close}>위브 둘러보기</button><button type="button" onClick={() => { remember(); setStep(0); }}>주요 기능 알아보기</button></div>
        <div className={styles.encouragement}>위브의 첫걸음에 {encouragement}</div>
      </> : <>
        <p className={styles.counter} aria-live="polite">주요 기능 {step + 1} / 3</p>
        <h2 id="weave-opening-title">{feature.title}</h2>
        <p className={styles.description}>{feature.description}</p>
        <Link className={styles.destination} to={feature.href} onClick={close}>{feature.action} <ArrowRight size={18} aria-hidden="true" /></Link>
        <div className={styles.actions}><button type="button" onClick={() => setStep(step - 1)}>{step === 0 ? '환영 안내' : '이전'}</button>{step < 2 ? <button className={styles.primary} type="button" onClick={() => setStep(step + 1)}>다음</button> : <button className={styles.primary} type="button" onClick={close}>둘러보기 시작</button>}</div>
        {step === 2 && <div className={styles.encouragement}>{encouragement}</div>}
      </>}
    </dialog>
  </>;
}
