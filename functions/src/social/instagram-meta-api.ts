import { createHmac } from 'node:crypto'
import type { InstagramApiResult, InstagramMedia, OfficialInstagramApi } from './instagram-service.js'

export type MetaInstagramSettings = {
  appId: string
  appSecret: string
  accessToken: string
  accountId: string
  apiVersion: string
}

export type MetaInstagramIdentity = {
  accountId: string
  accountName: string
}

export class MetaInstagramTransportError extends Error {
  constructor(public readonly code: 'not_configured' | 'invalid_configuration' | 'provider_unavailable') {
    super(code)
  }
}

export function validateMetaInstagramSettings(settings: MetaInstagramSettings): MetaInstagramSettings {
  if (!settings.appId.trim() || !settings.appSecret.trim() || !settings.accessToken.trim() || !settings.accountId.trim()) {
    throw new MetaInstagramTransportError('not_configured')
  }
  if (!/^v\d+\.\d+$/.test(settings.apiVersion) || !/^\d{5,40}$/.test(settings.accountId)) {
    throw new MetaInstagramTransportError('invalid_configuration')
  }
  return { ...settings, appId: settings.appId.trim(), accountId: settings.accountId.trim(), apiVersion: settings.apiVersion.trim() }
}

type MetaErrorBody = { error?: { code?: number } }

export class MetaInstagramGraphApi implements OfficialInstagramApi {
  private readonly settings: MetaInstagramSettings

  constructor(
    settings: MetaInstagramSettings,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.settings = validateMetaInstagramSettings(settings)
  }

  private endpoint(path: string): URL {
    return new URL(`https://graph.facebook.com/${this.settings.apiVersion}/${path.replace(/^\/+/, '')}`)
  }

  private headers(): HeadersInit {
    return { authorization: `Bearer ${this.settings.accessToken}` }
  }

  private addProof(url: URL): void {
    const proof = createHmac('sha256', this.settings.appSecret).update(this.settings.accessToken).digest('hex')
    url.searchParams.set('appsecret_proof', proof)
  }

  private async body(response: Response): Promise<Record<string, unknown> & MetaErrorBody> {
    try {
      return await response.json() as Record<string, unknown> & MetaErrorBody
    } catch {
      return {}
    }
  }

  async identify(): Promise<MetaInstagramIdentity> {
    const url = this.endpoint(this.settings.accountId)
    url.searchParams.set('fields', 'id,username')
    this.addProof(url)
    const response = await this.fetcher(url, { headers: this.headers() })
    const body = await this.body(response)
    if (!response.ok || body.id !== this.settings.accountId || typeof body.username !== 'string' || !/^[A-Za-z0-9._]{1,30}$/.test(body.username)) {
      throw new MetaInstagramTransportError('provider_unavailable')
    }
    return { accountId: this.settings.accountId, accountName: body.username.trim() }
  }

  async sync(input: { tokenReference: string; accountId: string; cursor?: string }): Promise<InstagramApiResult> {
    if (input.tokenReference !== 'secret://META_INSTAGRAM_ACCESS_TOKEN' || input.accountId !== this.settings.accountId) {
      throw new MetaInstagramTransportError('invalid_configuration')
    }
    const url = this.endpoint(`${this.settings.accountId}/media`)
    url.searchParams.set('fields', 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp')
    url.searchParams.set('limit', '50')
    if (input.cursor) url.searchParams.set('after', input.cursor)
    this.addProof(url)
    const response = await this.fetcher(url, { headers: this.headers() })
    const body = await this.body(response)
    if (!response.ok) return this.failure(response, body)

    const rows = Array.isArray(body.data) ? body.data : []
    const media = rows.map((value) => this.media(value)).filter((value): value is InstagramMedia => Boolean(value))
    const paging = body.paging && typeof body.paging === 'object' ? body.paging as Record<string, unknown> : {}
    const cursors = paging.cursors && typeof paging.cursors === 'object' ? paging.cursors as Record<string, unknown> : {}
    const nextCursor = typeof cursors.after === 'string' && typeof paging.next === 'string' ? cursors.after : undefined
    return {
      kind: 'ok',
      accountId: this.settings.accountId,
      accountName: await this.accountName(),
      media,
      ...(nextCursor ? { nextCursor } : {}),
      snapshotComplete: !nextCursor,
    }
  }

  async revoke(input: { tokenReference: string }): Promise<void> {
    if (input.tokenReference !== 'secret://META_INSTAGRAM_ACCESS_TOKEN') {
      throw new MetaInstagramTransportError('invalid_configuration')
    }
    const url = this.endpoint('me/permissions')
    this.addProof(url)
    const response = await this.fetcher(url, { method: 'DELETE', headers: this.headers() })
    if (response.ok) return
    const body = await this.body(response)
    if (body.error?.code === 190) return
    throw new MetaInstagramTransportError('provider_unavailable')
  }

  private async accountName(): Promise<string> {
    return (await this.identify()).accountName
  }

  private media(value: unknown): InstagramMedia | null {
    if (!value || typeof value !== 'object') return null
    const row = value as Record<string, unknown>
    const mediaType = row.media_type
    const publishedAtMs = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN
    if (
      typeof row.id !== 'string'
      || !/^\d{5,60}$/.test(row.id)
      || typeof row.permalink !== 'string'
      || (mediaType !== 'IMAGE' && mediaType !== 'VIDEO' && mediaType !== 'CAROUSEL_ALBUM')
      || !Number.isFinite(publishedAtMs)
    ) return null
    let permalink: URL
    try {
      permalink = new URL(row.permalink)
    } catch {
      return null
    }
    if (permalink.protocol !== 'https:' || (permalink.hostname !== 'instagram.com' && !permalink.hostname.endsWith('.instagram.com'))) return null
    const mediaUrl = this.optionalHttpsUrl(row.media_url)
    const thumbnailUrl = this.optionalHttpsUrl(row.thumbnail_url)
    return {
      providerId: row.id,
      permalink: permalink.toString(),
      mediaType,
      publishedAtMs,
      ...(typeof row.caption === 'string' ? { caption: row.caption.slice(0, 10_000) } : {}),
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    }
  }

  private optionalHttpsUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
    } catch {
      return null
    }
  }

  private failure(response: Response, body: MetaErrorBody): Exclude<InstagramApiResult, { kind: 'ok' }> {
    const code = body.error?.code
    if (response.status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
      const retrySeconds = Number(response.headers.get('retry-after') ?? 900)
      const safeRetrySeconds = Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.min(retrySeconds, 86_400) : 900
      return { kind: 'rate_limited', retryAtMs: this.now() + safeRetrySeconds * 1_000 }
    }
    if (response.status === 401 || code === 190) return { kind: 'expired' }
    if (response.status === 403 || code === 10 || code === 200) return { kind: 'private' }
    throw new MetaInstagramTransportError('provider_unavailable')
  }
}
