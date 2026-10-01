import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getFirebaseServices, isOAuthConfigured } from '../../lib/firebase/client'
import {
  clearOAuthAttempt,
  completeProviderLogin,
  pendingOAuthAttempt,
  safeOAuthReturnTo,
  startOAuthLogin,
  type OAuthProvider,
} from './api'
import { ProviderLoginButton } from './ProviderLoginButton'

type Outcome = {
  state: 'loading' | 'complete' | 'error'
  message: string
  provider?: OAuthProvider
}

function errorMessage(error: string | null): string {
  if (error === 'cancelled' || error === 'access_denied') return '로그인을 취소했어요. 언제든 다시 시작할 수 있어요.'
  if (error === 'invalid_state') return '로그인 시간이 만료됐어요. 커뮤니티에서 다시 로그인해 주세요.'
  if (error === 'provider_unavailable') return '로그인 서비스에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  return '로그인 정보를 확인하지 못했어요. 커뮤니티에서 다시 로그인해 주세요.'
}

export function AuthCompletePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const exchangeStarted = useRef(false)
  const [initialAttempt] = useState(pendingOAuthAttempt)
  const [outcome, setOutcome] = useState<Outcome>(() => {
    const error = params.get('error')
    const completionCode = params.get('code')
    if (error) return { state: 'error', message: errorMessage(error), provider: initialAttempt?.provider }
    if (!completionCode || !getFirebaseServices()) {
      return { state: 'error', message: errorMessage(null), provider: initialAttempt?.provider }
    }
    return { state: 'loading', message: '로그인 정보를 확인하고 있어요.', provider: initialAttempt?.provider }
  })

  useEffect(() => {
    const completionCode = params.get('code')
    const services = getFirebaseServices()

    if (
      exchangeStarted.current ||
      outcome.state !== 'loading' ||
      !completionCode ||
      !services
    ) return

    exchangeStarted.current = true
    void completeProviderLogin(completionCode)
      .then(() => {
        const returnTo = safeOAuthReturnTo(initialAttempt?.returnTo)
        clearOAuthAttempt()
        setOutcome({ state: 'complete', message: '로그인을 마쳤어요. 이전 화면으로 돌아갑니다.', provider: initialAttempt?.provider })
        navigate(returnTo, { replace: true })
      })
      .catch(() => {
        setOutcome({
          state: 'error',
          message: '로그인 시간이 만료됐거나 연결을 마치지 못했어요. 원하는 방법으로 다시 시도해 주세요.',
          provider: initialAttempt?.provider,
        })
      })
  }, [initialAttempt, navigate, outcome.state, params])

  const providers: OAuthProvider[] = outcome.provider === 'naver'
    ? ['naver', 'kakao']
    : ['kakao', 'naver']
  const returnTo = safeOAuthReturnTo(initialAttempt?.returnTo)

  return <section className="page-frame section-frame"><div
    className="auth-complete"
    aria-live="polite"
    aria-busy={outcome.state === 'loading'}
    role={outcome.state === 'error' ? 'alert' : 'status'}
  >
    {outcome.state === 'complete' ? <CheckCircle2 size={38} /> : outcome.state === 'error' ? <CircleAlert size={38} /> : <span className="auth-pulse" aria-hidden="true" />}
    <h1>{outcome.state === 'complete' ? '로그인을 마쳤어요' : outcome.state === 'error' ? '로그인을 마치지 못했어요' : '잠시만요'}</h1>
    <p>{outcome.message}</p>
    {outcome.state === 'error' && <div className="auth-retry-actions">
      <p className="auth-retry-label">다시 로그인할 방법을 선택해 주세요.</p>
      {providers.map((provider) => <ProviderLoginButton
        disabled={!isOAuthConfigured}
        key={provider}
        onClick={() => startOAuthLogin(provider, returnTo)}
        provider={provider}
      />)}
      {!isOAuthConfigured && <small>로그인 연결을 준비하고 있어요.</small>}
      <Link className="button button-secondary auth-return-link" to={returnTo}>이전 화면으로 돌아가기</Link>
    </div>}
  </div></section>
}
