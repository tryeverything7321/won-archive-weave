import { createHash } from 'node:crypto'

export const GOOGLE_IMPORT_MAX_BYTES = 20 * 1024 * 1024

const FILE_ID = /^[A-Za-z0-9_-]{20,180}$/
const GOOGLE_NATIVE_MIME = {
  'application/vnd.google-apps.document': [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  'application/vnd.google-apps.spreadsheet': [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  ],
  'application/vnd.google-apps.presentation': [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
} as const
const BLOB_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export type GoogleDriveSourceKind = 'file' | 'document' | 'spreadsheet' | 'presentation'

export type GoogleDriveSourceLink = {
  provider: 'google_drive'
  fileId: string
  sourceKind: GoogleDriveSourceKind
  sourceUrl: string
  redistribution: 'source_link_only'
  retention: 'source_link'
  publicAccessVerified: false
}

export type GooglePickerMetadata = {
  fileId: string
  name: string
  mimeType: string
  modifiedTime: string
  webViewLink: string
  sizeBytes?: number
  exportFormat?: string
  thumbnailUrl?: string
}

export type ValidatedGooglePickerMetadata = GooglePickerMetadata & {
  modifiedTime: string
  sourceKind: GoogleDriveSourceKind
  isNativeGoogleFile: boolean
  requiresExportSizeCheck: boolean
  revisionKey: string
}

export class GoogleDriveContractError extends Error {
  constructor(public readonly code: 'invalid_url' | 'invalid_file_id' | 'invalid_metadata' | 'unsupported_mime' | 'invalid_size' | 'invalid_export') {
    super(code)
  }
}

function validFileId(value: string): string {
  if (!FILE_ID.test(value)) throw new GoogleDriveContractError('invalid_file_id')
  return value
}

function safeHttpsUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new GoogleDriveContractError('invalid_url')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new GoogleDriveContractError('invalid_url')
  }
  return url
}

export function parseGoogleDriveSourceLink(value: string): Pick<GoogleDriveSourceLink, 'fileId' | 'sourceKind' | 'sourceUrl'> {
  const url = safeHttpsUrl(value.trim())
  if (url.hostname === 'drive.google.com') {
    const fileMatch = url.pathname.match(/^\/file\/d\/([^/]+)(?:\/view)?\/?$/)
    if (fileMatch?.[1]) {
      const fileId = validFileId(fileMatch[1])
      return { fileId, sourceKind: 'file', sourceUrl: `https://drive.google.com/file/d/${fileId}/view` }
    }
    if (url.pathname === '/open') {
      const ids = url.searchParams.getAll('id')
      if (ids.length !== 1) throw new GoogleDriveContractError('invalid_url')
      const fileId = validFileId(ids[0] ?? '')
      return { fileId, sourceKind: 'file', sourceUrl: `https://drive.google.com/file/d/${fileId}/view` }
    }
    throw new GoogleDriveContractError('invalid_url')
  }
  if (url.hostname === 'docs.google.com') {
    const match = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)(?:\/(?:edit|view|preview))?\/?$/)
    if (!match?.[1] || !match[2]) throw new GoogleDriveContractError('invalid_url')
    const sourceKind = match[1] === 'spreadsheets' ? 'spreadsheet' : match[1] as Exclude<GoogleDriveSourceKind, 'file'>
    const fileId = validFileId(match[2])
    const pathKind = sourceKind === 'spreadsheet' ? 'spreadsheets' : sourceKind
    return { fileId, sourceKind, sourceUrl: `https://docs.google.com/${pathKind}/d/${fileId}/edit` }
  }
  throw new GoogleDriveContractError('invalid_url')
}

export function buildGoogleDriveSourceLink(value: string): GoogleDriveSourceLink {
  return {
    provider: 'google_drive',
    ...parseGoogleDriveSourceLink(value),
    redistribution: 'source_link_only',
    retention: 'source_link',
    publicAccessVerified: false,
  }
}

