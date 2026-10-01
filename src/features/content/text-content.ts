export type TextContent = { schemaVersion: 1; format: 'markdown'; body: string }

export function readTextContent(value: unknown): TextContent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  return data.schemaVersion === 1 && data.format === 'markdown'
    && typeof data.body === 'string' && data.body.length <= 50_000 && data.body.trim()
    ? { schemaVersion: 1, format: 'markdown', body: data.body } : undefined
}

export function safeContentUrl(value: string): string {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

export function importText(name: string, bytes: ArrayBuffer): string {
  if (!/\.(md|txt)$/i.test(name)) throw new Error('텍스트(.txt) 또는 Markdown(.md) 파일을 선택해 주세요.')
  if (bytes.byteLength > 1024 * 1024) throw new Error('1MB 이하의 파일을 선택해 주세요.')
  let body: string
  try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n') }
  catch { throw new Error('UTF-8로 저장한 텍스트 파일을 선택해 주세요.') }
  if (!body.trim()) throw new Error('파일에 내용이 없어요.')
  if (body.length > 50_000) throw new Error('본문은 50,000자까지 가져올 수 있어요.')
  return body
}
