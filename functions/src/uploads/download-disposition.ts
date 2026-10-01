const MAX_DOWNLOAD_NAME_CODE_POINTS = 180

function lastPathSegment(path: string): { name: string; managed: boolean } {
  const normalized = path.replace(/\\/g, '/')
  return {
    name: normalized.split('/').pop() ?? '',
    managed: normalized.startsWith('managed/'),
  }
}

function safeOriginalName(path: string): string {
  const segment = lastPathSegment(path)
  let name = segment.name.replace(/^u[a-f0-9]{24}--/, '')
  if (segment.managed) name = name.replace(/^[a-f0-9]{12}-/, '')
  name = name
    // Header filenames must remove ASCII controls to prevent CRLF injection.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/["'\\/]/g, '_')
    .trim()
  name = Array.from(name).slice(0, MAX_DOWNLOAD_NAME_CODE_POINTS).join('')
  return name && name !== '.' && name !== '..' ? name : 'attachment'
}

function asciiFallback(name: string): string {
  const fallback = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._() -]/g, '_')
    .replace(/_+/g, '_')
    .trim()
  return fallback && fallback !== '.' && fallback !== '..' ? fallback : 'attachment'
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function downloadFileName(path: string): string {
  return safeOriginalName(path)
}

export function downloadContentDisposition(path: string): string {
  const name = downloadFileName(path)
  return `attachment; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeRfc5987(name)}`
}
