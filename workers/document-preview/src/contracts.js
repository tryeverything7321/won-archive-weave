export const allowedFormats = new Set(['docx', 'pptx', 'xlsx', 'hwp', 'hwpx'])
export const maxInputBytes = 20 * 1024 * 1024
export const maxOutputBytes = 30 * 1024 * 1024
export const conversionTimeoutMs = 45_000

export class PreviewError extends Error {
  constructor(code, status) {
    super(code)
    this.name = 'PreviewError'
    this.code = code
    this.status = status
  }
}

export async function readRequestBytes(request, limit = maxInputBytes) {
  const declared = request.headers['content-length']
  if (declared !== undefined) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new PreviewError('invalid_content_length', 400)
    }
    if (length > limit) throw new PreviewError('input_too_large', 413)
  }

  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new PreviewError('input_too_large', 413)
    chunks.push(chunk)
  }
  if (size === 0) throw new PreviewError('empty_input', 400)
  return Buffer.concat(chunks)
}

export function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders,
  })
  response.end(JSON.stringify(payload))
}
