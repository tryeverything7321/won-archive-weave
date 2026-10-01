import { createHash } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { onSchedule } from 'firebase-functions/v2/scheduler'

if (!getApps().length) initializeApp()

export type StorageCleanupObject = {
  path: string
  generation?: string
}

const cleanupPrefixes = ['managed/', 'approved/public/', 'approved/members/'] as const

function safeCleanupPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const path = value.trim()
  if (!path || path.includes('..') || !cleanupPrefixes.some((prefix) => path.startsWith(prefix))) return undefined
  return path
}

export function storageCleanupObjects(...records: Array<Record<string, unknown> | undefined>): StorageCleanupObject[] {
  const values: StorageCleanupObject[] = []
  for (const record of records) {
    if (!record) continue
    for (const field of ['approvedStorageObjects', 'staleManagedPaths'] as const) {
      if (Array.isArray(record[field])) {
        for (const raw of record[field]) {
          if (!raw || typeof raw !== 'object') continue
          const value = raw as Record<string, unknown>
          const path = safeCleanupPath(value.path)
          const generation = typeof value.generation === 'string' && value.generation.trim() ? value.generation.trim() : undefined
          if (path) values.push({ path, ...(generation ? { generation } : {}) })
        }
      }
    }
    for (const field of ['approvedStoragePath', 'previewStoragePath'] as const) {
      const path = safeCleanupPath(record[field])
      if (path) values.push({ path })
    }
    for (const field of ['approvedStoragePaths', 'staleManagedPaths'] as const) {
      if (!Array.isArray(record[field])) continue
      for (const raw of record[field]) {
        const path = safeCleanupPath(raw)
        if (path) values.push({ path })
      }
    }
  }

  const byPath = new Map<string, StorageCleanupObject>()
  for (const value of values) {
    const current = byPath.get(value.path)
    if (!current || (!current.generation && value.generation)) byPath.set(value.path, value)
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export function cleanupPlanHash(objects: StorageCleanupObject[]): string {
  return createHash('sha256')
    .update(objects.map((object) => `${object.path}\u0000${object.generation ?? ''}`).sort().join('\u0001'))
    .digest('hex')
}

type ImmutableCleanupPlan = {
  objects: Required<StorageCleanupObject>[]
  planHash: string
}

function parseImmutableCleanupPlan(value: Record<string, unknown> | undefined): ImmutableCleanupPlan | null {
  if (!value || value.planVersion !== 1 || !Array.isArray(value.objects)) return null
  const objects = storageCleanupObjects({ approvedStorageObjects: value.objects })
  if (
    objects.length !== value.objects.length
    || objects.some((object) => !object.generation)
  ) return null
  const exact = objects as Required<StorageCleanupObject>[]
  const planHash = cleanupPlanHash(exact)
  if (value.planHash !== planHash) throw new Error('storage_cleanup_plan_hash_mismatch')
  return { objects: exact, planHash }
}

export function selectImmutableCleanupPlan(
  persisted: Record<string, unknown> | undefined,
  newlyResolved: Required<StorageCleanupObject>[],
): ImmutableCleanupPlan {
  const existing = parseImmutableCleanupPlan(persisted)
  if (existing) return existing
  const objects = storageCleanupObjects({ approvedStorageObjects: newlyResolved })
  if (objects.some((object) => !object.generation)) throw new Error('storage_cleanup_generation_missing')
  const exact = objects as Required<StorageCleanupObject>[]
  return { objects: exact, planHash: cleanupPlanHash(exact) }
}

export async function deleteStorageCleanupObjects(
  objects: StorageCleanupObject[],
  remove: (object: Required<StorageCleanupObject>) => Promise<void>,
): Promise<{ deleted: Required<StorageCleanupObject>[]; failed: Required<StorageCleanupObject>[] }> {
  const deleted: Required<StorageCleanupObject>[] = []
  const failed: Required<StorageCleanupObject>[] = []
  for (const object of objects) {
    if (!object.generation) {
      failed.push({ path: object.path, generation: '' })
      continue
    }
    const exact = { path: object.path, generation: object.generation }
    try {
      await remove(exact)
      deleted.push(exact)
    } catch {
      failed.push(exact)
    }
  }
  return { deleted, failed }
}

async function resolveCleanupObjects(objects: StorageCleanupObject[]): Promise<Required<StorageCleanupObject>[]> {
  const bucket = getStorage().bucket()
  const resolved: Required<StorageCleanupObject>[] = []
  for (const object of objects) {
    if (object.generation) {
      resolved.push({ path: object.path, generation: object.generation })
      continue
    }
    try {
      const [metadata] = await bucket.file(object.path).getMetadata()
      const generation = String(metadata.generation ?? '')
      if (generation) resolved.push({ path: object.path, generation })
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? Number((error as { code?: unknown }).code)
        : 0
      if (code !== 404) throw error
    }
  }
  return resolved
}

async function loadOrCreateCleanupPlan(
  submissionId: string,
  rawObjects: StorageCleanupObject[],
): Promise<ImmutableCleanupPlan> {
  const firestore = getFirestore()
  const jobRef = firestore.collection('storageCleanupJobs').doc(submissionId)
  const existing = await jobRef.get()
  if (existing.exists) {
    const plan = parseImmutableCleanupPlan(existing.data())
    if (plan) return plan
    if (existing.get('planVersion') !== 0) throw new Error('storage_cleanup_plan_invalid')
  }

  const queuedObjects = existing.exists && Array.isArray(existing.get('rawObjects'))
    ? existing.get('rawObjects') as StorageCleanupObject[]
    : rawObjects
  const requestId = existing.exists && typeof existing.get('cleanupRequestId') === 'string'
    ? existing.get('cleanupRequestId') as string
    : ''
  const resolved = await resolveCleanupObjects(storageCleanupObjects({ approvedStorageObjects: queuedObjects }))
  return firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(jobRef)
    if (current.exists) {
      const plan = parseImmutableCleanupPlan(current.data())
      if (plan) return plan
      if (
        current.get('planVersion') !== 0
        || (requestId && current.get('cleanupRequestId') !== requestId)
      ) throw new Error('storage_cleanup_plan_changed')
    }
    const plan = selectImmutableCleanupPlan(undefined, resolved)
    transaction.set(jobRef, {
      submissionId,
      cleanupRequestId: requestId,
      planVersion: 1,
      planHash: plan.planHash,
      objects: plan.objects,
      rawObjects: FieldValue.delete(),
      dryRunRecorded: true,
      status: 'planned',
      attemptCount: current.exists ? Number(current.get('attemptCount') ?? 0) : 0,
      nextAttemptAt: current.exists ? current.get('nextAttemptAt') : FieldValue.serverTimestamp(),
      plannedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return plan
  })
}

const maxCleanupAttempts = 5

export function cleanupRetryDecision(attemptCount: number, nowMs: number) {
  const nextAttemptCount = Math.max(0, Math.floor(attemptCount)) + 1
  const terminal = nextAttemptCount >= maxCleanupAttempts
  const delayMs = Math.min(6 * 60 * 60 * 1_000, 5 * 60 * 1_000 * 2 ** (nextAttemptCount - 1))
  return {
    attemptCount: nextAttemptCount,
    terminal,
    nextAttemptAtMs: terminal ? null : nowMs + delayMs,
  }
}

async function recordCleanupFailure(
  submissionId: string,
  code: string,
  paths: string[] = [],
): Promise<'failed' | 'dead_letter'> {
  const firestore = getFirestore()
  const submissionRef = firestore.collection('submissions').doc(submissionId)
  const jobRef = firestore.collection('storageCleanupJobs').doc(submissionId)
  const alertRef = firestore.collection('storageCleanupAlerts').doc(submissionId)
  const exceptionRef = firestore.collection('submissionOperatorExceptions').doc(submissionId)
  const outcome = await firestore.runTransaction(async (transaction) => {
    const job = await transaction.get(jobRef)
    const decision = cleanupRetryDecision(Number(job.get('attemptCount') ?? 0), Date.now())
    const state = decision.terminal ? 'dead_letter' : 'failed'
    transaction.set(jobRef, {
      status: state,
      attemptCount: decision.attemptCount,
      lastFailureCode: code,
      failedPaths: paths,
      nextAttemptAt: decision.nextAttemptAtMs === null
        ? FieldValue.delete()
        : Timestamp.fromMillis(decision.nextAttemptAtMs),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    transaction.set(submissionRef, {
      cleanupState: state,
      cleanupAttemptCount: decision.attemptCount,
      cleanupFailure: {
        code,
        paths,
        at: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    transaction.set(alertRef, {
      submissionId,
      status: 'open',
      terminal: decision.terminal,
      code,
      paths,
      attemptCount: decision.attemptCount,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    transaction.set(exceptionRef, {
      submissionId,
      type: decision.terminal ? 'cleanup_dead_letter' : 'cleanup_failed',
      status: 'open',
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    transaction.set(firestore.collection('auditEvents').doc(), {
      type: decision.terminal
        ? 'submission.storage_cleanup_dead_lettered'
        : 'submission.storage_cleanup_retry_scheduled',
      submissionId,
      code,
      attemptCount: decision.attemptCount,
      at: FieldValue.serverTimestamp(),
    })
    return state
  })
  return outcome
}

export async function runSubmissionStorageCleanup(submissionId: string) {
  const firestore = getFirestore()
  const submissionRef = firestore.collection('submissions').doc(submissionId)
  const snapshot = await submissionRef.get()
  const rawObjects = Array.isArray(snapshot.get('cleanupObjects'))
    ? snapshot.get('cleanupObjects') as StorageCleanupObject[]
    : []
  const jobRef = firestore.collection('storageCleanupJobs').doc(submissionId)
  const { objects, planHash } = await loadOrCreateCleanupPlan(submissionId, rawObjects)

  await firestore.collection('auditEvents').add({
    type: 'submission.storage_cleanup_planned',
    submissionId,
    planHash,
    objectCount: objects.length,
    at: FieldValue.serverTimestamp(),
  })

  const result = await deleteStorageCleanupObjects(objects, async ({ path, generation }) => {
    await getStorage().bucket().file(path, { generation }).delete({
      ignoreNotFound: true,
      ifGenerationMatch: generation,
    })
  })
  const completed = result.failed.length === 0
  if (!completed) {
    const state = await recordCleanupFailure(
      submissionId,
      'delete_failed_or_generation_changed',
      result.failed.map((object) => object.path),
    )
    return { completed, state, ...result, planHash }
  }
  await submissionRef.set({
    cleanupState: 'completed',
    cleanupObjects: FieldValue.delete(),
    cleanupRequestId: FieldValue.delete(),
    staleManagedPaths: FieldValue.delete(),
    cleanupCompletedAt: FieldValue.serverTimestamp(),
    cleanupFailure: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  await jobRef.set({
    status: 'completed',
    deletedObjects: result.deleted,
    failedObjects: [],
    nextAttemptAt: FieldValue.delete(),
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  await firestore.collection('storageCleanupAlerts').doc(submissionId).set({
    status: 'resolved',
    resolvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  await firestore.collection('submissionOperatorExceptions').doc(submissionId).set({
    status: 'resolved',
    resolvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  await firestore.collection('auditEvents').add({
    type: 'submission.storage_cleanup_completed',
    submissionId,
    planHash,
    deletedCount: result.deleted.length,
    failedCount: result.failed.length,
    at: FieldValue.serverTimestamp(),
  })
  return { completed, state: 'completed' as const, ...result, planHash }
}

export async function attemptSubmissionStorageCleanup(submissionId: string) {
  try {
    return await runSubmissionStorageCleanup(submissionId)
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 160) : 'storage_cleanup_failed'
    const state = await recordCleanupFailure(submissionId, code)
    return {
      completed: false,
      state,
      deleted: [],
      failed: [],
      planHash: '',
    }
  }
}

export const processPendingSubmissionCleanups = onSchedule(
  {
    region: 'asia-northeast3',
    schedule: 'every 15 minutes',
    retryCount: 3,
    timeoutSeconds: 300,
  },
  async () => {
    const now = Timestamp.now()
    const pending = await getFirestore().collection('storageCleanupJobs')
      .orderBy('nextAttemptAt', 'asc')
      .limit(50)
      .get()
    for (const job of pending.docs) {
      const nextAttemptAt = job.get('nextAttemptAt')
      if (!(nextAttemptAt instanceof Timestamp) || nextAttemptAt.toMillis() > now.toMillis()) break
      try {
        await attemptSubmissionStorageCleanup(String(job.get('submissionId') ?? job.id))
      } catch (error) {
        console.error('Storage cleanup job could not record its failure', job.id, error)
      }
    }
  },
)
