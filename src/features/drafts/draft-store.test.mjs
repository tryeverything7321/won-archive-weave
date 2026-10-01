import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DRAFT_AGE_MS,
  MAX_DRAFT_SERIALIZED_BYTES,
  createLazyDraftStorage,
  createDraftStore,
  createDraftRevision,
  draftStorageKey,
} from "./draft-store.ts";

class MemoryStorage {
  #values = new Map();
  get length() { return this.#values.size; }
  key(index) { return [...this.#values.keys()][index] ?? null; }
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, value); }
  removeItem(key) { this.#values.delete(key); }
}

const identity = { ownerId: "member-1", kind: "contribution", documentId: "new-record" };

test("draft identity isolates owner, form kind, and document", () => {
  const storage = new MemoryStorage();
  const store = createDraftStore(storage, () => 1_000);
  assert.equal(store.save(identity, "revision-1", { title: "첫 기록" }).status, "saved");
  assert.equal(store.load(identity).status, "ready");
  assert.equal(store.load({ ...identity, ownerId: "member-2" }).status, "missing");
  assert.equal(store.load({ ...identity, kind: "community-post" }).status, "missing");
  assert.equal(store.load({ ...identity, documentId: "another" }).status, "missing");
});

test("drafts expire after at most 24 hours and are removed", () => {
  const storage = new MemoryStorage();
  let nowMs = 1_000;
  const store = createDraftStore(storage, () => nowMs);
  store.save(identity, "revision-1", { body: "기록" });
  nowMs += MAX_DRAFT_AGE_MS + 1;
  assert.deepEqual(store.load(identity), { status: "expired" });
  assert.equal(storage.getItem(draftStorageKey(identity)), null);
});

test("corrupt drafts are classified and removed instead of overwriting form defaults", () => {
  const storage = new MemoryStorage();
  storage.setItem(draftStorageKey(identity), "{not-json");
  const store = createDraftStore(storage, () => 1_000);
  assert.deepEqual(store.load(identity), { status: "corrupt" });
  assert.equal(storage.getItem(draftStorageKey(identity)), null);
});

test("storage quota and unavailable storage preserve retryable error reasons", () => {
  const quotaStorage = new MemoryStorage();
  quotaStorage.setItem = () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); };
  assert.deepEqual(
    createDraftStore(quotaStorage, () => 1_000).save(identity, "revision-1", { body: "기록" }),
    { status: "error", reason: "quota" },
  );

  const unavailableStorage = new MemoryStorage();
  unavailableStorage.getItem = () => { throw new Error("denied"); };
  assert.deepEqual(createDraftStore(unavailableStorage, () => 1_000).load(identity), { status: "unavailable" });
});

test("file bytes and non-plain values are rejected before storage", () => {
  const storage = new MemoryStorage();
  const store = createDraftStore(storage, () => 1_000);
  assert.deepEqual(store.save(identity, "revision-1", { file: new Uint8Array([1, 2, 3]) }), {
    status: "error",
    reason: "invalid",
  });
  assert.deepEqual(store.save(identity, "revision-2", { file: { arrayBuffer() {} } }), {
    status: "error",
    reason: "invalid",
  });
  assert.equal(storage.length, 0);
});

test("a late success clears only its exact persisted revision", () => {
  const storage = new MemoryStorage();
  const store = createDraftStore(storage, () => 1_000);
  store.save(identity, "revision-1", { body: "처음" });
  store.save(identity, "revision-2", { body: "나중" });
  assert.equal(store.clearSavedRevision(identity, "revision-1"), "stale");
  assert.equal(store.load(identity).status, "ready");
  assert.equal(store.clearSavedRevision(identity, "revision-2"), "cleared");
  assert.equal(store.load(identity).status, "missing");
});

test("logout or account change removes only the previous owner's drafts", () => {
  const storage = new MemoryStorage();
  const store = createDraftStore(storage, () => 1_000);
  store.save(identity, "revision-1", { body: "이전 계정" });
  const nextIdentity = { ...identity, ownerId: "member-2" };
  store.save(nextIdentity, "revision-1", { body: "현재 계정" });
  assert.deepEqual(store.removeOwner("member-1"), { status: "complete", removed: 1 });
  assert.equal(store.load(identity).status, "missing");
  assert.equal(store.load(nextIdentity).status, "ready");
});

