export type CommunityLoginProvider = 'kakao' | 'naver'
export type CommunityPostPurpose = '생각 나눔' | '질문' | '경험과 노하우' | '도움 요청' | '함께할 사람 찾기'

export function publicPostRecord(input: {
  body: string
  topic?: string | null
  purpose: CommunityPostPurpose
  pseudonym: string
  provider: CommunityLoginProvider
  timestamp: unknown
}) {
  return {
    body: input.body,
    ...(input.topic ? { topic: input.topic } : {}),
    purpose: input.purpose,
    pseudonym: input.pseudonym,
    provider: input.provider,
    status: 'active' as const,
    commentCount: 0,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  }
}

export function publicCommentRecord(input: { body: string; pseudonym: string; provider: CommunityLoginProvider; timestamp: unknown }) {
  return {
    body: input.body,
    pseudonym: input.pseudonym,
    provider: input.provider,
    status: 'active' as const,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  }
}

export function publicModerationPatch(input: { status: 'active' | 'held' | 'removed'; reason: string; timestamp: unknown }) {
  return {
    status: input.status,
    moderationReason: input.reason,
    moderatedAt: input.timestamp,
  }
}
