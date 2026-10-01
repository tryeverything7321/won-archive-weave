export const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1_000;
export const MAX_DRAFT_SERIALIZED_BYTES = 512 * 1_024;
const DRAFT_PREFIX = "weave:form-draft:v1:";

export type DraftIdentity = {
  ownerId: string;
  kind: string;
  documentId: string;
};

export type DraftEnvelope<T> = {
  version: 1;
  identity: DraftIdentity;
  revision: string;
  savedAtMs: number;
  expiresAtMs: number;
  value: T;
  fileReselectionRequired: boolean;
};

export type DraftLoadResult<T> =
  | { status: "ready"; draft: DraftEnvelope<T> }
  | { status: "missing" | "expired" | "corrupt" | "unavailable" };

export type DraftSaveResult =
  | { status: "saved"; revision: string; savedAtMs: number }
  | { status: "error"; reason: "quota" | "unavailable" | "invalid" | "owner_mismatch" };

export type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

function validPart(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function validIdentity(value: unknown): value is DraftIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return validPart(record.ownerId) && validPart(record.kind) && validPart(record.documentId);
}

function sameIdentity(left: DraftIdentity, right: DraftIdentity): boolean {
  return left.ownerId === right.ownerId && left.kind === right.kind && left.documentId === right.documentId;
}

function isJsonSafe(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonSafe(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value as Record<string, unknown>).every((item) => isJsonSafe(item, seen));
}

function storageOwner(key: string): string | null {
  if (!key.startsWith(DRAFT_PREFIX)) return null;
  const encoded = key.slice(DRAFT_PREFIX.length).split(":", 1)[0];
  if (!encoded) return null;
  try { return decodeURIComponent(encoded); } catch { return null; }
}

function draftKeys(storage: DraftStorage): string[] | null {
  const keys: string[] = [];
  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
    return keys;
  } catch { return null; }
}

