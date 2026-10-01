export type EventInstagramPost = {
  sourceUrl: string
  mediaType: 'post' | 'reel'
  shortcode: string
  originalAuthor?: string
}

const MAX_INSTAGRAM_POSTS = 5
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com'])
const SHORTCODE = /^[A-Za-z0-9_-]{5,64}$/
const AUTHOR = /^[A-Za-z0-9._]{1,30}$/

function normalizePost(value: unknown): EventInstagramPost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_instagram_post')
  const record = value as Record<string, unknown>
  if (typeof record.sourceUrl !== 'string') throw new Error('invalid_instagram_post')
  let url: URL
  try { url = new URL(record.sourceUrl.trim()) } catch { throw new Error('invalid_instagram_post') }
  if (url.protocol !== 'https:' || !INSTAGRAM_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
    throw new Error('invalid_instagram_post')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || (parts[0] !== 'p' && parts[0] !== 'reel') || !SHORTCODE.test(parts[1])) {
    throw new Error('invalid_instagram_post')
  }
  const mediaType = parts[0] === 'p' ? 'post' : 'reel'
  const shortcode = parts[1]
  if (record.mediaType !== mediaType || record.shortcode !== shortcode) throw new Error('invalid_instagram_post')
  const author = record.originalAuthor === undefined
    ? undefined
    : typeof record.originalAuthor === 'string'
      ? record.originalAuthor.trim().replace(/^@/, '')
      : null
  if (author === null || (author && !AUTHOR.test(author))) throw new Error('invalid_instagram_post')
  return {
    sourceUrl: `https://www.instagram.com/${parts[0]}/${shortcode}/`,
    mediaType,
    shortcode,
    ...(author ? { originalAuthor: author } : {}),
  }
}

export function normalizeEventInstagramPosts(value: unknown): EventInstagramPost[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_INSTAGRAM_POSTS) throw new Error('invalid_instagram_posts')
  const posts = value.map(normalizePost)
  if (new Set(posts.map((post) => post.sourceUrl)).size !== posts.length) throw new Error('invalid_instagram_posts')
  return posts
}

export function readEventInstagramPosts(value: unknown): EventInstagramPost[] {
  if (!Array.isArray(value)) return []
  const posts: EventInstagramPost[] = []
  const seen = new Set<string>()
  for (const valueItem of value.slice(0, MAX_INSTAGRAM_POSTS)) {
    try {
      const post = normalizePost(valueItem)
      if (seen.has(post.sourceUrl)) continue
      seen.add(post.sourceUrl)
      posts.push(post)
    } catch {
      // Public and owner readers omit malformed legacy values.
    }
  }
  return posts
}
