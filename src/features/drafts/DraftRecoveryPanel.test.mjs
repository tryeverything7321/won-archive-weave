import assert from "node:assert/strict";
import test from "node:test";
import { draftPolicyCopy, requiresDraftDiscardConfirmation } from "./draft-ui.ts";

test("draft policy copy states the bounded tab storage and file reselection limits", () => {
  assert.match(draftPolicyCopy.storage, /현재 탭/);
  assert.match(draftPolicyCopy.storage, /24시간/);
  assert.match(draftPolicyCopy.files, /파일.*다시 선택/);
  assert.doesNotMatch(`${draftPolicyCopy.storage} ${draftPolicyCopy.files}`, /영구|계속 보관/);
  assert.match(draftPolicyCopy.storage, /로그아웃.*삭제/);
  assert.match(draftPolicyCopy.storage, /탭 복원.*다시 보일 수/);
});

test("both destructive recovery choices require confirmation", () => {
  assert.equal(requiresDraftDiscardConfirmation("start_new"), true);
  assert.equal(requiresDraftDiscardConfirmation("delete"), true);
  assert.equal(requiresDraftDiscardConfirmation("continue"), false);
});
