import { Link, useLocation } from 'react-router-dom';
import { Star } from 'lucide-react';
import { OPENING_HREF } from './opening-community-model';
export function OpeningCommunityTabs() {
  const opening = new URLSearchParams(useLocation().search).get('tab') === 'opening';
  return <nav className="community-section-tabs" aria-label="커뮤니티 게시판">
    <Link to="/community" aria-current={!opening ? 'page' : undefined}>전체 이야기</Link>
    <Link to={OPENING_HREF} aria-current={opening ? 'page' : undefined}>오픈 응원 <span className="community-new"><Star size={14} fill="currentColor" aria-hidden="true" />New!</span></Link>
  </nav>;
}
