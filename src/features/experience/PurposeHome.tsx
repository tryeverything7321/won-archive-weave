import { ArrowRight, CalendarDays, Files, PenLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './Experience.module.css';

const purposes = [
  { to: '/resources', label: '쓸 만한 자료 찾기', detail: '행사 준비와 모임에 필요한 자료를 찾아보세요', icon: Files, cue: '자료 나눔' },
  { to: '/calendar', label: '참여할 행사 찾기', detail: '날짜와 장소를 확인하고 참여 방법을 알아보세요', icon: CalendarDays, cue: '행사 일정' },
  { to: '/contribute', label: '기록·자료 남기기', detail: '지난 활동의 경험과 다음 사람에게 유용한 자료를 나눠요', icon: PenLine, cue: '등록하기' },
];

export function PurposeHome() {
  return <section className={`section-frame ${styles.home}`} aria-labelledby="purpose-home-title">
    <div className={styles.homeHeading}>
      <p>기록을 모으고, 다음 만남을 잇는 위브</p>
      <h1 id="purpose-home-title">오늘 필요한 것부터<br />시작해 보세요</h1>
      <span>자료를 찾고, 행사에 참여하고, 우리의 경험을 함께 남기는 공간입니다.</span>
    </div>
    <nav className={styles.purposes} aria-label="위브에서 시작할 일">
      {purposes.map(({ to, label, detail, icon: Icon, cue }) => <Link key={to} to={to} className={styles.purpose}>
        <div className={styles.purposeCue}><Icon size={24} aria-hidden="true" /><span>{cue}</span></div>
        <h2>{label}</h2><p>{detail}</p><span className={styles.purposeAction}><span className={styles.purposeActionLabel}>바로 시작하기</span> <ArrowRight size={20} aria-hidden="true" /></span>
      </Link>)}
    </nav>

  </section>;
}
