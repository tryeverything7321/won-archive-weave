import { useEffect, useId, useRef, useState } from 'react';
import { CalendarPlus, ChevronDown, FilePlus2, MessageCircle, NotebookPen, Plus } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import styles from './Experience.module.css';

const choices = [
  { to: '/contribute?intent=activity', label: '활동 기록 남기기', detail: '이미 함께한 활동의 후기', icon: NotebookPen },
  { to: '/contribute?intent=material', label: '자료 나누기', detail: '다음 모임에 도움이 될 파일과 링크', icon: FilePlus2 },
  { to: '/calendar/new', label: '행사 알리기', detail: '앞으로 열릴 행사의 일정과 참여 안내', icon: CalendarPlus },
  { to: '/community?compose=1', label: '이야기 남기기', detail: '요즘의 생각과 궁금한 점', icon: MessageCircle },
];

export function CreateMenu({ mobile = false }: { mobile?: boolean }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // Route changes unmount the open panel without moving focus away from the new page.
  const [openedAt, setOpenedAt] = useState(location.key);
  const visible = open && openedAt === location.key;
  useEffect(() => {
    if (!visible) return;
    root.current?.querySelector<HTMLAnchorElement>('nav a')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [visible]);
  return <div ref={root} className={`${styles.createMenu} ${mobile ? styles.mobileCreate : ''}`} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className={styles.createTrigger} aria-expanded={visible} aria-controls={id} onClick={() => { setOpenedAt(location.key); setOpen(!visible); }}>
      <Plus size={19} aria-hidden="true" /><span>만들기</span>{!mobile && <ChevronDown size={15} aria-hidden="true" />}
    </button>
    {visible && <nav id={id} className={styles.createPanel} aria-label="만들 콘텐츠 선택">
      <p>무엇을 남기고 싶나요</p>
      {choices.map(({ to, label, detail, icon: Icon }) => <Link key={to} to={to} onClick={() => setOpen(false)}>
        <Icon size={22} aria-hidden="true" /><span><b>{label}</b><small>{detail}</small></span>
      </Link>)}
    </nav>}
  </div>;
}
