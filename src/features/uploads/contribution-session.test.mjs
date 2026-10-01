import assert from "node:assert/strict";
import test from "node:test";
import {
  beginContributionSession,
  contributionAttemptIsCurrent,
  contributionDraftFingerprint,
  contributionDraftMatches,
  contributionCreationNeedsDraftUpdate,
  contributionUploadSelectionFingerprint,
  contributionUploadDecision,
  contributionSuccessPath,
  contributionSuccessMessage,
  createContributionSession,
  markContributionPublished,
  reserveContributionCreation,
  restoreContributionCreation,
  reserveContributionUploads,
  resetContributionSession,
  retryContributionSession,
} from "./contribution-session.ts";

test("a retry after publication response loss reuses the existing submission id", async () => {
  let createCalls = 0;
  const first = await beginContributionSession(createContributionSession(), async () => {
    createCalls += 1;
    return "submission-123";
  });
  const retry = retryContributionSession(first);
  const second = await beginContributionSession(retry, async () => {
    createCalls += 1;
    return "duplicate-submission";
  });

  assert.equal(createCalls, 1);
  assert.deepEqual(first, { submissionId: "submission-123", phase: "submitting", draftFingerprint: "" });
  assert.deepEqual(retry, { submissionId: "submission-123", phase: "draft", draftFingerprint: "" });
  assert.deepEqual(second, { submissionId: "submission-123", phase: "submitting", draftFingerprint: "" });
});

test("a lost create response retrieves the same server draft with the reserved request id", async () => {
  let session = reserveContributionCreation(
    createContributionSession(),
    "initial-input",
    () => "create-request-1",
  );
  const serverDrafts = new Map();
  let firstResponse = true;
  const create = async () => {
    const requestId = session.createReservation.requestId;
    const submissionId = serverDrafts.get(requestId) ?? "submission-123";
    serverDrafts.set(requestId, submissionId);
    if (firstResponse) {
      firstResponse = false;
      throw new Error("response lost after commit");
    }
    return submissionId;
  };

  await assert.rejects(beginContributionSession(session, create), /response lost/);
  session = retryContributionSession(session);
  session = await beginContributionSession(session, create);

  assert.equal(serverDrafts.size, 1);
  assert.equal(session.submissionId, "submission-123");
  assert.equal(session.createReservation.requestId, "create-request-1");
});

test("a reloaded create reservation restores the original request identity", () => {
  const restored = restoreContributionCreation(createContributionSession(), {
    requestId: "create-request-1",
    inputFingerprint: "initial-input",
  });
  assert.deepEqual(restored.createReservation, {
    requestId: "create-request-1",
    inputFingerprint: "initial-input",
  });
  assert.equal(reserveContributionCreation(restored, "changed-input", () => "new-request").createReservation?.requestId, "create-request-1");
});

test("editing initial input after a lost create response recovers before updating the same draft", () => {
  const reserved = reserveContributionCreation(
    createContributionSession(),
    "initial-input",
    () => "create-request-1",
  );
  const retry = reserveContributionCreation(reserved, "changed-input", () => "create-request-2");
  assert.equal(retry.createReservation.requestId, "create-request-1");
  assert.equal(retry.createReservation.inputFingerprint, "initial-input");
  assert.equal(contributionCreationNeedsDraftUpdate(retry, "changed-input"), true);
  assert.equal(contributionCreationNeedsDraftUpdate(retry, "initial-input"), false);
});

test("published contributions link to their public content type", () => {
  const published = markContributionPublished(createContributionSession("한 글"));
  assert.deepEqual(published, { submissionId: "한 글", phase: "published", draftFingerprint: "" });
  assert.equal(contributionSuccessPath("자료", published), "/materials/%ED%95%9C%20%EA%B8%80");
  assert.equal(contributionSuccessPath("활동 기록", published), "/activities/%ED%95%9C%20%EA%B8%80");
  assert.equal(contributionSuccessPath("활동 레시피", published), "/activities/%ED%95%9C%20%EA%B8%80");
});

test("starting another contribution clears the published submission id", () => {
  const published = markContributionPublished(createContributionSession("submission-123"));
  assert.deepEqual(resetContributionSession(published), { submissionId: "", phase: "draft", draftFingerprint: "" });
});

test("a published upload says only its attachment is still being checked", () => {
  const message = contributionSuccessMessage("upload", "published");
  assert.equal(message, "내용을 올렸어요. 첨부 파일은 안전 확인이 끝난 뒤 열립니다.");
  assert.doesNotMatch(message, /기록.*검사.*끝난 뒤.*공개/);
});

test("a non-public response does not claim immediate publication", () => {
  assert.equal(
    contributionSuccessMessage("text", "review_queued"),
    "내용을 보관했어요. 내 게시물 관리에서 상태를 확인할 수 있어요.",
  );
});

test("an async result from the previous account cannot update the new session", () => {
  const oldAttempt = { revision: 4, uid: "member-a" };
  assert.equal(contributionAttemptIsCurrent(oldAttempt, 4, "member-a"), true);
  assert.equal(contributionAttemptIsCurrent(oldAttempt, 5, "member-a"), false);
  assert.equal(contributionAttemptIsCurrent(oldAttempt, 4, "member-b"), false);
  assert.equal(contributionAttemptIsCurrent(oldAttempt, 5, undefined), false);
});

test("a lost upload acknowledgement reuses the reserved request id", () => {
  let ids = 0;
  const selection = contributionUploadSelectionFingerprint([
    { name: "poster.png", size: 2048, contentType: "image/png", sha256: "a".repeat(64) },
  ]);
  const first = reserveContributionUploads(createContributionSession("submission-123"), selection, () => `request-${++ids}`);
  const retry = reserveContributionUploads(retryContributionSession(first), selection, () => `request-${++ids}`);

  assert.equal(first.uploadReservation?.requestId, "request-1");
  assert.equal(retry.uploadReservation?.requestId, "request-1");
  assert.equal(ids, 1);
});

test("server reconciliation skips transfer after the client lost the upload acknowledgement", () => {
  const clientCompletedFiles = new Set();
  const serverObjects = new Set(["uabc--poster.png"]);
  const complete = serverObjects.has("uabc--poster.png");

  assert.equal(clientCompletedFiles.size, 0);
  assert.equal(contributionUploadDecision({ complete }), "skip");
  assert.equal(contributionUploadDecision({ complete: false }), "upload");
});

test("a changed file selection reserves a new request id", () => {
  let ids = 0;
  const original = contributionUploadSelectionFingerprint([
    { name: "poster.png", size: 2048, contentType: "image/png", sha256: "a".repeat(64) },
  ]);
  const changed = contributionUploadSelectionFingerprint([
    { name: "poster.png", size: 2048, contentType: "image/png", sha256: "b".repeat(64) },
  ]);
  const first = reserveContributionUploads(createContributionSession("submission-123"), original, () => `request-${++ids}`);
  const replacement = reserveContributionUploads(first, changed, () => `request-${++ids}`);

  assert.equal(replacement.uploadReservation?.requestId, "request-2");
  assert.equal(replacement.uploadReservation?.selectionFingerprint, changed);
});

test("the draft fingerprint includes the selected file content hash", () => {
  assert.notEqual(
    contributionDraftFingerprint("draft-v1", "file-a"),
    contributionDraftFingerprint("draft-v1", "file-b"),
  );
});

test("draft matching detects edits before reconciling an already-published retry", () => {
  const session = createContributionSession("submission-123", "draft-v1");
  assert.equal(contributionDraftMatches(session, "draft-v1"), true);
  assert.equal(contributionDraftMatches(session, "draft-v2"), false);
});
