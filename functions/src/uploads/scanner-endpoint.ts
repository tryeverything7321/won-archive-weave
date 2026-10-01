import { defineString } from 'firebase-functions/params'

export const DEFAULT_SCANNER_ENDPOINT = 'https://weave-file-scanner-427663311345.asia-northeast3.run.app'
export const FILE_SCANNER_ENDPOINT = defineString('FILE_SCANNER_ENDPOINT', { default: DEFAULT_SCANNER_ENDPOINT })

export function resolveScannerEndpoint(configured: string): URL {
  const endpoint = configured.trim() || DEFAULT_SCANNER_ENDPOINT
  let url: URL
  try { url = new URL(endpoint) }
  catch { throw new Error('file_scanner_endpoint_must_use_https') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) {
    throw new Error('file_scanner_endpoint_must_use_https')
  }
  return url
}
