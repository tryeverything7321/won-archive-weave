export const uploadReservationTtlMs = 15 * 60 * 1_000
export const maximumConcurrentUploadReservations = 3
export const maximumReservedUploadBytes = 60 * 1024 * 1024
export const maximumAccountUploadBytes = 512 * 1024 * 1024
export const uploadAccountWindowMs = 24 * 60 * 60 * 1_000

export type UploadReservationUsage = {
  activeCount: number
  activeBytes: number
  committedBytes: number
  windowStartedAtMs: number
}

export function normalizedUploadReservationUsage(value: unknown, nowMs = Date.now()): UploadReservationUsage {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const integer = (field: string) => Number.isSafeInteger(record[field]) && Number(record[field]) >= 0
    ? Number(record[field])
    : 0
  const windowStartedAtMs = integer('windowStartedAtMs')
  const windowActive = windowStartedAtMs > 0 && windowStartedAtMs + uploadAccountWindowMs > nowMs
  return {
    activeCount: integer('activeCount'),
    activeBytes: integer('activeBytes'),
    committedBytes: windowActive ? integer('committedBytes') : 0,
    windowStartedAtMs: windowActive ? windowStartedAtMs : nowMs,
  }
}

export function reserveUploadCapacity(input: {
  usage: UploadReservationUsage
  requestedBytes: number
  replacingBytes?: number
}): UploadReservationUsage {
  const requestedBytes = input.requestedBytes
  const replacingBytes = Math.max(0, input.replacingBytes ?? 0)
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 1 || replacingBytes > input.usage.activeBytes) {
    throw new Error('invalid_upload_reservation_capacity')
  }
  const replacing = replacingBytes > 0
  const next = {
    activeCount: input.usage.activeCount + (replacing ? 0 : 1),
    activeBytes: input.usage.activeBytes - replacingBytes + requestedBytes,
    committedBytes: input.usage.committedBytes,
    windowStartedAtMs: input.usage.windowStartedAtMs,
  }
  if (next.activeCount > maximumConcurrentUploadReservations) throw new Error('too_many_upload_reservations')
  if (next.activeBytes > maximumReservedUploadBytes) throw new Error('reserved_upload_bytes_exceeded')
  if (next.committedBytes + next.activeBytes > maximumAccountUploadBytes) throw new Error('account_upload_bytes_exceeded')
  return next
}

export function fulfillUploadReservationCapacity(
  usage: UploadReservationUsage,
  reservedBytes: number,
): UploadReservationUsage {
  if (!Number.isSafeInteger(reservedBytes) || reservedBytes < 1 || reservedBytes > usage.activeBytes) {
    throw new Error('invalid_upload_reservation_capacity')
  }
  return {
    activeCount: Math.max(0, usage.activeCount - 1),
    activeBytes: usage.activeBytes - reservedBytes,
    committedBytes: usage.committedBytes + reservedBytes,
    windowStartedAtMs: usage.windowStartedAtMs,
  }
}

export function expireUploadReservationCapacity(
  usage: UploadReservationUsage,
  reservedBytes: number,
): UploadReservationUsage {
  if (!Number.isSafeInteger(reservedBytes) || reservedBytes < 1) throw new Error('invalid_upload_reservation_capacity')
  return {
    activeCount: Math.max(0, usage.activeCount - 1),
    activeBytes: Math.max(0, usage.activeBytes - reservedBytes),
    committedBytes: usage.committedBytes,
    windowStartedAtMs: usage.windowStartedAtMs,
  }
}

export function uploadReservationIsActive(value: {
  status?: unknown
  expiresAtMs?: unknown
  nowMs: number
}): boolean {
  return value.status === 'active'
    && Number.isSafeInteger(value.expiresAtMs)
    && Number(value.expiresAtMs) > value.nowMs
}
