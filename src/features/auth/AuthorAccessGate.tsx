import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { useLocation } from 'react-router-dom'
import { getFirebaseServices, isOAuthConfigured } from '../../lib/firebase/client'
import { startOAuthLogin } from './api'
import { ProviderLoginButton } from './ProviderLoginButton'

/** Ask for login before mounting an editable form so anonymous input cannot be lost. */
export function AuthorAccessGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const services = useMemo(() => getFirebaseServices(), [])
  const [state, setState] = useState<'checking' | 'signed-out' | 'signed-in'>(() => services ? 'checking' : 'signed-out')
  useEffect(() => {
    if (!services) return
    return onAuthStateChanged(services.auth, user => setState(user ? 'signed-in' : 'signed-out'))
  }, [services])
  if (state === 'checking') return <p role="status">로그인 상태를 확인하고 있어요</p>
  if (state === 'signed-in') return children
  const returnTo = location.pathname + location.search + location.hash
  return <section className="community-login-panel section-frame" aria-label="작성 전 로그인">
    <h2>로그인하고 작성해 주세요</h2>
    <p>로그인하면 이 화면에서 작성을 시작할 수 있어요. 이미 이용 중인 로그인 방식을 선택해 주세요.</p>
    <div className="community-login-actions">
      {(['kakao', 'naver', 'google'] as const).map(provider => <ProviderLoginButton key={provider} provider={provider} disabled={!isOAuthConfigured} onClick={() => startOAuthLogin(provider, returnTo)} />)}
    </div>
    {!isOAuthConfigured && <p>로그인 연결을 준비하고 있어요.</p>}
  </section>
}
