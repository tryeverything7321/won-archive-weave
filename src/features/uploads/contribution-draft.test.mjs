import assert from "node:assert/strict";
import test from "node:test";
import { createDraftSession, createDraftStore } from "../drafts/draft-store.ts";
import {
  beginContributionSession,
  createContributionSession,
  restoreContributionCreation,
} from "./contribution-session.ts";
import {
  contributionDraftCodec,
  contributionDraftActive,
  contributionDraftIdentity,
  contributionDraftFileReselection,
  contributionSubmissionPayload,
  emptyContributionDraftValue,
  savedContributionDraftRevision,
} from "./contribution-draft.ts";

const complete = {
  sourceMode: "instagram_url",
  body: "# 회의록\n\n- 준비",
  sourceLinkUrl: "",
  instagramAttachments: [{ sourceUrl: "https://www.instagram.com/p/Abcde/", mediaType: "post", shortcode: "Abcde", originalAuthor: "weave.youth" }],
  title: "청년회 기록",
  source: "작성자 제공",
  owner: "서울 청년회",
  kind: "활동 기록",
  activityTopic: "마음공부",
  activityType: "정기 모임",
  activityDate: "2026-09-11",
  activityPlace: "서울",
  activitySummary: "요약",
  activityStory: "과정",
  activityOutcome: "결과",
  activityNextAction: "다음 모임",
  recipePurpose: "목적",
  recipePreparation: "준비",
  recipePromotion: "홍보",
  recipeLessons: "배움",
  visibility: "회원 전용",
  visibilityExplicit: true,
  consentConfirmed: true,
  attribution: "서울 청년회",
  consentBasis: "단체 담당자로 올려요",
  redistribution: "source_link_only",
  sensitiveDataReviewed: true,
};