export function googleDriveSourceFingerprint(
  source: Pick<GoogleDriveSourceLink, 'provider' | 'fileId' | 'sourceKind' | 'sourceUrl'>,
): string {
  const canonical = parseGoogleDriveSourceLink(source.sourceUrl)
  if (
    source.provider !== 'google_drive'
    || canonical.fileId !== source.fileId
    || canonical.sourceKind !== source.sourceKind
    || canonical.sourceUrl !== source.sourceUrl
  ) throw new GoogleDriveContractError('invalid_metadata')
  return createHash('sha256')
    .update(JSON.stringify([source.provider, source.fileId, source.sourceKind, source.sourceUrl]))
    .digest('hex')
}

function sourceKindForMime(mimeType: string): GoogleDriveSourceKind {
  if (mimeType === 'application/vnd.google-apps.document') return 'document'
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'spreadsheet'
  if (mimeType === 'application/vnd.google-apps.presentation') return 'presentation'
  return 'file'
}

function normalizedModifiedTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new GoogleDriveContractError('invalid_metadata')
  return new Date(timestamp).toISOString()
}

function validateThumbnail(value: string | undefined): void {
  if (!value) return
  const url = safeHttpsUrl(value)
  if (url.hostname !== 'drive.google.com' && !url.hostname.endsWith('.googleusercontent.com')) {
    throw new GoogleDriveContractError('invalid_metadata')
  }
}

export function googleDriveRevisionKey(input: Pick<GooglePickerMetadata, 'fileId' | 'modifiedTime' | 'exportFormat'>): string {
  const fileId = validFileId(input.fileId)
  const modifiedTime = normalizedModifiedTime(input.modifiedTime)
  const exportFormat = input.exportFormat?.trim() || 'source'
  const digest = createHash('sha256').update(JSON.stringify([fileId, modifiedTime, exportFormat])).digest('hex')
  return `google-drive:${digest}`
}

export function validateGoogleImportSize(sizeBytes: number): number {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > GOOGLE_IMPORT_MAX_BYTES) {
    throw new GoogleDriveContractError('invalid_size')
  }
  return sizeBytes
}

export function validateGooglePickerMetadata(input: GooglePickerMetadata): ValidatedGooglePickerMetadata {
  const fileId = validFileId(input.fileId)
  const name = input.name.trim()
  const mimeType = input.mimeType.trim()
  const hasControlCharacter = [...name].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
  if (!name || name.length > 160 || hasControlCharacter) {
    throw new GoogleDriveContractError('invalid_metadata')
  }
  const source = parseGoogleDriveSourceLink(input.webViewLink)
  if (source.fileId !== fileId) throw new GoogleDriveContractError('invalid_metadata')
  validateThumbnail(input.thumbnailUrl)
  const modifiedTime = normalizedModifiedTime(input.modifiedTime)
  const nativeFormats = GOOGLE_NATIVE_MIME[mimeType as keyof typeof GOOGLE_NATIVE_MIME]
  const isNativeGoogleFile = Boolean(nativeFormats)
  if (isNativeGoogleFile) {
    if (!input.exportFormat || !(nativeFormats as readonly string[]).includes(input.exportFormat)) {
      throw new GoogleDriveContractError('invalid_export')
    }
    if (input.sizeBytes !== undefined && (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0)) {
      throw new GoogleDriveContractError('invalid_size')
    }
  } else {
    if (!BLOB_MIME.has(mimeType)) throw new GoogleDriveContractError('unsupported_mime')
    if (input.exportFormat) throw new GoogleDriveContractError('invalid_export')
    validateGoogleImportSize(input.sizeBytes ?? 0)
  }
  const normalized: GooglePickerMetadata = {
    fileId,
    name,
    mimeType,
    modifiedTime,
    webViewLink: source.sourceUrl,
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    ...(input.exportFormat ? { exportFormat: input.exportFormat } : {}),
    ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
  }
  return {
    ...normalized,
    sourceKind: sourceKindForMime(mimeType),
    isNativeGoogleFile,
    requiresExportSizeCheck: isNativeGoogleFile,
    revisionKey: googleDriveRevisionKey(normalized),
  }
}
