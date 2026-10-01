import assert from "node:assert/strict";
import test from "node:test";
import { createDraftSession, createDraftStore } from "../drafts/draft-store.ts";

let communityDraft = {};
try {
  communityDraft = await import("./community-draft.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

class MemoryStorage {
  #values = new Map();
  get length() { return this.#values.size; }
  key(index) { return [...this.#values.keys()][index] ?? null; }
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, value); }
  removeItem(key) { this.#values.delete(key); }
}

test("community draft identities partition article, reply, post edit, comment edit, account and document", () => {
  assert.equal(typeof communityDraft.communityDraftIdentity, "function");
  const identities = [
    communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "article" }),
    communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "reply", postId: "post-1" }),
    communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "post-edit", postId: "post-1" }),
    communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "comment-edit", postId: "post-1", commentId: "comment-1" }),
    communityDraft.communityDraftIdentity({ ownerId: "member-b", mode: "reply", postId: "post-1" }),
    communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "comment-edit", postId: "post-1", commentId: "comment-2" }),
  ];
  assert.deepEqual(identities.slice(0, 4), [
    { ownerId: "member-a", kind: "community-article", documentId: "new" },
    { ownerId: "member-a", kind: "community-reply", documentId: "post-1" },
    { ownerId: "member-a", kind: "community-post-edit", documentId: "post-1" },
    { ownerId: "member-a", kind: "community-comment-edit", documentId: "post-1:comment-1" },
  ]);
  assert.equal(new Set(identities.map((identity) => JSON.stringify(identity))).size, identities.length);
  assert.throws(() => communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "reply" }), /draft identity/);
});

test("community codecs allowlist only the approved article and reply fields", () => {
  assert.equal(typeof communityDraft.communityArticleDraftCodec?.encode, "function");
  assert.equal(typeof communityDraft.communityReplyDraftCodec?.encode, "function");

  assert.deepEqual(communityDraft.communityArticleDraftCodec.encode({
    purpose: "질문",
    topic: "배움과 신앙",
    body: "제가 직접 적은 본문",
    providerToken: "must-not-persist",
  }), {
    purpose: "질문",
    topic: "배움과 신앙",
    body: "제가 직접 적은 본문",
  });
  assert.deepEqual(communityDraft.communityArticleDraftCodec.decode({
    purpose: "질문",
    topic: "",
    body: "작성 중",
    unknown: "discard",
  }), { purpose: "질문", topic: "", body: "작성 중" });
  assert.deepEqual(communityDraft.communityReplyDraftCodec.encode({
    body: "답글 초안",
    commentId: "must-not-persist",
  }), { body: "답글 초안" });
  assert.throws(() => communityDraft.communityArticleDraftCodec.decode({ purpose: "unknown", topic: "", body: "본문" }), /draft value/);
  assert.throws(() => communityDraft.communityReplyDraftCodec.decode({ body: 123 }), /draft value/);
});

test("all four community draft modes use exact revisions so late success preserves newer edits", () => {
  assert.equal(typeof communityDraft.communityDraftIdentity, "function");
  const store = createDraftStore(new MemoryStorage(), () => 1_000);
  const cases = [
    { identity: communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "article" }), codec: communityDraft.communityArticleDraftCodec, first: { purpose: "질문", topic: "", body: "처음 글" }, next: { purpose: "질문", topic: "", body: "나중 글" } },
    { identity: communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "reply", postId: "post-1" }), codec: communityDraft.communityReplyDraftCodec, first: { body: "처음 답글" }, next: { body: "나중 답글" } },
    { identity: communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "post-edit", postId: "post-1" }), codec: communityDraft.communityArticleDraftCodec, first: { purpose: "질문", topic: "", body: "처음 수정" }, next: { purpose: "질문", topic: "", body: "나중 수정" } },
    { identity: communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "comment-edit", postId: "post-1", commentId: "comment-1" }), codec: communityDraft.communityReplyDraftCodec, first: { body: "처음 댓글 수정" }, next: { body: "나중 댓글 수정" } },
  ];

  for (const [index, fixture] of cases.entries()) {
    const session = createDraftSession({ ...fixture, store, hydrationNonce: `community-${index}` });
    const submitted = session.capture(fixture.first);
    assert.equal(submitted.status, "saved");
    assert.equal(session.update(fixture.next).status, "saved");
    assert.equal(session.complete(submitted.revision), "stale");
    const loaded = store.load(fixture.identity);
    assert.equal(loaded.status, "ready");
    assert.deepEqual(loaded.draft.value, fixture.codec.encode(fixture.next));
  }
});

test("only a successful exact capture produces a server submission revision", () => {
  assert.equal(typeof communityDraft.capturedCommunityDraftRevision, "function");
  assert.equal(communityDraft.capturedCommunityDraftRevision({ status: "saved", revision: "r1", savedAtMs: 1 }), "r1");
  assert.equal(communityDraft.capturedCommunityDraftRevision({ status: "unchanged", revision: "r2" }), "r2");
  assert.equal(communityDraft.capturedCommunityDraftRevision({ status: "error", reason: "quota", revision: "r3" }), null);
  assert.equal(communityDraft.capturedCommunityDraftRevision(undefined), null);
});

test("late completion is fenced by owner, kind, document and edit generation", () => {
  assert.equal(typeof communityDraft.communityDraftAttemptIsCurrent, "function");
  const submitted = {
    identity: communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "comment-edit", postId: "post-1", commentId: "comment-1" }),
    generation: 3,
  };
  assert.equal(communityDraft.communityDraftAttemptIsCurrent(submitted, submitted), true);
  assert.equal(communityDraft.communityDraftAttemptIsCurrent(submitted, {
    ...submitted,
    identity: communityDraft.communityDraftIdentity({ ownerId: "member-b", mode: "comment-edit", postId: "post-1", commentId: "comment-1" }),
  }), false);
  assert.equal(communityDraft.communityDraftAttemptIsCurrent(submitted, {
    ...submitted,
    identity: communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "comment-edit", postId: "post-1", commentId: "comment-2" }),
  }), false);
  assert.equal(communityDraft.communityDraftAttemptIsCurrent(submitted, {
    ...submitted,
    identity: communityDraft.communityDraftIdentity({ ownerId: "member-a", mode: "reply", postId: "post-1" }),
  }), false);
  assert.equal(communityDraft.communityDraftAttemptIsCurrent(submitted, { ...submitted, generation: 4 }), false);
  assert.equal(communityDraft.communityDraftAttemptIsCurrent(submitted, null), false);
  assert.equal(communityDraft.communityDraftAttemptIsCurrent(submitted, {
    ...submitted,
    generation: 5,
  }), false, "an A to B to A transition must still invalidate the old operation");
});

test("local capture failure warns but never blocks the primary server submission", () => {
  assert.equal(typeof communityDraft.communityDraftSubmissionCapture, "function");
  assert.deepEqual(
    communityDraft.communityDraftSubmissionCapture({ status: "saved", revision: "r1", savedAtMs: 1 }),
    { revision: "r1", localSaveUnavailable: false },
  );
  assert.deepEqual(
    communityDraft.communityDraftSubmissionCapture({ status: "error", reason: "quota", revision: "r2" }),
    { revision: null, localSaveUnavailable: true },
  );
  assert.deepEqual(
    communityDraft.communityDraftSubmissionCapture(undefined),
    { revision: null, localSaveUnavailable: true },
  );
});
