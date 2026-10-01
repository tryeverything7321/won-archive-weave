import assert from "node:assert/strict";
import test from "node:test";
import {
  canOwnerOpenPrivateAttachment,
  mergeOwnedSubmissionPages,
  moderationNoticeCopy,
  parseOwnedSubmission,
  parseEditableSubmissionDraft,
  submissionAttachmentNotice,
  submissionLifecycleCopy,
  submissionManagementPresentation,
  submissionPreviewNotice,
} from "./submission-model.ts";

test("only clean private upload submissions expose owner attachment access", () => {
  const cleanPrivate = {
    status: "review_queued",
    visibility: "보류",
    sourceMode: "upload",
    scanStatus: "clean",
    attachmentStatus: "clean",
  };
  assert.equal(canOwnerOpenPrivateAttachment(cleanPrivate), true);
  for (const changed of [
    { status: "withdrawn" },
    { visibility: "공개" },
    { sourceMode: "text" },
    { scanStatus: "blocked" },
    { scanStatus: "error" },
    { attachmentStatus: "blocked" },
    { attachmentStatus: "error" },
  ]) assert.equal(canOwnerOpenPrivateAttachment({ ...cleanPrivate, ...changed }), false);
});

test("editable drafts preserve optional body and legacy attachment identity", () => {
  const base = { id: "draft", status: "draft", kind: "자료", sourceMode: "upload", visibility: "회원 전용", existingFileCount: 1 };
  const textContent = { schemaVersion: 1, format: "markdown", body: "회의록\n\n- 준비" };
  const draft = parseEditableSubmissionDraft({ ...base, textContent });
  assert.deepEqual(draft.textContent, textContent);
  assert.equal(draft.existingFileCount, 1);
  assert.equal(parseEditableSubmissionDraft(base).textContent, undefined);
  assert.throws(() => parseEditableSubmissionDraft({ ...base, textContent: { format: "html", body: "내용" } }));
});

test("editable drafts preserve the legacy activity recipe kind", () => {
  const draft = parseEditableSubmissionDraft({
    id: "legacy-recipe",
    status: "draft",
    kind: "활동 레시피",
    sourceMode: "upload",
    visibility: "공개",
    existingFileCount: 1,
  });
  assert.equal(draft.kind, "활동 레시피");
});

test("owner submission cursor pages merge without duplicates", () => {
  const current = [
    { id: "submission-b", updatedAtMs: 200 },
    { id: "submission-a", updatedAtMs: 100 },
  ];
  const next = [
    { id: "submission-a", updatedAtMs: 300 },
    { id: "submission-c", updatedAtMs: 50 },
  ];

  assert.deepEqual(
    mergeOwnedSubmissionPages(current, next).map((submission) => submission.id),
    ["submission-a", "submission-b", "submission-c"],
  );
});

test("owner submission exposes only a validated bounded moderation notice", () => {
  const submission = parseOwnedSubmission({
    id: "submission-a",
    title: "청년회 자료",
    status: "published",
    moderationNotice: {
      action: "request_correction",
      reason: "  연락처가 보이지 않도록 가려 주세요.  ",
      createdAtMs: 1_788_687_000_000,
      actorUid: "must-not-reach-the-client-model",
    },
  });

  assert.deepEqual(submission?.moderationNotice, {
    action: "request_correction",
    reason: "연락처가 보이지 않도록 가려 주세요.",
    createdAtMs: 1_788_687_000_000,
  });
});

test("owner submission drops malformed or unbounded moderation notices", () => {
  const base = { id: "submission-a", title: "청년회 자료", status: "published" };
  const invalidNotices = [
    { action: "delete", reason: "안내", createdAtMs: 1_788_687_000_000 },
    { action: "warn", reason: " ", createdAtMs: 1_788_687_000_000 },
    { action: "warn", reason: "가".repeat(501), createdAtMs: 1_788_687_000_000 },
    { action: "warn", reason: "안내", createdAtMs: Number.NaN },
  ];

  invalidNotices.forEach((moderationNotice) => {
    assert.equal(parseOwnedSubmission({ ...base, moderationNotice })?.moderationNotice, undefined);
  });
});

test("correction request copy does not claim that public content was unpublished", () => {
  assert.equal(moderationNoticeCopy.request_correction.label, "수정 요청");
  assert.doesNotMatch(moderationNoticeCopy.request_correction.description, /공개 (중단|제한|보류)|비공개/);
});

