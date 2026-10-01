export type PreviewFormat = 'pdf' | 'image' | 'text' | 'csv'

export function nativePreviewFormat(path: string): PreviewFormat | null {
  const ext = path.split('/').pop()?.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext && ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image'
  if (ext === 'txt' || ext === 'md') return 'text'
  if (ext === 'csv') return 'csv'
  return null
}

export function decodePreviewText(bytes: Uint8Array): { text: string; truncated: boolean } {
  const limit = 512 * 1024
  const truncated = bytes.length > limit
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const text = decoder.decode(bytes.subarray(0, limit), { stream: truncated })
  return { text: text.split(String.fromCharCode(0)).join(''), truncated }
}
