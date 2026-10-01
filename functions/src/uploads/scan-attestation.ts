import { HttpsError } from 'firebase-functions/v2/https'

export type QuarantinedObjectFingerprint = {
  path: string
  generation: string
  size: number
  contentHash: string
}

export type ScanAttestation = {
  schemaVersion: 1
  verdict: 'clean' | 'blocked'
  provider: string
  scanId: string
  engineVersion: string
  scannedAtMs: number
  objects: QuarantinedObjectFingerprint[]
}

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000

function requiredText(value: unknown, field: string, maxLength = 160): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} 값을 확인해 주세요`)
  }
  return text
}

function normalizeObject(value: unknown): QuarantinedObjectFingerprint {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', '검사한 파일 정보를 확인해 주세요')
  }
  const data = value as Record<string, unknown>
  const size = data.size
  if (!Number.isSafeInteger(size) || Number(size) <= 0) {
    throw new HttpsError('invalid-argument', '검사한 파일 크기를 확인해 주세요')
  }
  return {
    path: requiredText(data.path, '파일 경로', 512),
    generation: requiredText(data.generation, '파일 세대'),
    size: Number(size),
    contentHash: requiredText(data.contentHash, '파일 해시'),
  }
}

function objectKey(value: QuarantinedObjectFingerprint): string {
  return `${value.path}\u0000${value.generation}\u0000${value.size}\u0000${value.contentHash}`
}

function sortedObjectKeys(values: QuarantinedObjectFingerprint[]): string[] {
  return values.map(objectKey).sort()
}

export function parseScanAttestation(value: unknown, nowMs = Date.now()): ScanAttestation {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', '검사 결과를 확인해 주세요')
  }
  const data = value as Record<string, unknown>
  if (data.schemaVersion !== 1 || (data.verdict !== 'clean' && data.verdict !== 'blocked')) {
    throw new HttpsError('invalid-argument', '검사 결과 형식을 확인해 주세요')
  }
  if (!Number.isSafeInteger(data.scannedAtMs) || Number(data.scannedAtMs) <= 0 || Number(data.scannedAtMs) > nowMs + MAX_CLOCK_SKEW_MS) {
    throw new HttpsError('invalid-argument', '검사 시각을 확인해 주세요')
  }
  if (!Array.isArray(data.objects) || data.objects.length === 0 || data.objects.length > 20) {
    throw new HttpsError('invalid-argument', '검사한 파일 목록을 확인해 주세요')
  }
  const objects = data.objects.map(normalizeObject)
  if (new Set(objects.map((object) => object.path)).size !== objects.length) {
    throw new HttpsError('invalid-argument', '검사한 파일 목록에 중복된 경로가 있어요')
  }
  return {
    schemaVersion: 1,
    verdict: data.verdict,
    provider: requiredText(data.provider, '검사 제공자'),
    scanId: requiredText(data.scanId, '검사 ID'),
    engineVersion: requiredText(data.engineVersion, '검사 엔진 버전'),
    scannedAtMs: Number(data.scannedAtMs),
    objects,
  }
}

export function assertAttestationMatchesObjects(
  attestation: ScanAttestation,
  actualObjects: QuarantinedObjectFingerprint[],
): void {
  if (actualObjects.length === 0) {
    throw new HttpsError('failed-precondition', '검사할 파일을 찾지 못했어요')
  }
  const expected = sortedObjectKeys(attestation.objects)
  const actual = sortedObjectKeys(actualObjects)
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw new HttpsError('failed-precondition', '검사 이후 파일이 바뀌었어요 다시 검사해 주세요')
  }
}

export function requireScanAttestor(token: Record<string, unknown> | undefined): void {
  if (token?.role !== 'administrator' || token?.scanAttestor !== true) {
    throw new HttpsError('permission-denied', '검사 결과를 기록할 권한이 필요합니다')
  }
}
