import { normalizePseudonym, validatePseudonym } from './pseudonym.js'

export type MemberAccount = {
  uid: string
  provider: 'naver' | 'kakao' | 'google'
  connected: boolean
  termsVersion?: string
  communityRulesVersion?: string
  pseudonym?: string
  pseudonymChangedAtMs?: number
  pseudonymRevokedAtMs?: number
}

export type PseudonymClaim = { normalized: string; ownerUid: string }

export class AccountPolicyError extends Error {
  constructor(public readonly code: 'terms_required' | 'invalid_pseudonym' | 'duplicate_pseudonym' | 'change_locked' | 'not_connected') {
    super(code)
  }
}

const changeWindowMs = 90 * 24 * 60 * 60 * 1_000

export function acceptMemberTerms(account: MemberAccount, input: { termsVersion: string; communityRulesVersion: string }): MemberAccount {
  const termsVersion = input.termsVersion.trim()
  const communityRulesVersion = input.communityRulesVersion.trim()
  if (!termsVersion || !communityRulesVersion) throw new AccountPolicyError('terms_required')
  return { ...account, termsVersion, communityRulesVersion }
}

export function canUseCommunity(account: MemberAccount): boolean {
  return account.connected && Boolean(account.termsVersion && account.communityRulesVersion && account.pseudonym)
}

export function claimPseudonym(
  account: MemberAccount,
  requested: string,
  existingClaim: PseudonymClaim | null,
  nowMs: number,
): { account: MemberAccount; claim: PseudonymClaim; releaseNormalized?: string } {
  if (!account.connected) throw new AccountPolicyError('not_connected')
  if (!account.termsVersion || !account.communityRulesVersion) throw new AccountPolicyError('terms_required')
  if (validatePseudonym(requested)) throw new AccountPolicyError('invalid_pseudonym')
  const pseudonym = requested.trim().replace(/\s+/g, ' ')
  const normalized = normalizePseudonym(pseudonym)
  if (existingClaim && existingClaim.ownerUid !== account.uid) throw new AccountPolicyError('duplicate_pseudonym')
  if (
    account.pseudonym && normalizePseudonym(account.pseudonym) !== normalized
    && account.pseudonymChangedAtMs !== undefined
    && account.pseudonymChangedAtMs + changeWindowMs > nowMs
  ) throw new AccountPolicyError('change_locked')

  const oldNormalized = account.pseudonym ? normalizePseudonym(account.pseudonym) : undefined
  return {
    account: { ...account, pseudonym, pseudonymChangedAtMs: nowMs, pseudonymRevokedAtMs: undefined },
    claim: { normalized, ownerUid: account.uid },
    releaseNormalized: oldNormalized && oldNormalized !== normalized ? oldNormalized : undefined,
  }
}

export function revokePseudonym(account: MemberAccount, nowMs: number): MemberAccount {
  return { ...account, pseudonym: undefined, pseudonymRevokedAtMs: nowMs }
}

export function disconnectProvider(account: MemberAccount): MemberAccount {
  return { ...account, connected: false }
}

export function termsAcceptancePatch(input: {
  termsVersion: string
  communityRulesVersion: string
}): {
  termsVersion: string
  communityRulesVersion: string
} {
  return {
    termsVersion: input.termsVersion,
    communityRulesVersion: input.communityRulesVersion,
  }
}

export async function disconnectAccountSession(
  uid: string,
  dependencies: {
    markDisconnected(uid: string): Promise<void>
    revokeRefreshTokens(uid: string): Promise<void>
  },
): Promise<void> {
  await dependencies.markDisconnected(uid)
  await dependencies.revokeRefreshTokens(uid)
}
