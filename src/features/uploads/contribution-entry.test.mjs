import assert from "node:assert/strict";
import test from "node:test";
import {
  contributionReturnTo,
  contributionKindOptions,
  newContributionKinds,
  readContributionEntry,
} from "./contribution-entry.ts";

test("new contributions offer only activity records and reusable materials", () => {
  assert.deepEqual(newContributionKinds(), ["활동 기록", "자료"]);
  assert.deepEqual(contributionKindOptions("", "활동 기록"), ["활동 기록", "자료"]);
});

test("an existing legacy recipe keeps its saved kind as the only edit option", () => {
  assert.deepEqual(contributionKindOptions("submission-123", "활동 레시피"), ["활동 레시피"]);
});

test("menu entry intent selects the matching new contribution kind", () => {
  assert.deepEqual(readContributionEntry("?intent=activity"), {
    submissionId: "",
    initialKind: "활동 기록",
  });
  assert.deepEqual(readContributionEntry("?intent=material"), {
    submissionId: "",
    initialKind: "자료",
  });
});

test("missing or unknown entry intent safely defaults to an activity record", () => {
  assert.equal(readContributionEntry("").initialKind, "활동 기록");
  assert.equal(readContributionEntry("?intent=recipe").initialKind, "활동 기록");
  assert.equal(readContributionEntry("?intent=material%00").initialKind, "활동 기록");
});

test("an owned edit ignores menu entry intent until its saved draft is loaded", () => {
  assert.deepEqual(
    readContributionEntry("?submissionId=submission-123&intent=material"),
    { submissionId: "submission-123", initialKind: "활동 기록" },
  );
});

test("OAuth return keeps valid contribution context on the internal route", () => {
  assert.equal(
    contributionReturnTo("?submissionId=submission-123&intent=material", "#rights"),
    "/contribute?submissionId=submission-123&intent=material#rights",
  );
  assert.equal(
    contributionReturnTo("?intent=https://example.com&next=https://example.com", "#bad/path"),
    "/contribute",
  );
});
