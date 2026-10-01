export type AttachmentStatus = 'pending' | 'clean' | 'blocked' | 'error'

export function materialVisibilityLabel(visibility: string): string {
  if (visibility === '회원 전용') return '위브 로그인 이용자에게 공개'
  if (visibility === '공개') return '누구나 공개'
  return visibility
}

// A linked record may have been hidden or changed visibility since it was linked.
// Only access/not-found failures are an absent record; transport failures must surface.
export async function readAccessibleMaterial<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    if (code === 'permission-denied' || code === 'not-found') return undefined
    throw error
  }
}

export function isReadablePublication(value: Record<string, unknown>, audience: 'public' | 'member') {
  return value.status === 'published'
    && (value.visibility === 'public' || (audience === 'member' && value.visibility === 'member_only'))
}

export function linkedMaterialIds(value: Record<string, unknown>): string[] {
  return [...new Set([value.materialId, ...(Array.isArray(value.linkedMaterialIds) ? value.linkedMaterialIds : [])]
    .filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id)))].slice(0, 30)
}

export function readAttachmentStatus(value: unknown): AttachmentStatus | undefined {
  if (value === undefined) return undefined
  return value === 'pending' || value === 'clean' || value === 'blocked' || value === 'error' ? value : 'error'
}

export function attachmentStatusCopy(status?: AttachmentStatus): string {
  if (status === 'pending') return '첨부 파일을 확인하고 있어요. 확인이 끝나면 파일을 열 수 있어요.'
  if (status === 'blocked') return '안전 검사에서 문제가 발견되어 첨부 파일은 열 수 없어요. 작성자가 파일을 바꿀 수 있어요.'
  if (status === 'error') return '첨부 파일 확인을 마치지 못했어요. 본문은 읽을 수 있으며 파일은 재확인이 필요해요.'
  return ''
}

export function materialFormat(sourceMode: unknown, hasBody: boolean, extension: string) {
  if (sourceMode === 'text' && hasBody) return 'TEXT'
  if (['JPG', 'JPEG', 'PNG', 'WEBP'].includes(extension)) return 'IMAGE'
  if (['PDF', 'PPTX', 'DOCX', 'HWP', 'HWPX', 'XLSX', 'TXT', 'CSV'].includes(extension)) return extension
  return sourceMode === 'upload' ? 'FILE' : 'LINK'
}
