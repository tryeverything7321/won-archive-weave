import assert from "node:assert/strict";
import test from "node:test";
import { draftOwnerTransition, draftUiReducer, initialDraftUiState } from "./draft-state.ts";

test("mount hydration completes before edits can enter saving state", () => {
  assert.equal(draftUiReducer(initialDraftUiState, { type: "edit", revision: "r1" }).phase, "hydrating");
  const ready = draftUiReducer(initialDraftUiState, { type: "hydrated", result: { status: "missing" } });
  assert.equal(draftUiReducer(ready, { type: "edit", revision: "r1" }).phase, "editing");
});

test("late save acknowledgements cannot replace the latest revision state", () => {
  let state = draftUiReducer(initialDraftUiState, { type: "hydrated", result: { status: "missing" } });
  state = draftUiReducer(state, { type: "saving", revision: "r1" });
  state = draftUiReducer(state, { type: "edit", revision: "r2" });
  state = draftUiReducer(state, { type: "saved", revision: "r1", savedAtMs: 1_000 });
  assert.deepEqual(state, { phase: "editing", revision: "r2" });
});

test("quota and unavailable errors remain retryable without discarding the revision", () => {
  let state = draftUiReducer(initialDraftUiState, { type: "hydrated", result: { status: "missing" } });
  state = draftUiReducer(state, { type: "saving", revision: "r1" });
  state = draftUiReducer(state, { type: "failed", revision: "r1", reason: "quota" });
  assert.deepEqual(state, { phase: "error", revision: "r1", reason: "quota" });
  assert.deepEqual(draftUiReducer(state, { type: "retry" }), { phase: "editing", revision: "r1" });
});

test("initial unresolved auth does not purge drafts before auth settles", () => {
  assert.equal(draftOwnerTransition("member-1", null, false), undefined);
  assert.equal(draftOwnerTransition("member-1", null, true), null);
  assert.equal(draftOwnerTransition("member-1", "member-2", true), "member-2");
});

test("unavailable hydration is visible and retryable", () => {
  const unavailable = draftUiReducer(initialDraftUiState, { type: "hydrated", result: { status: "unavailable" } });
  assert.deepEqual(unavailable, { phase: "error", reason: "unavailable" });
  assert.deepEqual(draftUiReducer(unavailable, { type: "retry" }), { phase: "hydrating" });
});
