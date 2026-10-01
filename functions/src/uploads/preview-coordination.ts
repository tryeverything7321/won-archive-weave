import { createHash, randomUUID } from 'node:crypto'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'

export const previewLeaseTtlMs = 70_000
export const previewWaitTimeoutMs = 60_000

export function previewLeaseDecision(value: {
  ownerToken?: unknown
  expiresAtMs?: unknown
  nowMs: number
}): 'acquire' | 'wait' {
  return typeof value.ownerToken !== 'string'
    || !Number.isSafeInteger(value.expiresAtMs)
    || Number(value.expiresAtMs) <= value.nowMs
    ? 'acquire'
    : 'wait'
}

type CoordinationDependencies = {
  acquire: (key: string, token: string, nowMs: number) => Promise<boolean>
  release: (key: string, token: string) => Promise<void>
  cacheExists: () => Promise<boolean>
  wait: (milliseconds: number) => Promise<void>
  now: () => number
}

const inFlight = new Map<string, Promise<void>>()

async function firestoreAcquire(key: string, token: string, nowMs: number): Promise<boolean> {
  const ref = getFirestore().collection('previewConversionLeases').doc(key)
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (snapshot.exists && previewLeaseDecision({
      ownerToken: snapshot.get('ownerToken'), expiresAtMs: snapshot.get('expiresAtMs'), nowMs,
    }) === 'wait') return false
    transaction.set(ref, {
      ownerToken: token,
      expiresAtMs: nowMs + previewLeaseTtlMs,
      expiresAt: Timestamp.fromMillis(nowMs + previewLeaseTtlMs),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return true
  })
}

async function firestoreRelease(key: string, token: string): Promise<void> {
  const ref = getFirestore().collection('previewConversionLeases').doc(key)
  await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (snapshot.get('ownerToken') === token) transaction.delete(ref)
  })
}

function defaultDependencies(cacheExists: () => Promise<boolean>): CoordinationDependencies {
  return {
    acquire: firestoreAcquire,
    release: firestoreRelease,
    cacheExists,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: Date.now,
  }
}

async function coordinatedWork(
  key: string,
  convertAndSave: () => Promise<void>,
  dependencies: CoordinationDependencies,
): Promise<void> {
  if (await dependencies.cacheExists()) return
  const token = randomUUID()
  let acquired = await dependencies.acquire(key, token, dependencies.now())
  if (!acquired) {
    const deadline = dependencies.now() + previewWaitTimeoutMs
    while (dependencies.now() < deadline) {
      await dependencies.wait(500)
      if (await dependencies.cacheExists()) return
    }
    acquired = await dependencies.acquire(key, token, dependencies.now())
    if (!acquired) throw new Error('preview_conversion_busy')
  }
  try {
    if (!(await dependencies.cacheExists())) await convertAndSave()
  } finally {
    await dependencies.release(key, token)
  }
}

export async function coordinatePreviewConversion(input: {
  cachePath: string
  cacheExists: () => Promise<boolean>
  convertAndSave: () => Promise<void>
  dependencies?: CoordinationDependencies
}): Promise<void> {
  const key = createHash('sha256').update(input.cachePath).digest('hex')
  const existing = inFlight.get(key)
  if (existing) return existing
  const work = coordinatedWork(
    key,
    input.convertAndSave,
    input.dependencies ?? defaultDependencies(input.cacheExists),
  ).finally(() => {
    if (inFlight.get(key) === work) inFlight.delete(key)
  })
  inFlight.set(key, work)
  return work
}
