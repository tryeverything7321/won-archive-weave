import assert from "node:assert/strict";
import test from "node:test";
import { callableWriteErrorMessage } from "./callable-write-error.ts";

test("shows actionable Korean validation feedback returned by a callable", () => {
  assert.equal(callableWriteErrorMessage({ code: "functions/invalid-argument", message: "행사 내용을 다시 확인해 주세요" }, "행사"), "행사 내용을 다시 확인해 주세요");
  assert.equal(callableWriteErrorMessage({ code: "functions/failed-precondition", message: "최신 이용약관과 커뮤니티 규칙에 동의해 주세요" }, "커뮤니티 글"), "최신 이용약관과 커뮤니티 규칙에 동의해 주세요");
});

test("does not leak internal errors and warns against duplicate retry", () => {
  assert.match(callableWriteErrorMessage({ code: "functions/internal", message: "database path /users/private" }, "행사"), /잠시 뒤/);
  assert.match(callableWriteErrorMessage({ code: "functions/unavailable" }, "자료·기록"), /등록됐는지 먼저 확인/);
  assert.match(callableWriteErrorMessage({ code: "functions/already-exists" }, "행사"), /이미 저장되었을 수/);
  assert.match(callableWriteErrorMessage({ code: "functions/unauthenticated" }, "커뮤니티 글"), /다시 로그인/);
});


test("storage failures explain retry without revealing account identity or object paths", () => {
  const message = "Firebase Storage: access denied quarantined/naver:private-identity/material-bundles/file.pptx";
  for (const code of ["storage/unauthorized", "storage/unauthenticated", "storage/retry-limit-exceeded", "storage/invalid-checksum", "storage/canceled", "storage/unknown"]) {
    const result = callableWriteErrorMessage({code, message}, "자료·기록");
    assert.doesNotMatch(result, /naver:|quarantined|private-identity|Firebase/);
    assert.match(result, /다시|재시도|잠시/);
  }
});
