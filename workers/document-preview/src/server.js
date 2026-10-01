import { createServer } from 'node:http'
import { allowedFormats, PreviewError, readRequestBytes, sendJson } from './contracts.js'
import { createDocumentConverter } from './converter.js'

export function createConversionHandler({ convert = createDocumentConverter() } = {}) {
  let active = false

  return async function conversionHandler(request, response) {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { allow: 'POST' })
      return
    }

    let url
    try {
      url = new URL(request.url ?? '/', 'http://worker.invalid')
    } catch {
      sendJson(response, 400, { error: 'invalid_request_url' })
      return
    }
    const format = url.searchParams.get('format') ?? ''
    if (url.pathname !== '/convert' || !allowedFormats.has(format)) {
      sendJson(response, 415, { error: 'unsupported_format' })
      return
    }
    if (active) {
      sendJson(response, 429, { error: 'conversion_busy' }, { 'retry-after': '1' })
      return
    }

    active = true
    try {
      const bytes = await readRequestBytes(request)
      const pdf = await convert(bytes, format)
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-disposition': 'inline; filename="preview.pdf"',
        'content-length': String(pdf.length),
        'content-type': 'application/pdf',
        'x-content-type-options': 'nosniff',
      })
      response.end(pdf)
    } catch (error) {
      const previewError = error instanceof PreviewError
        ? error
        : new PreviewError('conversion_failed', 422)
      sendJson(response, previewError.status, { error: previewError.code })
    } finally {
      active = false
    }
  }
}

export function startServer({ port = Number(process.env.PORT ?? 8080), convert } = {}) {
  const handler = createConversionHandler(convert ? { convert } : undefined)
  const server = createServer((request, response) => {
    void handler(request, response)
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 60_000
  server.keepAliveTimeout = 5_000
  server.maxRequestsPerSocket = 10
  return server.listen(port)
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer()
}
