type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const pendingMemory = new Map<string, string>()

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function smallHash(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36)
}

function availableStorage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage }
  catch { return null }
}

export function communityWriteRequest(
  kind: 'post' | 'comment' | 'case',
  payload: unknown,
  storage: StorageLike | null = availableStorage(),
): { requestId: string; storageKey: string } {
  const storageKey = `weave-community-write-v1:${kind}:${smallHash(stableJson(payload))}`
  const remembered = pendingMemory.get(storageKey)
  if (remembered) return { requestId: remembered, storageKey }
  try {
    const existing = storage?.getItem(storageKey)
    if (existing && /^[A-Za-z0-9_-]{8,120}$/.test(existing)) {
      pendingMemory.set(storageKey, existing)
      return { requestId: existing, storageKey }
    }
  } catch { /* A write still proceeds with an in-memory request identifier. */ }
  const requestId = crypto.randomUUID()
  pendingMemory.set(storageKey, requestId)
  try { storage?.setItem(storageKey, requestId) } catch { /* Browser storage can be unavailable. */ }
  return { requestId, storageKey }
}

export function completeCommunityWriteRequest(storageKey: string, storage: StorageLike | null = availableStorage()): void {
  pendingMemory.delete(storageKey)
  try { storage?.removeItem(storageKey) } catch { /* The server result remains authoritative. */ }
}
