import assert from "node:assert/strict";
import test from "node:test";
import { safeOAuthReturnTo } from "./return-to.ts";

test("keeps an internal path with its query and hash", () => {
  assert.equal(
    safeOAuthReturnTo("/contribute?kind=activity#files"),
    "/contribute?kind=activity#files",
  );
});

test("rejects external and protocol-relative destinations", () => {
  assert.equal(safeOAuthReturnTo("https://example.com/steal"), "/community");
  assert.equal(safeOAuthReturnTo("//example.com/steal"), "/community");
  assert.equal(safeOAuthReturnTo("javascript:alert(1)"), "/community");
});

test("rejects authentication callback loops", () => {
  assert.equal(safeOAuthReturnTo("/auth/complete?code=again"), "/community");
  assert.equal(safeOAuthReturnTo("/oauth/kakao/start"), "/community");
});

test("uses the caller fallback for missing and unsafe values", () => {
  assert.equal(safeOAuthReturnTo(undefined, "/profile"), "/profile");
  assert.equal(safeOAuthReturnTo("  ", "/profile"), "/profile");
});
