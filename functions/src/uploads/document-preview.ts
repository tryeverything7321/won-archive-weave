import { createHash } from 'node:crypto'
import { GoogleAuth } from 'google-auth-library'

export const DOCUMENT_PREVIEW_ORIGIN = 'https://weave-document-preview-427663311345.asia-northeast3.run.app'
export const DOCUMENT_PREVIEW_PREFIX = 'document-previews-v1/'
export const MAX_PREVIEW_INPUT = 20 * 1024 * 1024
export const MAX_PREVIEW_OUTPUT = 30 * 1024 * 1024

export function conversionFormat(path: string): string | null {
  const format = path.split('.').pop()?.toLowerCase()
  return format && ['docx', 'pptx', 'xlsx', 'hwp', 'hwpx'].includes(format) ? format : null
}

export function previewCachePath(materialId: string, sourcePath: string, generation: string): string {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(materialId) || !/^\d+$/.test(generation)) throw new Error('invalid_preview_source')
  const hash = createHash('sha256').update(`lo-rhwp086-v1\0${sourcePath}\0${generation}`).digest('hex')
  return `${DOCUMENT_PREVIEW_PREFIX}${materialId}/${hash}.pdf`
}

export async function readConvertedPdf(response: Response): Promise<Buffer> {
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) throw new Error('conversion_unavailable')
  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_PREVIEW_OUTPUT || !response.body) throw new Error('invalid_conversion_size')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PREVIEW_OUTPUT) throw new Error('invalid_conversion_size')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  const pdf = Buffer.concat(chunks)
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid_conversion_pdf')
  return pdf
}

/** No URLs, account identifiers or storage credentials are sent to the renderer. */
export async function convertDocument(bytes: Buffer, format: string): Promise<Buffer> {
  if (!conversionFormat(`source.${format}`) || bytes.length < 1 || bytes.length > MAX_PREVIEW_INPUT) throw new Error('invalid_conversion_input')
  const client = await new GoogleAuth().getIdTokenClient(DOCUMENT_PREVIEW_ORIGIN)
  const headers = await client.getRequestHeaders()
  headers.set('content-type', 'application/octet-stream')
  const response = await fetch(`${DOCUMENT_PREVIEW_ORIGIN}/convert?format=${format}`, {
    method: 'POST', headers, body: Uint8Array.from(bytes), redirect: 'error', signal: AbortSignal.timeout(55_000),
  })
  return readConvertedPdf(response)
}
