import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeSubmissionExceptionPages,
  parseSubmissionOperatorException,
  submissionExceptionCopy,
} from "./submission-exceptions.ts";

test("exception parser keeps only server-allowlisted next actions", () => {
  const item = parseSubmissionOperatorException({
    id: "exception-1",
    submissionId: "submission-1",
    type: "scan_blocked",
    status: "open",
    title: "청년 모임 자료",
    kind: "자료",
    sourceMode: "upload",
    scanStatus: "blocked",
    cleanupState: "not_required",
    createdAt: "2026-07-24T04:00:00.000Z",
    nextActions: ["request_revision", "delete_everything", "retry_scan"],
  });
  assert.deepEqual(item?.nextActions, ["request_revision", "retry_scan"]);
  assert.equal(item?.createdAtMs, Date.parse("2026-07-24T04:00:00.000Z"));
});

test("cursor pages merge without duplicates and retain older exceptions", () => {
  const current = [
    { id: "b", createdAtMs: 200 },
    { id: "a", createdAtMs: 100 },
  ];
  const next = [
    { id: "a", createdAtMs: 100 },
    { id: "c", createdAtMs: 50 },
  ];
  assert.deepEqual(
    mergeSubmissionExceptionPages(current, next).map((item) => item.id),
    ["b", "a", "c"],
  );
});

test("known and unknown exception types provide human-readable guidance", () => {
  assert.equal(submissionExceptionCopy("cleanup_dead_letter").label, "파일 회수 수동 조치 필요");
  assert.equal(submissionExceptionCopy("unexpected").label, "운영 확인 필요");
});
