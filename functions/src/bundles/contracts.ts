import { createHash } from 'node:crypto'
import { HttpsError } from 'firebase-functions/v2/https'
import { type RightsRecord, type SubmissionVisibility, validateRightsRecord, validateUploadDescriptor } from '../uploads/contracts.js'

export const maximumBundleFiles = 10
export const maximumBundleFileBytes = 20 * 1024 * 1024
export const maximumBundleBytes = 100 * 1024 * 1024

export type MaterialBundleStatus = 'draft' | 'active' | 'withdrawn'
export type MaterialBundleFileStatus = 'upload_pending' | 'scanning' | 'ready' | 'blocked' | 'error' | 'withdrawn'
export type MaterialBundleFileScanStatus = 'pending' | 'clean' | 'blocked' | 'error'

export type MaterialBundleFile = {
  fileId: string
  clientFileId: string
  revision: number
  originalName: string
  displayName: string
  order: number
  sizeBytes: number
  contentType: string
  sha256: string
  status: MaterialBundleFileStatus
  scanStatus: MaterialBundleFileScanStatus
  storagePath?: string
  generation?: string
  scanId?: string
  updatedAtMs: number
}

export type MaterialBundleRecord = {
  ownerUid: string
  title: string
  description: string
  visibility: SubmissionVisibility
  rights: RightsRecord
  eventId: string | null
  status: MaterialBundleStatus
  files: Record<string, MaterialBundleFile>
  createdAtMs: number
  updatedAtMs: number
}

export type MaterialBundleViewer = { uid?: string | null; activeMember?: boolean }

export function canReadMaterialBundle(
  bundle: Pick<MaterialBundleRecord, 'ownerUid' | 'visibility' | 'status'>,
  viewer: MaterialBundleViewer,
): boolean {
  if (viewer.uid === bundle.ownerUid) return true
  if (bundle.status !== 'active' || bundle.visibility === 'hold') return false
  return bundle.visibility === 'public' || viewer.activeMember === true
}

export function canReadMaterialBundleFile(
  bundle: Pick<MaterialBundleRecord, 'ownerUid' | 'visibility' | 'status'>,
  file: Pick<MaterialBundleFile, 'status' | 'scanStatus'>,
  viewer: MaterialBundleViewer,
): boolean {
  return canReadMaterialBundle(bundle, viewer) && file.status === 'ready' && file.scanStatus === 'clean'
}

function publicFile(file: MaterialBundleFile) {
  return {
    fileId: file.fileId,
    revision: file.revision,
    originalName: file.originalName,
    displayName: file.displayName,
    order: file.order,
    sizeBytes: file.sizeBytes,
    contentType: file.contentType,
    status: file.status,
    scanStatus: file.scanStatus,
  }
}

export function projectMaterialBundle(bundleId: string, bundle: MaterialBundleRecord, ownerView = false) {
  const allFiles = Object.values(bundle.files).sort((left, right) => left.order - right.order || left.fileId.localeCompare(right.fileId))
  const files = ownerView
    ? allFiles
    : allFiles.filter((file) => file.status === 'ready' && file.scanStatus === 'clean')
  return {
    bundleId,
    title: bundle.title,
    description: bundle.description,
    visibility: bundle.visibility,
    status: bundle.status,
    eventId: bundle.eventId,
    source: bundle.rights.source,
    attribution: bundle.rights.attribution,
    redistribution: bundle.rights.redistribution,
    ...(ownerView ? { rights: bundle.rights } : {}),
    createdAtMs: bundle.createdAtMs,
    updatedAtMs: bundle.updatedAtMs,
    fileCount: files.filter((file) => file.status !== 'withdrawn').length,
    readyFileCount: files.filter((file) => file.status === 'ready' && file.scanStatus === 'clean').length,
    files: files.map((file) => ownerView
      ? { ...publicFile(file), clientFileId: file.clientFileId, sha256: file.sha256, storagePath: file.storagePath }
      : publicFile(file)),
  }
}

export function normalizeBundleId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id)) throw new HttpsError('invalid-argument', '자료 묶음을 다시 선택해 주세요')
  return id
}

export function normalizeRequestId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id)) throw new HttpsError('invalid-argument', '요청 식별자를 확인해 주세요')
  return id
}

function text(value: unknown, label: string, minimum: number, maximum: number): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.length < minimum || result.length > maximum) throw new HttpsError('invalid-argument', `${label}을 확인해 주세요`)
  return result
}

