import assert from "node:assert/strict";
import test from "node:test";

import { googleImportResultModel } from "./google-import-result.ts";

test("partial Google import keeps only failed events selected for retry", () => {
  assert.deepEqual(googleImportResultModel(["first", "second", "third"], {
    submitted: 1,
    duplicates: 1,
    failed: 1,
    status: "partial_failure",
    results: [
      { index: 0, status: "published" },
      { index: 1, status: "failed" },
      { index: 2, status: "duplicate" },
    ],
  }), {
    retryIds: ["second"],
    tone: "error",
    message: "1개의 일정을 올렸어요. 이미 올린 일정 1개는 제외했고, 실패한 일정 1개만 다시 선택해 두었어요.",
  });
});

test("complete Google import clears selection and malformed results fail closed", () => {
  assert.deepEqual(googleImportResultModel(["first"], {
    submitted: 1,
    duplicates: 0,
    failed: 0,
    status: "published",
    results: [{ index: 0, status: "published" }],
  }), {
    retryIds: [],
    tone: "done",
    message: "1개의 일정을 위브에 올렸어요.",
  });
  assert.throws(() => googleImportResultModel(["first"], {
    submitted: 0,
    duplicates: 0,
    failed: 1,
    status: "failed",
    results: [{ index: 2, status: "failed" }],
  }));
  assert.throws(() => googleImportResultModel(["first", "second"], {
    submitted: 1,
    duplicates: 0,
    failed: 1,
    status: "partial_failure",
    results: [{ index: 0, status: "published" }, { index: 0, status: "failed" }],
  }));
});
