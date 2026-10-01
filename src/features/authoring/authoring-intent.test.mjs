import assert from "node:assert/strict";
import test from "node:test";
import { contributionIntentHref } from "./authoring-intent.ts";

test("activity and material choices open separate contribution intents at the first input", () => {
  assert.equal(
    contributionIntentHref("활동 기록"),
    "/contribute?intent=activity#contribution-first-input",
  );
  assert.equal(
    contributionIntentHref("자료"),
    "/contribute?intent=material#contribution-first-input",
  );
});