export function normalizeBundleMetadata(value: unknown, nowMs = Date.now()) {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const visibility = data.visibility
  if (visibility !== 'public' && visibility !== 'member_only' && visibility !== 'hold') {
    throw new HttpsError('invalid-argument', '공개 범위를 확인해 주세요')
  }
  let rights: RightsRecord
  try { rights = validateRightsRecord(data.rights as RightsRecord, nowMs) }
  catch { throw new HttpsError('invalid-argument', '자료의 출처와 이용 권한을 확인해 주세요') }
  const eventId = data.eventId === undefined || data.eventId === null || data.eventId === ''
    ? null
    : text(data.eventId, '연결할 행사', 1, 120)
  return {
    title: text(data.title, '자료 묶음 제목', 2, 120),
    description: typeof data.description === 'string' ? data.description.trim().slice(0, 5_000) : '',
    visibility,
    rights,
    eventId,
  }
}

export type PreparedBundleFile = {
  clientFileId: string
  replaceFileId?: string
  originalName: string
  displayName: string
  order: number
  sizeBytes: number
  contentType: string
  sha256: string
}

export function normalizeBundleFiles(value: unknown): PreparedBundleFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumBundleFiles) {
    throw new HttpsError('invalid-argument', '한 번에 1개부터 10개까지 선택해 주세요')
  }
  const files = value.map((raw, index): PreparedBundleFile => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const clientFileId = text(item.clientFileId, '파일 식별자', 8, 120)
    if (!/^[A-Za-z0-9_-]+$/.test(clientFileId)) throw new HttpsError('invalid-argument', '파일 식별자를 확인해 주세요')
    const replaceFileId = item.replaceFileId === undefined ? undefined : text(item.replaceFileId, '교체할 파일', 8, 80)
    const originalName = text(item.name, '파일 이름', 1, 220)
    if (originalName.includes('/') || originalName.includes('\\') || originalName.includes('..')
      || [...originalName].some((character) => character.charCodeAt(0) < 32)) {
      throw new HttpsError('invalid-argument', '파일 이름을 확인해 주세요')
    }
    const sizeBytes = Number(item.size)
    const contentType = typeof item.contentType === 'string' ? item.contentType : ''
    const sha256 = typeof item.sha256 === 'string' ? item.sha256.toLowerCase() : ''
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpsError('invalid-argument', '파일 식별 정보를 확인해 주세요')
    try { validateUploadDescriptor({ name: originalName, size: sizeBytes, contentType }, maximumBundleFileBytes) }
    catch { throw new HttpsError('invalid-argument', '지원하는 형식의 20MB 이하 파일을 선택해 주세요') }
    const displayName = typeof item.displayName === 'string' && item.displayName.trim()
      ? text(item.displayName, '표시 이름', 1, 160)
      : originalName
    const order = Number.isSafeInteger(item.order) && Number(item.order) >= 0 ? Number(item.order) : index
    return { clientFileId, ...(replaceFileId ? { replaceFileId } : {}), originalName, displayName, order, sizeBytes, contentType, sha256 }
  })
  if (new Set(files.map((file) => file.clientFileId)).size !== files.length) {
    throw new HttpsError('invalid-argument', '같은 파일 식별자를 두 번 사용할 수 없어요')
  }
  return files
}

export function stableBundleId(uid: string, requestId: string): string {
  return `b_${createHash('sha256').update(`material-bundle:${uid}:${requestId}`).digest('hex').slice(0, 30)}`
}

export function stableBundleFileId(uid: string, bundleId: string, clientFileId: string): string {
  return `f_${createHash('sha256').update(`material-bundle-file:${uid}:${bundleId}:${clientFileId}`).digest('hex').slice(0, 30)}`
}

export function bundleCommandFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function bundleTargetName(input: { requestId: string; fileId: string; revision: number; sha256: string; name: string }): string {
  const validated = validateUploadDescriptor({ name: input.name, size: 1, contentType: extensionMime(input.name) }, maximumBundleFileBytes)
  const prefix = createHash('sha256').update(`${input.requestId}:${input.fileId}:${input.revision}:${input.sha256}`).digest('hex').slice(0, 24)
  return `u${prefix}--${validated.safeName}`
}

function extensionMime(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase()
  const values: Record<string, string> = {
    pdf: 'application/pdf', hwp: 'application/x-hwp', hwpx: 'application/hwp+zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  }
  return values[extension ?? ''] ?? 'application/octet-stream'
}
