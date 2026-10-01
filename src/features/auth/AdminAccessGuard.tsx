import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { isOAuthConfigured } from '../../lib/firebase/client';
import { startOAuthLogin } from './api';
import { ProviderLoginButton } from './ProviderLoginButton';
import { useOperatorAccess } from './useOperatorAccess';

export function AdminAccessGuard({ children, members = false }: { children: ReactNode; members?: boolean }) {
  const access = useOperatorAccess();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  if (access.state === 'allowed' && (!members || access.memberRead)) return children;
  if (access.state === 'checking') return <section className="route-recovery section-frame" aria-live="polite"><h1>운영 권한을 확인하고 있어요</h1><p>잠시만 기다려 주세요.</p></section>;
  const signedOut = access.state === 'signed-out';
  const failed = access.state === 'error';
  return <section className="route-recovery section-frame" role="alert">
    <ShieldAlert aria-hidden="true" /><span>운영 센터</span>
    <h1>{signedOut ? '운영자 로그인이 필요해요' : failed ? '운영 권한을 확인하지 못했어요' : members ? '회원 조회 권한이 필요해요' : '이 계정에는 운영 권한이 없어요'}</h1>
    <p>{signedOut ? '운영 계정으로 로그인하면 이 화면으로 돌아옵니다.' : failed ? '연결 상태를 확인한 뒤 다시 시도해 주세요.' : '이 기능은 권한이 등록된 계정에서 이용할 수 있습니다.'}</p>
    {signedOut && <div className="community-login-actions">
      <ProviderLoginButton disabled={!isOAuthConfigured} provider="kakao" onClick={() => startOAuthLogin('kakao', returnTo)} />
      <ProviderLoginButton disabled={!isOAuthConfigured} provider="naver" onClick={() => startOAuthLogin('naver', returnTo)} />
      <ProviderLoginButton disabled={!isOAuthConfigured} provider="google" onClick={() => startOAuthLogin('google', returnTo)} />
    </div>}
    {failed && <button className="button button-primary" onClick={() => window.location.reload()} type="button">다시 확인</button>}
    <Link className="button button-secondary" to="/profile">내 위브로 돌아가기</Link>
  </section>;
}
