export type ApprovedPreviewLink = { url: string; expiresAtMs: number; renderFormat?: 'pdf' | 'image' | 'text' | 'csv'; text?: string; truncated?: boolean }
export type PreviewFailure = { title: string; message: string; retry: boolean }
export type OwnerAttachmentDownload = { url: string; expiresAtMs: number; renderFormat: 'download'; fileName: string }

/** Converts callable failures to bounded user actions without exposing server diagnostics. */
export function previewFailure(value: unknown): PreviewFailure {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const code = typeof data.code === 'string' ? data.code.replace(/^functions\//, '') : ''
  const serverMessage = typeof data.message === 'string' ? data.message : ''
  if (code === 'permission-denied') return {
    title: '열람할 수 없음',
    message: '현재 공개 범위나 첨부 검사 상태에서는 미리보기를 열 수 없어요. 안전 확인을 마치지 않은 파일은 열리지 않습니다.',
    retry: false,
  }
  if (code === 'unauthenticated') return {
    title: '로그인 필요',
    message: '이 자료의 공개 범위를 확인하려면 로그인해 주세요.',
    retry: false,
  }
  if (code === 'not-found') return {
    title: '자료를 찾을 수 없음',
    message: '자료가 이동되었거나 공개가 중단됐어요.',
    retry: false,
  }
  if (code === 'failed-precondition') return {
    title: serverMessage.includes('변환') ? '미리보기 변환 실패' : '미리보기 준비 안 됨',
    message: '미리보기를 만들지 못했어요. 원본 다운로드가 허용된 자료라면 미리보기와 별도로 계속 이용할 수 있어요.',
    retry: serverMessage.includes('변환'),
  }
  return {
    title: '미리보기 연결 오류',
    message: '미리보기를 열지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.',
    retry: true,
  }
}

function readShortLivedStorageUrl(value: Record<string, unknown>, now: number): URL {
  if (typeof value.url !== 'string' || typeof value.expiresAtMs !== 'number'
    || !Number.isFinite(value.expiresAtMs) || value.expiresAtMs <= now
    || value.expiresAtMs > now + 6 * 60_000) throw new Error('파일 링크가 만료됐어요. 다시 열어 주세요.')
  const url = new URL(value.url)
  if (url.protocol !== 'https:' || url.username || url.password
    || !['storage.googleapis.com', 'firebasestorage.googleapis.com'].includes(url.hostname)) {
    throw new Error('파일 주소를 확인하지 못했어요.')
  }
  return url
}

export function readOwnerAttachmentDownload(value: unknown, now = Date.now()): OwnerAttachmentDownload {
  if (!value || typeof value !== 'object') throw new Error('다운로드 응답을 확인하지 못했어요.')
  const data = value as Record<string, unknown>
  const url = readShortLivedStorageUrl(data, now)
  if (data.renderFormat !== 'download' || typeof data.fileName !== 'string'
    || !data.fileName.trim() || data.fileName.length > 200 || /[\r\n]/.test(data.fileName)) {
    throw new Error('다운로드 파일 정보를 확인하지 못했어요.')
  }
  return { url: url.href, expiresAtMs: data.expiresAtMs as number, renderFormat: 'download', fileName: data.fileName }
}

/** Accept only short-lived links issued for the existing storage delivery path. */
export function readApprovedPreviewLink(value: unknown, now = Date.now()): ApprovedPreviewLink {
  if (!value || typeof value !== 'object') throw new Error('미리보기 응답을 확인하지 못했어요.')
  const data = value as Record<string, unknown>
  const url = readShortLivedStorageUrl(data, now)
  const renderFormat = data.renderFormat
  if (renderFormat !== undefined && !['pdf', 'image', 'text', 'csv'].includes(String(renderFormat))) throw new Error('알 수 없는 미리보기 형식이에요.')
  if ((renderFormat === 'text' || renderFormat === 'csv') && (typeof data.text !== 'string' || data.text.length > 512 * 1024)) throw new Error('텍스트 미리보기를 확인하지 못했어요.')
  return { url: url.href, expiresAtMs: data.expiresAtMs as number,
    ...(renderFormat ? { renderFormat: renderFormat as ApprovedPreviewLink['renderFormat'] } : {}),
    ...(typeof data.text === 'string' ? { text: data.text } : {}),
    ...(data.truncated === true ? { truncated: true } : {}),
  }
}

export function canPreviewNativeType(type: string): boolean {
  return ['PDF', 'IMAGE', 'TXT', 'CSV'].includes(type)
}

/** Bounded RFC-style quoted CSV reader. Never evaluates cell formulas or HTML. */
export function previewCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length && rows.length < 200; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && (ch === ',' || ch === '\n')) {
      if (row.length < 50) row.push(cell.replace(/\r$/, '').slice(0, 2000))
      cell = ''
      if (ch === '\n') { rows.push(row); row = [] }
    } else { if (cell.length < 2001) cell += ch }
  }
  if (rows.length < 200 && (cell || row.length)) { if (row.length < 50) row.push(cell.replace(/\r$/, '').slice(0, 2000)); rows.push(row) }
  return rows
}
