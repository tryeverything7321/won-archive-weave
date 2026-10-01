import { createHash, randomBytes } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import {
  OAuthCompletionError,
  OAuthFlowError,
  completeOAuthCallback,
  consumeOAuthCompletion,
  oauthAccountRecord,
  type OAuthProvider,
  type OAuthProviderAdapter,
  type OAuthSessionStore,
} from './oauth-service.js'
import { normalizePseudonym, validatePseudonym } from './pseudonym.js'
import { hasCurrentCommunityConsent } from './terms.js'
import {
  nextOAuthStartQuota,
  oauthInstallationQuotaKey,
  oauthNetworkQuotaKey,
  oauthStartQuotaPolicies,
  oauthStartQuotaWindowMs,
  oauthStartTicketMatches,
  oauthStartTicketTtlMs,
  requireAllowedOAuthOrigin,
  requireOAuthInstallationId,
  type OAuthStartQuotaRecord,
} from './oauth-boundaries.js'

if (!getApps().length) initializeApp()

const NAVER_CLIENT_ID = defineString('NAVER_CLIENT_ID')
const KAKAO_REST_API_KEY = defineString('KAKAO_REST_API_KEY')
const NAVER_CLIENT_SECRET = defineSecret('NAVER_CLIENT_SECRET')
const KAKAO_CLIENT_SECRET = defineSecret('KAKAO_CLIENT_SECRET')
const OAUTH_ALLOWED_ORIGINS = defineString('OAUTH_ALLOWED_ORIGINS', {
  default: [
    'https://won-archive-weave.web.app',
    'https://won-archive-weave.firebaseapp.com',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].join(','),
})

const stateTtlMs = 10 * 60 * 1000
const pseudonymChangeWindowMs = 90 * 24 * 60 * 60 * 1000

type OAuthStateRecord = {
  provider: OAuthProvider
  redirectOrigin: string
  expiresAt: Timestamp
}

type OAuthStartTicketRecord = {
  provider: OAuthProvider
  redirectOrigin: string
  expiresAt: Timestamp
}

function storedStartQuota(value: Record<string, unknown> | undefined): OAuthStartQuotaRecord | undefined {
  if (!value) return undefined
  const windowStartedAt = value.windowStartedAt
  const count = Number(value.count)
  if (
    !(windowStartedAt instanceof Timestamp)
    || !Number.isSafeInteger(count)
    || count < 0
  ) throw new Error('invalid_oauth_start_quota')
  return { windowStartedAtMs: windowStartedAt.toMillis(), count }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function configuredValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function providerFrom(value: string | undefined): OAuthProvider | null {
  return value === 'naver' || value === 'kakao' ? value : null
}

function requestOrigin(request: { get(name: string): string | undefined; secure?: boolean }): string {
  const forwardedHost = request.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost ?? request.get('host')
  const forwardedProto = request.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProto ?? (request.secure ? 'https' : 'http')
  if (!host) throw new Error('Unable to resolve request origin')
  return requireAllowedOAuthOrigin(`${protocol}://${host}`, OAUTH_ALLOWED_ORIGINS.value())
}

function browserOrigin(request: { get(name: string): string | undefined }): string {
  const origin = request.get('origin')
  if (!origin) throw new Error('browser_origin_missing')
  return requireAllowedOAuthOrigin(origin, OAUTH_ALLOWED_ORIGINS.value())
}

function redirectUri(origin: string, provider: OAuthProvider): string {
  return `${origin}/oauth/${provider}/callback`
}

function authorizeUrl(provider: OAuthProvider, state: string, uri: string): string {
  const url = provider === 'naver'
    ? new URL('https://nid.naver.com/oauth2.0/authorize')
    : new URL('https://kauth.kakao.com/oauth/authorize')

  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', provider === 'naver'
    ? configuredValue('NAVER_CLIENT_ID', NAVER_CLIENT_ID.value())
    : configuredValue('KAKAO_REST_API_KEY', KAKAO_REST_API_KEY.value()))
  url.searchParams.set('redirect_uri', uri)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeProviderCode(
  provider: OAuthProvider,
  input: { code: string; state: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
  credentials?: { clientId: string; clientSecret: string },
): Promise<{ subject: string }> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: credentials?.clientId ?? (provider === 'naver'
      ? configuredValue('NAVER_CLIENT_ID', NAVER_CLIENT_ID.value())
      : configuredValue('KAKAO_REST_API_KEY', KAKAO_REST_API_KEY.value())),
    client_secret: credentials?.clientSecret ?? (provider === 'naver'
      ? configuredValue('NAVER_CLIENT_SECRET', NAVER_CLIENT_SECRET.value())
      : configuredValue('KAKAO_CLIENT_SECRET', KAKAO_CLIENT_SECRET.value())),
    code: input.code,
    redirect_uri: input.redirectUri,
  })

  if (provider === 'naver') form.set('state', input.state)

  const tokenResponse = await fetcher(provider === 'naver'
    ? 'https://nid.naver.com/oauth2.0/token'
    : 'https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: form,
  })
  const tokenBody = await tokenResponse.json() as { access_token?: string; error?: string }
  if (!tokenResponse.ok || !tokenBody.access_token) throw new Error(`Provider token exchange failed: ${tokenBody.error ?? tokenResponse.status}`)

  const profileResponse = await fetcher(provider === 'naver'
    ? 'https://openapi.naver.com/v1/nid/me'
    : 'https://kapi.kakao.com/v2/user/me', {
    headers: { authorization: `Bearer ${tokenBody.access_token}` },
  })
  const profile = await profileResponse.json() as {
    id?: string | number
    response?: { id?: string }
  }
  const subject = provider === 'naver' ? profile.response?.id : profile.id?.toString()
  if (!profileResponse.ok || !subject) throw new Error('Provider profile lookup failed')
  return { subject }
}

