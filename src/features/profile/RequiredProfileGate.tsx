import { useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { useLocation, useNavigate } from 'react-router-dom'
import { getFirebaseServices } from '../../lib/firebase/client'
import { safeOAuthReturnTo } from '../auth/return-to'

export function RequiredProfileGate() {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const services = getFirebaseServices()
    if (!services || location.pathname.startsWith('/auth/') || location.pathname.startsWith('/policies/')) return
    let unsubscribeAccount: (() => void) | undefined
    const unsubscribeAuth = onAuthStateChanged(services.auth, user => {
      unsubscribeAccount?.()
      if (!user) return
      unsubscribeAccount = onSnapshot(doc(services.firestore, 'users', user.uid), snapshot => {
        if (services.auth.currentUser?.uid !== user.uid) return
        const account = snapshot.data()
        if (account?.connected !== true) return
        const query = new URLSearchParams(location.search)
        const returnTo = query.get('onboarding') === 'terms'
          ? safeOAuthReturnTo(query.get('returnTo'))
          : location.pathname + location.search + location.hash
        if (account.termsVersion !== '2026-07-20' || account.communityRulesVersion !== '2026-07-20') {
          if (location.pathname !== '/community') navigate('/community?onboarding=terms&returnTo=' + encodeURIComponent(returnTo), { replace: true })
          return
        }
        if (account.requiredProfileVersion === '2026-10-01') return
        if (location.pathname === '/profile') return
        navigate('/profile?registration=required&returnTo=' + encodeURIComponent(returnTo), { replace: true })
      })
    })
    const completed = () => {
      const query = new URLSearchParams(location.search)
      if (location.pathname === '/profile' && query.get('registration') === 'required') {
        navigate(safeOAuthReturnTo(query.get('returnTo'), '/profile'), { replace: true })
      }
    }
    window.addEventListener('weave:profile-saved', completed)
    return () => { unsubscribeAuth(); unsubscribeAccount?.(); window.removeEventListener('weave:profile-saved', completed) }
  }, [location.pathname, location.search, location.hash, navigate])
  return null
}
