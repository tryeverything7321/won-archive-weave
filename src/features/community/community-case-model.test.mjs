import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  appealStatusCopy,
  chunkCommunityOwnershipRequests,
  formatCommunityCaseDate,
} from "./community-case-model.ts";

test("ownership requests include comments after the first 50", () => {
  const comments = Array.from({ length: 121 }, (_, index) => `comment-${index + 1}`);
  const chunks = chunkCommunityOwnershipRequests(comments);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [50, 50, 21]);
  assert.equal(chunks[1][0], "comment-51");
  assert.equal(chunks[2][0], "comment-101");
});

test("ownership request chunks reject server-incompatible sizes", () => {
  assert.throws(() => chunkCommunityOwnershipRequests([1], 51), /between 1 and 50/);
  assert.throws(() => chunkCommunityOwnershipRequests([1], 0), /between 1 and 50/);
});

test("appeal history has Korean terminal copy and bounded dates", () => {
  assert.equal(appealStatusCopy.received, "접수됨");
  assert.equal(appealStatusCopy.accepted, "수용됨 · 글 복원");
  assert.equal(appealStatusCopy.rejected, "기각됨 · 기존 조치 유지");
  assert.equal(formatCommunityCaseDate(0), "");
  assert.match(formatCommunityCaseDate(Date.parse("2026-07-24T03:00:00.000Z")), /2026/);
});

test("community purpose filter exposes its accessible group name", async () => {
  const source = await readFile(resolve("src/features/community/CommunityExperience.tsx"), "utf8");
  assert.match(
    source,
    /className="community-purpose-filters"\s+aria-label="글의 성격 필터"\s+role="group"/,
  );
  assert.match(source, /<textarea[\s\S]*?aria-label="작성할 이야기"[\s\S]*?aria-describedby=/);
});
