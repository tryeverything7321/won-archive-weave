export const MAX_INSTAGRAM_ATTACHMENTS = 5

export type InstagramPostAttachment = {
  sourceUrl: string
  mediaType: 'post' | 'reel'
  shortcode: string
  originalAuthor?: string
}

export class InstagramUrlPolicyError extends Error {
  constructor(public readonly code: 'invalid_url' | 'unsupported_url' | 'duplicate' | 'too_many' | 'invalid_author') {
    super(code)
  }
}

const supportedHosts = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com'])
const shortcodePattern = /^[A-Za-z0-9_-]{5,64}$/
const authorPattern = /^[A-Za-z0-9._]{1,30}$/

export function normalizeInstagramPostUrl(value: string): InstagramPostAttachment {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new InstagramUrlPolicyError('invalid_url')
  }
  if (
    url.protocol !== 'https:'
    || !supportedHosts.has(url.hostname.toLowerCase())
    || url.username
    || url.password
    || url.port
  ) throw new InstagramUrlPolicyError('unsupported_url')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || (parts[0] !== 'p' && parts[0] !== 'reel') || !shortcodePattern.test(parts[1])) {
    throw new InstagramUrlPolicyError('unsupported_url')
  }
  const mediaType = parts[0] as 'p' | 'reel'
  const shortcode = parts[1]
  return {
    sourceUrl: `https://www.instagram.com/${mediaType}/${shortcode}/`,
    mediaType: mediaType === 'p' ? 'post' : 'reel',
    shortcode,
  }
}

export function normalizeInstagramAuthor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new InstagramUrlPolicyError('invalid_author')
  const author = value.trim().replace(/^@/, '')
  if (!author) return undefined
  if (!authorPattern.test(author)) throw new InstagramUrlPolicyError('invalid_author')
  return author
}

export function validateInstagramAttachments(value: unknown): InstagramPostAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_INSTAGRAM_ATTACHMENTS) {
    throw new InstagramUrlPolicyError('too_many')
  }
  const seen = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new InstagramUrlPolicyError('invalid_url')
    const data = item as Record<string, unknown>
    if (typeof data.sourceUrl !== 'string') throw new InstagramUrlPolicyError('invalid_url')
    const normalized = normalizeInstagramPostUrl(data.sourceUrl)
    if (seen.has(normalized.sourceUrl)) throw new InstagramUrlPolicyError('duplicate')
    seen.add(normalized.sourceUrl)
    const originalAuthor = normalizeInstagramAuthor(data.originalAuthor)
    return { ...normalized, ...(originalAuthor ? { originalAuthor } : {}) }
  })
}
