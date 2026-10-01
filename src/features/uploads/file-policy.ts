export const maximumUploadBytes = 20 * 1024 * 1024

export const uploadAccept = [
  '.hwp',
  '.hwpx',
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.txt',
  '.md',
  '.csv',
  'image/jpeg',
  'image/png',
  'image/webp',
].join(',')

type UploadTypePolicy = {
  canonical: string
  accepted: ReadonlySet<string>
}

const genericBrowserTypes = ['', 'application/octet-stream'] as const
const zipBrowserTypes = [...genericBrowserTypes, 'application/zip'] as const

function policy(canonical: string, aliases: readonly string[] = genericBrowserTypes): UploadTypePolicy {
  return { canonical, accepted: new Set([canonical, ...aliases]) }
}

const uploadTypeByExtension: Readonly<Record<string, UploadTypePolicy>> = {
  pdf: policy('application/pdf'),
  hwp: policy('application/x-hwp', [
    'application/x-hwp',
    'application/haansofthwp',
    'application/vnd.hancom.hwp',
    'application/octet-stream',
    '',
  ]),
  hwpx: policy('application/hwp+zip', [
    'application/hwp+zip',
    'application/vnd.hancom.hwpx',
    'application/haansofthwpx',
    'application/zip',
    'application/octet-stream',
    '',
  ]),
  docx: policy('application/vnd.openxmlformats-officedocument.wordprocessingml.document', zipBrowserTypes),
  pptx: policy('application/vnd.openxmlformats-officedocument.presentationml.presentation', zipBrowserTypes),
  xlsx: policy('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zipBrowserTypes),
  txt: policy('text/plain'),
  md: policy('text/markdown', ['text/markdown', 'text/plain', 'application/octet-stream', '']),
  csv: policy('text/csv'),
  jpg: policy('image/jpeg'),
  jpeg: policy('image/jpeg'),
  png: policy('image/png'),
  webp: policy('image/webp'),
}

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function uploadTypePolicy(name: string): UploadTypePolicy | undefined {
  const extension = extensionOf(name)
  return Object.prototype.hasOwnProperty.call(uploadTypeByExtension, extension)
    ? uploadTypeByExtension[extension]
    : undefined
}

export function isHangulDocumentFile(file: Pick<File, 'name'>): boolean {
  const extension = extensionOf(file.name)
  return extension === 'hwp' || extension === 'hwpx'
}

export function uploadContentType(file: Pick<File, 'name' | 'type'>): string {
  const filePolicy = uploadTypePolicy(file.name)
  const browserType = file.type.trim().toLowerCase()
  if (filePolicy?.accepted.has(browserType)) return filePolicy.canonical
  return file.type
}

export function uploadFileError(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return '빈 파일은 올릴 수 없어요.'
  if (file.size > maximumUploadBytes) return '파일은 20MB 이하로 올려 주세요.'
  const filePolicy = uploadTypePolicy(file.name)
  const browserType = file.type.trim().toLowerCase()
  if (!filePolicy || !filePolicy.accepted.has(browserType)) {
    return '한글, PDF, Office 문서, 텍스트, 표 데이터, 이미지 파일을 올릴 수 있어요.'
  }
  if (file.name.length > 160) return '파일 이름을 160자 이하로 줄여 주세요.'
  return null
}