class MemoryStorage {
  #values = new Map();
  get length() { return this.#values.size; }
  key(index) { return [...this.#values.keys()][index] ?? null; }
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, value); }
  removeItem(key) { this.#values.delete(key); }
}

test("contribution codec roundtrips every approved form field", () => {
  assert.deepEqual(contributionDraftCodec.decode(contributionDraftCodec.encode(complete)), complete);
});

test("contribution codec strips unknown secrets and rejects malformed allowlisted fields", () => {
  const encoded = contributionDraftCodec.encode({ ...complete, providerToken: "must-not-persist", file: new Uint8Array([1]) });
  assert.equal("providerToken" in encoded, false);
  assert.equal("file" in encoded, false);
  assert.throws(() => contributionDraftCodec.decode({ ...encoded, visibility: "everyone" }));
  assert.throws(() => contributionDraftCodec.decode({ ...encoded, instagramAttachments: [{ sourceUrl: "javascript:alert(1)" }] }));
});

test("partially typed source links remain recoverable while credential-bearing links are rejected", () => {
  assert.equal(
    contributionDraftCodec.encode({ ...complete, sourceLinkUrl: "https://docs.google." }).sourceLinkUrl,
    "https://docs.google.",
  );
  assert.throws(() => contributionDraftCodec.encode({ ...complete, sourceLinkUrl: "https://docs.google/?token=secret" }));
  assert.throws(() => contributionDraftCodec.encode({ ...complete, sourceLinkUrl: "https://user:pass@example.com/file" }));
  assert.throws(() => contributionDraftCodec.encode({ ...complete, sourceLinkUrl: "javascript:alert(1)" }));
});

test("draft identity stays account, entry-kind, and document scoped", () => {
  assert.deepEqual(contributionDraftIdentity("member-1", "활동 기록", ""), {
    ownerId: "member-1",
    kind: "contribution:활동 기록",
    documentId: "new",
  });
  assert.deepEqual(contributionDraftIdentity("member-1", "자료", "submission-1"), {
    ownerId: "member-1",
    kind: "contribution:자료",
    documentId: "submission-1",
  });
  assert.notDeepEqual(
    contributionDraftIdentity("member-1", "자료", ""),
    contributionDraftIdentity("member-2", "자료", ""),
  );
});

test("file inputs persist only upload reselection metadata", () => {
  assert.equal(contributionDraftFileReselection("upload", true), true);
  assert.equal(contributionDraftFileReselection("upload", false), undefined);
  assert.equal(contributionDraftFileReselection("text", true), false);
  assert.equal(contributionDraftFileReselection("google_drive_link", false), false);
});

test("only a successfully captured revision may be completed after submit", () => {
  assert.equal(savedContributionDraftRevision({ status: "saved", revision: "rev-1", savedAtMs: 1 }), "rev-1");
  assert.equal(savedContributionDraftRevision({ status: "error", reason: "quota", revision: "rev-2" }), undefined);
  assert.equal(savedContributionDraftRevision({ status: "unchanged", revision: "rev-3" }), undefined);
});

test("editing drafts do not hydrate until auth and the server baseline are ready", () => {
  assert.equal(contributionDraftActive(false, false, "ready"), false);
  assert.equal(contributionDraftActive(true, false, "ready"), true);
  assert.equal(contributionDraftActive(true, true, "loading"), false);
  assert.equal(contributionDraftActive(true, true, "error"), false);
  assert.equal(contributionDraftActive(true, true, "ready"), true);
});

test("new-writing reset has an explicit unsaved baseline", () => {
  const blank = emptyContributionDraftValue("새 작성자", "자료", "마음공부");
  assert.equal(blank.owner, "새 작성자");
  assert.equal(blank.kind, "자료");
  assert.equal(blank.activityTopic, "마음공부");
  assert.equal(blank.sourceMode, "text");
  assert.equal(blank.visibility, null);
  assert.equal(blank.visibilityExplicit, false);
  assert.deepEqual(contributionDraftCodec.encode(blank), blank);
});

test("legacy drafts with a former public default do not become an explicit audience choice", () => {
  const legacy = { ...complete };
  delete legacy.visibilityExplicit;
  const restored = contributionDraftCodec.decode(legacy);
  assert.equal(restored.visibility, "회원 전용");
  assert.equal(restored.visibilityExplicit, false);
});

test("a legacy in-flight create reservation retains its already-submitted first audience", () => {
  const legacyFirstValue = { ...complete };
  delete legacyFirstValue.visibilityExplicit;
  const restored = contributionDraftCodec.decode({
    ...complete,
    createReservation: {
      requestId: "create-request-legacy",
      inputFingerprint: "legacy-fingerprint",
      firstValue: legacyFirstValue,
    },
  });
  assert.equal(restored.createReservation?.firstValue.visibility, "회원 전용");
  assert.equal(restored.createReservation?.firstValue.visibilityExplicit, true);
  assert.equal(contributionSubmissionPayload(restored.createReservation?.firstValue).visibility, "회원 전용");
});

test("submission payload requires a current explicit audience choice", () => {
  assert.throws(
    () => contributionSubmissionPayload({ ...complete, visibility: null, visibilityExplicit: false }),
    /공개 범위를 선택/,
  );
  assert.throws(
    () => contributionSubmissionPayload({ ...complete, visibility: "공개", visibilityExplicit: false }),
    /공개 범위를 선택/,
  );
  assert.equal(contributionSubmissionPayload(complete).visibility, "회원 전용");
});

test("a lost create response can reload the same request id and exact first payload", () => {
  const firstValue = { ...complete, title: "최초 제출", source: "" };
  const persisted = contributionDraftCodec.encode({
    ...complete,
    title: "응답 대기 중 수정",
    createReservation: {
      requestId: "create-request-0911",
      inputFingerprint: "first-fingerprint",
      firstValue,
    },
  });
  const reloaded = contributionDraftCodec.decode(JSON.parse(JSON.stringify(persisted)));
  assert.equal(reloaded.createReservation?.requestId, "create-request-0911");
  assert.equal(reloaded.createReservation?.inputFingerprint, "first-fingerprint");
  assert.deepEqual(
    contributionSubmissionPayload(reloaded.createReservation?.firstValue),
    contributionSubmissionPayload(firstValue),
  );
  assert.equal("file" in (reloaded.createReservation?.firstValue ?? {}), false);
  assert.equal("providerToken" in (reloaded.createReservation?.firstValue ?? {}), false);
});

test("response loss plus reload retries one create with the persisted first payload", async () => {
  const identity = contributionDraftIdentity("member-1", "활동 기록", "");
  const store = createDraftStore(new MemoryStorage(), () => 1_000);
  const firstValue = { ...complete, title: "최초 제출" };
  const reservation = {
    requestId: "create-request-0911",
    inputFingerprint: "first-fingerprint",
    firstValue,
  };
  const beforeReload = createDraftSession({ identity, codec: contributionDraftCodec, store, hydrationNonce: "before" });
  assert.equal(beforeReload.capture({ ...complete, createReservation: reservation }).status, "saved");

  const afterReload = createDraftSession({ identity, codec: contributionDraftCodec, store, hydrationNonce: "after" });
  let restored;
  assert.deepEqual(afterReload.restore(afterReload.load(), (value) => { restored = value; }), { status: "restored" });
  const restoredReservation = restored.createReservation;
  assert.ok(restoredReservation);
  let contributionSession = restoreContributionCreation(createContributionSession(), restoredReservation);
  const serverCreates = new Map();
  const expectedPayload = contributionSubmissionPayload(firstValue);
  contributionSession = await beginContributionSession(contributionSession, async () => {
    const requestId = contributionSession.createReservation.requestId;
    serverCreates.set(requestId, expectedPayload);
    return "submission-1";
  });
  assert.equal(contributionSession.submissionId, "submission-1");
  assert.equal(serverCreates.size, 1);
  assert.deepEqual(serverCreates.get("create-request-0911"), expectedPayload);
});

test("new plain drafts retain layout and legacy drafts retain Markdown semantics", () => {
  const body = "\n  이름      역할\n  민규\t진행\n";
  const plain = { ...complete, bodyFormat: "plain", body };
  assert.deepEqual(contributionDraftCodec.decode(contributionDraftCodec.encode(plain)), plain);
  assert.equal(emptyContributionDraftValue("작성자", "자료", "마음공부").bodyFormat, "plain");
  assert.equal(contributionSubmissionPayload(plain).textContent.format, "plain");
  assert.equal(contributionSubmissionPayload(plain).textContent.body, body);
  assert.equal(contributionSubmissionPayload(complete).textContent.format, "markdown");
});
