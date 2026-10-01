import { HttpsError } from 'firebase-functions/v2/https'

export type TextContent = { schemaVersion: 1; format: 'markdown' | 'plain'; body: string }

export function normalizeTextContent(value: unknown): TextContent | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', '본문 형식을 확인해 주세요')
  }
  const data = value as Record<string, unknown>
  if ((data.schemaVersion !== undefined && data.schemaVersion !== 1)
    || (data.format !== 'markdown' && data.format !== 'plain') || typeof data.body !== 'string') {
    throw new HttpsError('invalid-argument', '지원하지 않는 본문 형식이에요')
  }
  if (data.body.length > 50_000) {
    throw new HttpsError('invalid-argument', '본문은 50,000자 이하로 적어 주세요')
  }
  const normalized = data.body.replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return undefined
  const body = data.format === 'plain' ? normalized : normalized.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
  return { schemaVersion: 1, format: data.format, body }
}
