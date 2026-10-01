import { signInWithCustomToken, signOut } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { getFirebaseServices } from '../../lib/firebase/client'
import { defaultOAuthReturnTo, safeOAuthReturnTo } from './return-to'

export type OAuthProvider = 'naver' | 'kakao'

const oauthAttemptKey = 'weave.oauth.pending'
const oauthInstallationKey = 'weave.oauth.installation'
let cachedOAuthInstallationId: string | null = null

export type PendingOAuthAttempt = {
  provider: OAuthProvider
  returnTo: string
}

function services() {
  const value = getFirebaseServices()
  if (!value) throw new Error('Firebase is not configured')
  return value
}

export { safeOAuthReturnTo }

export function rememberOAuthAttempt(provider: OAuthProvider, returnTo = defaultOAuthReturnTo): PendingOAuthAttempt {
  const attempt = { provider, returnTo: safeOAuthReturnTo(returnTo) }
  if (typeof window !== 'undefined') window.sessionStorage.setItem(oauthAttemptKey, JSON.stringify(attempt))
  return attempt
}

export function pendingOAuthAttempt(): PendingOAuthAttempt | null {
  if (typeof window === 'undefined') return null
  const stored = window.sessionStorage.getItem(oauthAttemptKey)
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored) as Partial<PendingOAuthAttempt>
    if (parsed.provider !== 'kakao' && parsed.provider !== 'naver') return null
    return { provider: parsed.provider, returnTo: safeOAuthReturnTo(parsed.returnTo) }
  } catch {
    return null
  }
}

export function clearOAuthAttempt(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(oauthAttemptKey)
}

function oauthInstallationId(): string {
  if (cachedOAuthInstallationId) return cachedOAuthInstallationId
  try {
    const stored = window.localStorage.getItem(oauthInstallationKey)
    if (stored && /^[A-Za-z0-9_-]{32,64}$/.test(stored)) {
      cachedOAuthInstallationId = stored
      return stored
    }
  } catch {
    // Storage can be unavailable in strict privacy modes. The in-memory value
    // still keeps repeated attempts in this page inside one quota.
  }
  const bytes = window.crypto.getRandomValues(new Uint8Array(32))
  const generated = window.btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  cachedOAuthInstallationId = generated
  try {
    window.localStorage.setItem(oauthInstallationKey, generated)
  } catch {
    // The hashed server quota never stores this opaque browser identifier.
  }
  return generated
}

export function oauthStartUrl(provider: OAuthProvider, ticket: string): string {
  return `/oauth/${provider}/start?ticket=${encodeURIComponent(ticket)}`
}

export async function startOAuthLogin(provider: OAuthProvider, returnTo = defaultOAuthReturnTo): Promise<void> {
  rememberOAuthAttempt(provider, returnTo)
  const firebase = services()
  if (!firebase.appCheck) {
    window.location.assign('/auth/complete?error=provider_unavailable')
    return
  }
  try {
    const issueTicket = httpsCallable<
      { provider: OAuthProvider; installationId: string },
      { ticket: string; expiresAtMs: number }
    >(firebase.functions, 'issueOAuthStartTicket', {
      limitedUseAppCheckTokens: true,
    })
    const { data } = await issueTicket({
      provider,
      installationId: oauthInstallationId(),
    })
    if (!data.ticket) throw new Error('oauth_start_ticket_missing')
    window.location.assign(oauthStartUrl(provider, data.ticket))
  } catch {
    window.location.assign('/auth/complete?error=provider_unavailable')
  }
}

export async function completeProviderLogin(completionCode: string): Promise<void> {
  const firebase = services()
  const exchange = httpsCallable<{ completionCode: string }, { customToken: string }>(firebase.functions, 'exchangeOAuthCompletion')
  const { data } = await exchange({ completionCode })
  await signInWithCustomToken(firebase.auth, data.customToken)
}

export async function acceptTerms(termsVersion: string, communityRulesVersion: string) {
  const firebase = services()
  const callable = httpsCallable<{ termsVersion: string; communityRulesVersion: string }, { termsVersion: string; communityRulesVersion: string }>(firebase.functions, 'acceptMemberTerms')
  return (await callable({ termsVersion, communityRulesVersion })).data
}

export async function disconnectAccount(): Promise<void> {
  const firebase = services()
  const callable = httpsCallable<Record<string, never>, { disconnected: boolean }>(firebase.functions, 'disconnectPlatformAccount')
  await callable({})
  await signOut(firebase.auth)
}
