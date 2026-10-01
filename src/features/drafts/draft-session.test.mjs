import assert from "node:assert/strict";
import test from "node:test";
import { createDraftSession, createDraftStore } from "./draft-store.ts";

class MemoryStorage {
  #values = new Map();
  get length() { return this.#values.size; }
  key(index) { return [...this.#values.keys()][index] ?? null; }
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, value); }
  removeItem(key) { this.#values.delete(key); }
}

const identity = { ownerId: "member-1", kind: "contribution", documentId: "new" };
const codec = {
  encode(value) { return { title: value.title, body: value.body }; },
  decode(value) {
    if (!value || typeof value !== "object" || typeof value.title !== "string" || typeof value.body !== "string") throw new Error("invalid");
    return { title: value.title, body: value.body };
  },
};

test("synchronous update survives immediate navigation without a debounce window", () => {
  const store = createDraftStore(new MemoryStorage(), () => 1_000);
  const session = createDraftSession({ identity, codec, store, hydrationNonce: "mount-a" });
  const result = session.update({ title: "회의", body: "방금 입력" });
  assert.equal(result.status, "saved");
  assert.deepEqual(store.load(identity).status, "ready");
});

test("priming a missing form baseline does not create an empty recovery draft", () => {
  const store = createDraftStore(new MemoryStorage(), () => 1_000);
  const session = createDraftSession({ identity, codec, store, hydrationNonce: "mount-a" });
  session.prime({ title: "", body: "" });
  assert.equal(session.update({ title: "", body: "" }).status, "unchanged");
  assert.equal(store.load(identity).status, "missing");
});

test("capture and completion bind server success to the exact submitted revision", () => {
  const store = createDraftStore(new MemoryStorage(), () => 1_000);
  const session = createDraftSession({ identity, codec, store, hydrationNonce: "mount-a" });
  const captured = session.capture({ title: "회의", body: "제출 본문" });
  assert.equal(captured.status, "saved");
  session.update({ title: "회의", body: "제출 중 새로 수정" });
  assert.equal(session.complete(captured.revision), "stale");
  assert.equal(store.load(identity).status, "ready");
});

test("malformed recovered values never call restore or replace current input", () => {
  const store = createDraftStore(new MemoryStorage(), () => 1_000);
  store.save(identity, "stored", { unexpected: "shape" });
  const session = createDraftSession({ identity, codec, store, hydrationNonce: "mount-a" });
  let restored = false;
  assert.deepEqual(session.restore(store.load(identity), () => { restored = true; }), { status: "invalid" });
  assert.equal(restored, false);
});

test("failed synchronous saves return the attempted revision for an exact retry", () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); };
  const session = createDraftSession({ identity, codec, store: createDraftStore(storage, () => 1_000), hydrationNonce: "mount-a" });
  const result = session.update({ title: "회의", body: "보존할 입력" });
  assert.equal(result.status, "error");
  assert.match(result.revision ?? "", /^mount-a:1$/);
});

test("file reselection metadata participates in revisions and survives an unspecified restore update", () => {
  const store = createDraftStore(new MemoryStorage(), () => 1_000);
  const session = createDraftSession({ identity, codec, store, hydrationNonce: "mount-a" });
  const value = { title: "회의", body: "같은 본문" };
  session.prime(value, false);
  const selected = session.update(value, { fileReselectionRequired: true });
  assert.equal(selected.status, "saved");
  assert.equal(store.load(identity).draft?.fileReselectionRequired, true);
  assert.equal(session.update(value).status, "unchanged");
  assert.equal(store.load(identity).draft?.fileReselectionRequired, true);
  const cleared = session.update(value, { fileReselectionRequired: false });
  assert.equal(cleared.status, "saved");
  assert.equal(store.load(identity).draft?.fileReselectionRequired, false);
});

test("a failed discard reports unavailable and leaves the recoverable draft intact", () => {
  const storage = new MemoryStorage();
  const store = createDraftStore(storage, () => 1_000);
  const session = createDraftSession({ identity, codec, store, hydrationNonce: "mount-a" });
  assert.equal(session.capture({ title: "회의", body: "지우지 못한 초안" }).status, "saved");
  storage.removeItem = () => { throw new Error("denied"); };
  assert.equal(session.remove(), false);
  assert.equal(store.load(identity).status, "ready");
});