test("text-only and withdrawn records never show file scan notices", () => {
  assert.equal(submissionAttachmentNotice({ status: "published", sourceMode: "text", attachmentStatus: "pending" }), null);
  assert.equal(submissionAttachmentNotice({ status: "published", sourceMode: "google_drive_link", scanStatus: "not_applicable" }), null);
  assert.equal(submissionAttachmentNotice({ status: "withdrawn", sourceMode: "upload", attachmentStatus: "pending" }), null);
  assert.match(
    submissionAttachmentNotice({ status: "published", sourceMode: "upload", attachmentStatus: "pending" })?.text ?? "",
    /첨부 파일을 확인/,
  );
});

test("attachment and preview notices follow active publication status, not stale file fields", () => {
  const active = ["review_queued", "publishing", "publishing_failed", "exception_queued", "published", "change_pending"];
  const inactive = ["draft", "revision_requested", "held", "rejected", "unpublished", "withdrawn"];

  for (const status of active) {
    assert.equal(submissionAttachmentNotice({ status, sourceMode: "upload", attachmentStatus: "pending" })?.label, "검사 중", status);
    assert.equal(submissionPreviewNotice({ status, sourceMode: "upload", attachmentStatus: "clean", previewStatus: "ready" })?.label, "미리보기 준비됨", status);
  }
  for (const status of inactive) {
    assert.equal(submissionAttachmentNotice({ status, sourceMode: "upload", attachmentStatus: "pending" }), null, status);
    assert.equal(submissionPreviewNotice({ status, sourceMode: "upload", attachmentStatus: "clean", previewStatus: "ready" }), null, status);
  }
});

test("private and published upload failures remain visible while unpublished stale errors do not", () => {
  for (const status of ["review_queued", "published"]) {
    const presentation = submissionManagementPresentation({
      status,
      visibility: status === "review_queued" ? "보류" : "공개",
      sourceMode: "upload",
      attachmentStatus: "error",
      scanStatus: "error",
    });
    assert.equal(presentation.attachment?.label, "서비스 처리 오류", status);
    assert.equal(presentation.attachment?.refresh, true, status);
  }
  assert.equal(submissionAttachmentNotice({ status: "unpublished", sourceMode: "upload", attachmentStatus: "error" }), null);
});

test("service errors offer state refresh while blocked attachments never imply a retry can open them", () => {
  const failure = submissionAttachmentNotice({ status: "published", sourceMode: "upload", attachmentStatus: "error" });
  assert.equal(failure?.label, "서비스 처리 오류");
  assert.equal(failure?.refresh, true);
  assert.match(failure?.text ?? "", /자동으로 다시 시도/);
  assert.match(failure?.text ?? "", /검사를 시작하지 않/);
  const blocked = submissionAttachmentNotice({ status: "published", sourceMode: "upload", attachmentStatus: "blocked" });
  assert.equal(blocked?.label, "안전 검사 차단");
  assert.equal(blocked?.refresh, false);
  assert.match(blocked?.text ?? "", /열거나 내려받을 수 없/);
});

test("preview conversion is independent from publication and original download rights", () => {
  const failed = submissionPreviewNotice({ status: "published", sourceMode: "upload", attachmentStatus: "clean", previewStatus: "failed" });
  assert.equal(failed?.label, "변환 실패");
  assert.match(failed?.text ?? "", /원본 다운로드는 계속/);
  assert.equal(submissionPreviewNotice({ status: "withdrawn", sourceMode: "upload", attachmentStatus: "clean", previewStatus: "ready" }), null);
  assert.equal(submissionPreviewNotice({ status: "published", sourceMode: "upload", attachmentStatus: "blocked", previewStatus: "ready" }), null);
});

test("private text lifecycle copy describes private storage without implying file review", () => {
  for (const sourceMode of ["text", "google_drive_link", "instagram_url"]) {
    const presentation = submissionManagementPresentation({
      status: "review_queued",
      sourceMode,
      visibility: "보류",
      attachmentStatus: "pending",
    });
    assert.equal(presentation.lifecycle.label, "나만 보관");
    assert.doesNotMatch(presentation.lifecycle.description, /파일|사진|검사|확인 중/);
    assert.equal(presentation.attachment, null);
  }

  assert.equal(submissionLifecycleCopy({ status: "review_queued", sourceMode: "upload", visibility: "보류" }).label, "나만 보관");
  assert.equal(submissionLifecycleCopy({ status: "withdrawn", sourceMode: "text", visibility: "보류" }).label, "철회");
});

test("withdrawn owner records expose only private draft restoration", () => {
  const record = parseOwnedSubmission({
    id: "withdrawn-1",
    title: "철회한 글",
    kind: "활동 기록",
    status: "withdrawn",
    visibility: "보류",
    sourceMode: "text",
    availableActions: ["restore_private", "edit", "delete"],
  });
  assert.deepEqual(record?.availableActions, ["restore_private"]);
});