export function draftStorageKey(identity: DraftIdentity): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(identity.ownerId)}:${encodeURIComponent(identity.kind)}:${encodeURIComponent(identity.documentId)}`;
}

export function createDraftRevision(hydrationNonce: string, counter: number): string {
  if (!validPart(hydrationNonce) || !Number.isSafeInteger(counter) || counter < 1) throw new Error("invalid_draft_revision");
  return `${hydrationNonce}:${counter}`;
}

export function createDraftStore(storage: DraftStorage, now: () => number = Date.now) {
  let activeOwner: string | null | undefined;

  function removeKey(key: string): boolean {
    try { storage.removeItem(key); return true; } catch { return false; }
  }

  return {
    load<T>(identity: DraftIdentity): DraftLoadResult<T> {
      if (!validIdentity(identity) || (activeOwner !== undefined && activeOwner !== identity.ownerId)) return { status: "missing" };
      const key = draftStorageKey(identity);
      let raw: string | null;
      try { raw = storage.getItem(key); } catch { return { status: "unavailable" }; }
      if (raw === null) return { status: "missing" };
      if (new TextEncoder().encode(raw).byteLength > MAX_DRAFT_SERIALIZED_BYTES) {
        removeKey(key);
        return { status: "corrupt" };
      }
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { removeKey(key); return { status: "corrupt" }; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        removeKey(key);
        return { status: "corrupt" };
      }
      const draft = parsed as Partial<DraftEnvelope<T>>;
      if (
        draft.version !== 1
        || !validIdentity(draft.identity)
        || !sameIdentity(draft.identity, identity)
        || !validPart(draft.revision)
        || typeof draft.savedAtMs !== "number"
        || typeof draft.expiresAtMs !== "number"
        || draft.expiresAtMs - draft.savedAtMs !== MAX_DRAFT_AGE_MS
        || !isJsonSafe(draft.value)
        || typeof draft.fileReselectionRequired !== "boolean"
      ) {
        removeKey(key);
        return { status: "corrupt" };
      }
      if (draft.expiresAtMs <= now()) {
        removeKey(key);
        return { status: "expired" };
      }
      return { status: "ready", draft: draft as DraftEnvelope<T> };
    },

    save<T>(
      identity: DraftIdentity,
      revision: string,
      value: T,
      options: { fileReselectionRequired?: boolean } = {},
    ): DraftSaveResult {
      if (activeOwner !== undefined && activeOwner !== identity.ownerId) return { status: "error", reason: "owner_mismatch" };
      if (!validIdentity(identity) || !validPart(revision) || !isJsonSafe(value)) return { status: "error", reason: "invalid" };
      const savedAtMs = now();
      const envelope: DraftEnvelope<T> = {
        version: 1,
        identity,
        revision,
        savedAtMs,
        expiresAtMs: savedAtMs + MAX_DRAFT_AGE_MS,
        value,
        fileReselectionRequired: options.fileReselectionRequired === true,
      };
      const serialized = JSON.stringify(envelope);
      if (new TextEncoder().encode(serialized).byteLength > MAX_DRAFT_SERIALIZED_BYTES) {
        return { status: "error", reason: "quota" };
      }
      try {
        storage.setItem(draftStorageKey(identity), serialized);
        return { status: "saved", revision, savedAtMs };
      } catch (error) {
        return {
          status: "error",
          reason: (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "QuotaExceededError")
            || (error instanceof Error && error.name === "QuotaExceededError")
            ? "quota"
            : "unavailable",
        };
      }
    },

    remove(identity: DraftIdentity): boolean {
      return validIdentity(identity) && removeKey(draftStorageKey(identity));
    },

    clearSavedRevision(identity: DraftIdentity, revision: string): "cleared" | "stale" | "missing" | "unavailable" {
      const result = this.load<unknown>(identity);
      if (result.status === "unavailable") return "unavailable";
      if (result.status !== "ready") return "missing";
      if (result.draft.revision !== revision) return "stale";
      return removeKey(draftStorageKey(identity)) ? "cleared" : "unavailable";
    },

    removeOwner(ownerId: string): { status: "complete" | "unavailable"; removed: number } {
      if (!validPart(ownerId)) return { status: "complete", removed: 0 };
      const keys = draftKeys(storage);
      if (!keys) return { status: "unavailable", removed: 0 };
      let removed = 0;
      let unavailable = false;
      for (const key of keys.filter((candidate) => storageOwner(candidate) === ownerId)) {
        if (removeKey(key)) removed += 1;
        else unavailable = true;
      }
      return { status: unavailable ? "unavailable" : "complete", removed };
    },

    reconcileOwner(ownerId: string | null): { status: "complete" | "unavailable"; removed: number } {
      if (ownerId !== null && !validPart(ownerId)) return { status: "complete", removed: 0 };
      activeOwner = ownerId;
      const keys = draftKeys(storage);
      if (!keys) return { status: "unavailable", removed: 0 };
      let removed = 0;
      let unavailable = false;
      for (const key of keys.filter((candidate) => ownerId === null || storageOwner(candidate) !== ownerId)) {
        if (removeKey(key)) removed += 1;
        else unavailable = true;
      }
      return { status: unavailable ? "unavailable" : "complete", removed };
    },

    sweepExpired(): { status: "complete" | "unavailable"; removed: number } {
      const currentTime = now();
      let removed = 0;
      let unavailable = false;
      const keys = draftKeys(storage);
      if (!keys) return { status: "unavailable", removed: 0 };
      for (const key of keys) {
        try {
          const raw = storage.getItem(key);
          if (raw === null) continue;
          const parsed = JSON.parse(raw) as Partial<DraftEnvelope<unknown>>;
          if (typeof parsed.expiresAtMs !== "number" || parsed.expiresAtMs <= currentTime) {
            if (removeKey(key)) removed += 1;
            else unavailable = true;
          }
        } catch {
          if (removeKey(key)) removed += 1;
          else unavailable = true;
        }
      }
      return { status: unavailable ? "unavailable" : "complete", removed };
    },
  };
}

export type DraftStore = ReturnType<typeof createDraftStore>;

export type DraftCodec<T> = { encode(value: T): unknown; decode(value: unknown): T };
export type DraftCaptureResult =
  | Extract<DraftSaveResult, { status: "saved" }>
  | { status: "error"; reason: Extract<DraftSaveResult, { status: "error" }>["reason"]; revision?: string }
  | { status: "unchanged"; revision: string };

export function createDraftSession<T>({ identity, codec, store, hydrationNonce }: {
  identity: DraftIdentity;
  codec: DraftCodec<T>;
  store: DraftStore;
  hydrationNonce: string;
}) {
  let counter = 0;
  let lastFingerprint: string | null = null;
  let latestRevision: string | null = null;
  let rememberedFileReselection = false;

  function encode(value: T): { encoded: unknown; fingerprint: string } | null {
    try {
      const encoded = codec.encode(value);
      return { encoded, fingerprint: JSON.stringify(encoded) };
    } catch { return null; }
  }

  function persist(value: T, force: boolean, fileReselectionRequired: boolean | undefined): DraftCaptureResult {
    const encoded = encode(value);
    if (!encoded) return { status: "error", reason: "invalid" };
    const effectiveFileReselection = fileReselectionRequired ?? rememberedFileReselection;
    const fingerprint = JSON.stringify([encoded.fingerprint, effectiveFileReselection]);
    if (!force && fingerprint === lastFingerprint) return { status: "unchanged", revision: latestRevision ?? "" };
    counter += 1;
    const revision = createDraftRevision(hydrationNonce, counter);
    const result = store.save(identity, revision, encoded.encoded, { fileReselectionRequired: effectiveFileReselection });
    if (result.status === "saved") {
      lastFingerprint = fingerprint;
      latestRevision = revision;
      rememberedFileReselection = effectiveFileReselection;
    } else return { ...result, revision };
    return result;
  }

  function prime(value: T, fileReselectionRequired = false): boolean {
    const encoded = encode(value);
    if (!encoded) return false;
    rememberedFileReselection = fileReselectionRequired;
    lastFingerprint = JSON.stringify([encoded.fingerprint, fileReselectionRequired]);
    return true;
  }

  return {
    load(): DraftLoadResult<unknown> { return store.load(identity); },
    prime,
    update(value: T, options: { fileReselectionRequired?: boolean } = {}): DraftCaptureResult {
      return persist(value, false, options.fileReselectionRequired);
    },
    capture(value: T, options: { fileReselectionRequired?: boolean } = {}): DraftCaptureResult {
      return persist(value, true, options.fileReselectionRequired);
    },
    complete(revision: string) { return store.clearSavedRevision(identity, revision); },
    remove() { return store.remove(identity); },
    restore(result: DraftLoadResult<unknown>, onRestore: (value: T) => void): { status: "restored" | "invalid" | "unavailable" } {
      if (result.status === "unavailable") return { status: "unavailable" };
      if (result.status !== "ready") return { status: "invalid" };
      try {
        const decoded = codec.decode(result.draft.value);
        onRestore(decoded);
        prime(decoded, result.draft.fileReselectionRequired);
        latestRevision = result.draft.revision;
        return { status: "restored" };
      } catch {
        store.remove(identity);
        return { status: "invalid" };
      }
    },
  };
}

export type DraftSession<T> = ReturnType<typeof createDraftSession<T>>;

let browserStore: DraftStore | undefined;

export function createLazyDraftStorage(resolve: () => DraftStorage): DraftStorage {
  return {
    get length() { return resolve().length; },
    key(index) { return resolve().key(index); },
    getItem(key) { return resolve().getItem(key); },
    setItem(key, value) { resolve().setItem(key, value); },
    removeItem(key) { resolve().removeItem(key); },
  };
}

export function browserDraftStore(): DraftStore {
  if (typeof window === "undefined") throw new Error("draft_storage_requires_browser");
  browserStore ??= createDraftStore(createLazyDraftStorage(() => window.sessionStorage));
  return browserStore;
}