function firestoreSessionStore(): OAuthSessionStore {
  const firestore = getFirestore()
  return {
    consume(stateHash, consumedAtMs) {
      const ref = firestore.collection('oauthStates').doc(stateHash)
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return null
        const saved = snapshot.data() as OAuthStateRecord
        transaction.delete(ref)
        return {
          provider: saved.provider,
          stateHash,
          redirectOrigin: saved.redirectOrigin,
          expiresAtMs: saved.expiresAt.toMillis(),
          consumedAtMs,
        }
      })
    },
  }
}

function providerAdapters(): Record<OAuthProvider, OAuthProviderAdapter> {
  return {
    naver: {
      exchangeCode: (input) => exchangeProviderCode('naver', input),
    },
    kakao: {
      exchangeCode: (input) => exchangeProviderCode('kakao', input),
    },
  }
}

// The callable combines replay-protected App Check, an opaque browser
// installation quota, and the client address from Google's trusted final
// X-Forwarded-For pair. It then mints a provider/origin-bound, one-use ticket.
export const issueOAuthStartTicket = onCall(
  {
    region: 'asia-northeast3',
    enforceAppCheck: true,
    consumeAppCheckToken: true,
  },
  async (request) => {
    const provider = providerFrom(typeof request.data?.provider === 'string' ? request.data.provider : undefined)
    if (!provider) throw new HttpsError('invalid-argument', '로그인 제공자를 확인할 수 없어요')
    let installationId: string
    try {
      installationId = requireOAuthInstallationId(request.data?.installationId)
    } catch {
      throw new HttpsError('invalid-argument', '브라우저 로그인 식별자를 확인할 수 없어요')
    }
    let redirectOrigin: string
    try {
      redirectOrigin = browserOrigin(request.rawRequest)
    } catch {
      throw new HttpsError('permission-denied', '허용되지 않은 로그인 요청 출처입니다')
    }
    const ticket = randomToken()
    const nowMs = Date.now()
    const expiresAtMs = nowMs + oauthStartTicketTtlMs
    const network = oauthNetworkQuotaKey(request.rawRequest.get('x-forwarded-for'))
    const firestore = getFirestore()
    const installationQuotaRef = firestore.collection('oauthStartQuotas').doc(oauthInstallationQuotaKey(installationId))
    const networkQuotaRef = firestore.collection('oauthStartQuotas').doc(network.key)
    const ticketRef = firestore.collection('oauthStartTickets').doc(hash(ticket))
    await firestore.runTransaction(async (transaction) => {
      const [installationSnapshot, networkSnapshot] = await Promise.all([
        transaction.get(installationQuotaRef),
        transaction.get(networkQuotaRef),
      ])
      const installationQuota = nextOAuthStartQuota(
        storedStartQuota(installationSnapshot.data()),
        oauthStartQuotaPolicies.installation,
        nowMs,
      )
      const networkQuota = nextOAuthStartQuota(
        storedStartQuota(networkSnapshot.data()),
        oauthStartQuotaPolicies[network.policy],
        nowMs,
      )
      if (!installationQuota.allowed || !networkQuota.allowed) {
        throw new HttpsError('resource-exhausted', '로그인 요청이 너무 많아요 잠시 뒤 다시 시도해 주세요', {
          retryAfterMs: Math.max(installationQuota.retryAfterMs, networkQuota.retryAfterMs),
        })
      }
      for (const [reference, quota, scope] of [
        [installationQuotaRef, installationQuota, 'installation'],
        [networkQuotaRef, networkQuota, network.policy],
      ] as const) {
        transaction.set(reference, {
          scope,
          windowStartedAt: Timestamp.fromMillis(quota.record.windowStartedAtMs),
          count: quota.record.count,
          expiresAt: Timestamp.fromMillis(quota.record.windowStartedAtMs + 2 * oauthStartQuotaWindowMs),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(ticketRef, {
        provider,
        redirectOrigin,
        expiresAt: Timestamp.fromMillis(expiresAtMs),
        createdAt: FieldValue.serverTimestamp(),
      } satisfies OAuthStartTicketRecord & { createdAt: FieldValue })
    })
    return { ticket, expiresAtMs }
  },
)

export const oauthGateway = onRequest(
  {
    region: 'asia-northeast3',
    secrets: [NAVER_CLIENT_SECRET, KAKAO_CLIENT_SECRET],
  },
  async (request, response) => {
    let origin: string | undefined
    try {
      const segments = request.path.split('/').filter(Boolean)
      const provider = providerFrom(segments[1])
      const action = segments[2]
      if (!provider || !action) {
        response.status(404).send('Not found')
        return
      }

      origin = requestOrigin(request)
      const firestore = getFirestore()

      if (action === 'start') {
        const startOrigin = origin
        const ticket = typeof request.query.ticket === 'string' ? request.query.ticket : ''
        if (!ticket) {
          response.status(400).send('Missing OAuth start ticket')
          return
        }
        const state = randomToken()
        const authorization = authorizeUrl(provider, state, redirectUri(startOrigin, provider))
        const accepted = await firestore.runTransaction(async (transaction) => {
          const ticketRef = firestore.collection('oauthStartTickets').doc(hash(ticket))
          const ticketSnapshot = await transaction.get(ticketRef)
          const saved = ticketSnapshot.data() as OAuthStartTicketRecord | undefined
          if (!oauthStartTicketMatches(saved
            ? {
                provider: saved.provider,
                redirectOrigin: saved.redirectOrigin,
                expiresAtMs: saved.expiresAt.toMillis(),
              }
            : undefined, {
            provider,
            redirectOrigin: startOrigin,
            nowMs: Date.now(),
          })) return false
          transaction.delete(ticketRef)
          transaction.create(firestore.collection('oauthStates').doc(hash(state)), {
            provider,
            redirectOrigin: startOrigin,
            expiresAt: Timestamp.fromMillis(Date.now() + stateTtlMs),
            createdAt: FieldValue.serverTimestamp(),
          } satisfies OAuthStateRecord & { createdAt: FieldValue })
          return true
        })
        if (!accepted) {
          response.status(400).send('Invalid or expired OAuth start ticket')
          return
        }
        response.redirect(302, authorization)
        return
      }

      if (action !== 'callback') {
        response.status(404).send('Not found')
        return
      }

      const state = typeof request.query.state === 'string' ? request.query.state : ''
      const code = typeof request.query.code === 'string' ? request.query.code : ''
      const providerError = typeof request.query.error === 'string' ? request.query.error : ''
      const completion = await completeOAuthCallback({
        provider,
        state,
        code: code || undefined,
        error: providerError || undefined,
        redirectOrigin: origin,
        redirectUri: redirectUri(origin, provider),
      }, {
        sessions: firestoreSessionStore(),
        adapters: providerAdapters(),
        tokens: {
          issue: (uid, claims) => getAuth().createCustomToken(uid, claims),
        },
        now: Date.now,
      })
      const completionCode = randomToken()
      const batch = firestore.batch()
      batch.set(firestore.collection('oauthCompletions').doc(hash(completionCode)), {
        customToken: completion.customToken,
        expiresAt: Timestamp.fromMillis(Date.now() + stateTtlMs),
        createdAt: FieldValue.serverTimestamp(),
      })
      batch.set(firestore.collection('users').doc(completion.uid), {
        ...oauthAccountRecord(completion.provider),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      await batch.commit()
      response.redirect(302, `${origin}/auth/complete?code=${encodeURIComponent(completionCode)}`)
    } catch (error) {
      if (error instanceof OAuthFlowError) {
        if (!origin) {
          response.status(400).send('Invalid request origin')
          return
        }
        response.redirect(302, `${origin}/auth/complete?error=${encodeURIComponent(error.code)}`)
        return
      }
      console.error('OAuth gateway failed', error)
      if (!origin) {
        response.status(400).send('Invalid request origin')
        return
      }
      response.redirect(302, `${origin}/auth/complete?error=provider_unavailable`)
    }
  },
)

export const cleanupExpiredOAuthArtifacts = onSchedule(
  {
    region: 'asia-northeast3',
    schedule: 'every 60 minutes',
    retryCount: 3,
    timeoutSeconds: 120,
  },
  async () => {
    const firestore = getFirestore()
    const now = Timestamp.now()
    const maxBatchesPerCollection = 20
    for (const collectionName of ['oauthStartTickets', 'oauthStartQuotas', 'oauthStates', 'oauthCompletions', 'oauthRateLimits']) {
      for (let batchNumber = 0; batchNumber < maxBatchesPerCollection; batchNumber += 1) {
        const expired = await firestore.collection(collectionName)
          .where('expiresAt', '<=', now)
          .limit(250)
          .get()
        if (expired.empty) break
        const batch = firestore.batch()
        expired.docs.forEach((snapshot) => batch.delete(snapshot.ref))
        await batch.commit()
        if (expired.size < 250) break
      }
    }
  },
)

export const exchangeOAuthCompletion = onCall({ region: 'asia-northeast3' }, async (request) => {
  const completionCode = typeof request.data?.completionCode === 'string' ? request.data.completionCode : ''
  if (!completionCode) throw new HttpsError('invalid-argument', 'Missing OAuth completion code')

  const firestore = getFirestore()
  try {
    const customToken = await consumeOAuthCompletion(completionCode, {
      consume(completionHash) {
        const ref = firestore.collection('oauthCompletions').doc(completionHash)
        return firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(ref)
          const data = snapshot.data() as { customToken?: string; expiresAt?: Timestamp } | undefined
          if (!data?.customToken || !data.expiresAt) return null
          transaction.delete(ref)
          return { customToken: data.customToken, expiresAtMs: data.expiresAt.toMillis() }
        })
      },
    }, Date.now())
    return { customToken }
  } catch (error) {
    if (error instanceof OAuthCompletionError) {
      throw new HttpsError('unauthenticated', 'OAuth completion has expired')
    }
    throw error
  }
})

export const createOrRotatePseudonym = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required')
  const pseudonym = typeof request.data?.pseudonym === 'string' ? request.data.pseudonym : ''
  const validationError = validatePseudonym(pseudonym)
  if (validationError) throw new HttpsError('invalid-argument', validationError)

  const normalized = normalizePseudonym(pseudonym)
  const firestore = getFirestore()
  const userRef = firestore.collection('users').doc(request.auth.uid)
  const pseudonymRef = firestore.collection('pseudonyms').doc(hash(normalized))

  await firestore.runTransaction(async (transaction) => {
    const [userSnapshot, pseudonymSnapshot] = await Promise.all([transaction.get(userRef), transaction.get(pseudonymRef)])
    const user = userSnapshot.data() as { connected?: boolean; termsVersion?: string; communityRulesVersion?: string; pseudonym?: string; pseudonymChangedAt?: Timestamp } | undefined
    const claimed = pseudonymSnapshot.data() as { uid?: string } | undefined
    if (!user?.connected || !hasCurrentCommunityConsent(user)) throw new HttpsError('failed-precondition', '최신 이용약관과 커뮤니티 규칙에 먼저 동의해 주세요')
    if (claimed?.uid && claimed.uid !== request.auth?.uid) throw new HttpsError('already-exists', '이미 사용 중인 별명입니다')
    if (user?.pseudonymChangedAt && user.pseudonym !== pseudonym && user.pseudonymChangedAt.toMillis() + pseudonymChangeWindowMs > Date.now()) {
      throw new HttpsError('failed-precondition', '별명은 90일에 한 번 바꿀 수 있어요')
    }
    transaction.set(pseudonymRef, { uid: request.auth?.uid, pseudonym, updatedAt: FieldValue.serverTimestamp() })
    transaction.set(userRef, { pseudonym, pseudonymChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    transaction.set(firestore.collection('auditEvents').doc(), { type: 'pseudonym.updated', uid: request.auth?.uid, at: FieldValue.serverTimestamp() })
  })

  return { pseudonym }
})