test("owner reconciliation clears other accounts and fences stale mounted writers", () => {
  const storage = new MemoryStorage();
  const store = createDraftStore(storage, () => 1_000);
  store.save(identity, "revision-1", { body: "이전 계정" });
  const nextIdentity = { ...identity, ownerId: "member-2" };
  store.save(nextIdentity, "revision-1", { body: "현재 계정" });

  assert.deepEqual(store.reconcileOwner("member-2"), { status: "complete", removed: 1 });
  assert.deepEqual(store.save(identity, "late-revision", { body: "늦은 저장" }), {
    status: "error",
    reason: "owner_mismatch",
  });
  assert.equal(store.load(nextIdentity).status, "ready");
  assert.deepEqual(store.reconcileOwner(null), { status: "complete", removed: 1 });
  assert.equal(store.load(nextIdentity).status, "missing");
});

test("expired drafts can be swept without revisiting each form", () => {
  const storage = new MemoryStorage();
  let nowMs = 1_000;
  const store = createDraftStore(storage, () => nowMs);
  store.save(identity, "revision-1", { body: "오래된 기록" });
  store.save({ ...identity, documentId: "newer" }, "revision-2", { body: "새 기록" });
  nowMs += MAX_DRAFT_AGE_MS + 1;
  assert.deepEqual(store.sweepExpired(), { status: "complete", removed: 2 });
  assert.equal(storage.length, 0);
});

test("revision identity stays unique across discard and recreate ABA cycles", () => {
  assert.notEqual(createDraftRevision("hydration-a", 1), createDraftRevision("hydration-b", 1));
  assert.notEqual(createDraftRevision("hydration-a", 1), createDraftRevision("hydration-a", 2));
});

test("disabled storage enumeration is classified while the owner fence still advances", () => {
  const storage = new MemoryStorage();
  Object.defineProperty(storage, "length", { get() { throw new Error("denied"); } });
  const store = createDraftStore(storage, () => 1_000);
  assert.deepEqual(store.reconcileOwner("member-2"), { status: "unavailable", removed: 0 });
  assert.deepEqual(store.save(identity, "late", { body: "stale" }), { status: "error", reason: "owner_mismatch" });
  assert.deepEqual(store.sweepExpired(), { status: "unavailable", removed: 0 });
});

test("a denied browser storage getter becomes unavailable instead of crashing callers", () => {
  const lazy = createLazyDraftStorage(() => { throw new Error("blocked"); });
  const store = createDraftStore(lazy, () => 1_000);
  assert.deepEqual(store.load(identity), { status: "unavailable" });
  assert.deepEqual(store.save(identity, "revision-1", { body: "text" }), { status: "error", reason: "unavailable" });
  assert.deepEqual(store.reconcileOwner(null), { status: "unavailable", removed: 0 });
});

test("owner reconciliation reports individual deletion failures while retaining the stale-writer fence", () => {
  const storage = new MemoryStorage();
  const store = createDraftStore(storage, () => 1_000);
  assert.equal(store.save(identity, "revision-1", { body: "남아 있는 초안" }).status, "saved");
  storage.removeItem = () => { throw new Error("denied"); };
  assert.deepEqual(store.reconcileOwner(null), { status: "unavailable", removed: 0 });
  assert.notEqual(storage.getItem(draftStorageKey(identity)), null);
  assert.deepEqual(store.save(identity, "late", { body: "다시 쓰기" }), { status: "error", reason: "owner_mismatch" });
});

test("oversized tampered storage is rejected before it can become a draft", () => {
  const storage = new MemoryStorage();
  storage.setItem(draftStorageKey(identity), " ".repeat(MAX_DRAFT_SERIALIZED_BYTES + 1));
  const store = createDraftStore(storage, () => 1_000);
  assert.deepEqual(store.load(identity), { status: "corrupt" });
  assert.equal(storage.length, 0);
});
