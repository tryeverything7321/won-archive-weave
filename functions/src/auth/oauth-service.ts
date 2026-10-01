import { createHash } from 'node:crypto'

export type OAuthProvider = 'naver' | 'kakao'

export type OAuthSession = {
  provider: OAuthProvider
  stateHash: string
  redirectOrigin: string
  expiresAtMs: number
  consumedAtMs?: number
}

export type ProviderIdentity = {
  subject: string
}

export type OAuthCallback = {
  provider: OAuthProvider
  state: string
  code?: string
  error?: string
  redirectOrigin: string
  redirectUri: string
}

export type OAuthCompletion = {
  provider: OAuthProvider
  uid: string
  customToken: string
}

export interface OAuthSessionStore {
  consume(stateHash: string, consumedAtMs: number): Promise<OAuthSession | null>
}

export interface OAuthProviderAdapter {
  exchangeCode(input: {
    code: string
    state: string
    redirectUri: string
  }): Promise<ProviderIdentity>
}

export interface CustomTokenIssuer {
  issue(uid: string, claims: { provider: OAuthProvider }): Promise<string>
}

export class OAuthFlowError extends Error {
  constructor(
    public readonly code:
      | 'cancelled'
      | 'provider_error'
      | 'invalid_state'
      | 'expired_state'
      | 'provider_mismatch'
      | 'origin_mismatch'
      | 'provider_unavailable',
    message: string,
  ) {
    super(message)
  }
}

export function hashOAuthSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function firebaseUid(provider: OAuthProvider, subject: string): string {
  return `${provider}:${subject}`
}

export function oauthAccountRecord(provider: OAuthProvider): {
  provider: OAuthProvider
  connected: true
} {
  return { provider, connected: true }
}

export async function completeOAuthCallback(
  callback: OAuthCallback,
  dependencies: {
    sessions: OAuthSessionStore
    adapters: Record<OAuthProvider, OAuthProviderAdapter>
    tokens: CustomTokenIssuer
    now: () => number
  },
): Promise<OAuthCompletion> {
  if (!callback.state) {
    throw new OAuthFlowError('cancelled', '로그인이 취소되었거나 인증 코드가 없습니다')
  }

  const now = dependencies.now()
  const session = await dependencies.sessions.consume(hashOAuthSecret(callback.state), now)
  if (!session) throw new OAuthFlowError('invalid_state', '로그인 요청을 찾을 수 없거나 이미 사용되었습니다')
  if (session.expiresAtMs <= now) throw new OAuthFlowError('expired_state', '로그인 요청이 만료되었습니다')
  if (session.provider !== callback.provider) throw new OAuthFlowError('provider_mismatch', '로그인 제공자가 일치하지 않습니다')
  if (session.redirectOrigin !== callback.redirectOrigin) throw new OAuthFlowError('origin_mismatch', '로그인을 시작한 주소와 완료 주소가 다릅니다')
  if (callback.error) {
    throw new OAuthFlowError(
      callback.error === 'access_denied' ? 'cancelled' : 'provider_error',
      '외부 로그인 제공자가 요청을 완료하지 않았습니다',
    )
  }
  if (!callback.code) {
    throw new OAuthFlowError('cancelled', '로그인이 취소되었거나 인증 코드가 없습니다')
  }

  try {
    const identity = await dependencies.adapters[callback.provider].exchangeCode({
      code: callback.code,
      state: callback.state,
      redirectUri: callback.redirectUri,
    })
    if (!identity.subject) throw new Error('Provider identity is missing a stable subject')
    const uid = firebaseUid(callback.provider, identity.subject)
    return {
      provider: callback.provider,
      uid,
      customToken: await dependencies.tokens.issue(uid, { provider: callback.provider }),
    }
  } catch (error) {
    if (error instanceof OAuthFlowError) throw error
    throw new OAuthFlowError('provider_unavailable', '외부 로그인 제공자와 통신하지 못했습니다')
  }
}

export type OAuthCompletionRecord = {
  customToken: string
  expiresAtMs: number
}

export interface OAuthCompletionStore {
  consume(completionHash: string, consumedAtMs: number): Promise<OAuthCompletionRecord | null>
}

export class OAuthCompletionError extends Error {
  constructor() {
    super('OAuth completion has expired or was already consumed')
  }
}

export async function consumeOAuthCompletion(
  completionCode: string,
  store: OAuthCompletionStore,
  nowMs: number,
): Promise<string> {
  const completion = await store.consume(hashOAuthSecret(completionCode), nowMs)
  if (!completion || completion.expiresAtMs <= nowMs) throw new OAuthCompletionError()
  return completion.customToken
}
