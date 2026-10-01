import assert from "node:assert/strict";
import test from "node:test";
import {
  bundleSelectionError,
  maximumBundleBytes,
  parseMaterialBundle,
  reorderBundleFiles,
  suggestedBundleTitle,
} from "./bundle-model.ts";

const file = (name, size = 1024, type = "application/vnd.openxmlformats-officedocument.presentationml.presentation") => ({ name, size, type });

test("one file proposes its filename and multiple files need one shared title", () => {
  assert.equal(suggestedBundleTitle([file("1단 발표.pptx")]), "1단 발표");
  assert.equal(suggestedBundleTitle([file("1단 발표.pptx"), file("2단 발표.pptx")]), "1단 발표 외 1개");
});

test("bundle selection enforces count, per-file and aggregate limits", () => {
  assert.equal(bundleSelectionError([], Array.from({ length: 11 }, (_, index) => file(`${index}.pptx`))), "한 묶음에는 파일을 10개까지 올릴 수 있어요.");
  assert.equal(bundleSelectionError([], [file("large.pptx", 20 * 1024 * 1024 + 1)]), "파일은 20MB 이하로 올려 주세요.");
  assert.equal(bundleSelectionError([], Array.from({ length: 6 }, (_, index) => file(`${index}.pptx`, 17 * 1024 * 1024))), "한 묶음의 파일은 모두 합해 100MB 이하로 올려 주세요.");
  assert.equal(bundleSelectionError([], [file("ok.pptx", maximumBundleBytes / 5)]), null);
});

test("reorder changes only order and safe parser keeps file-level state", () => {
  assert.deepEqual(reorderBundleFiles([{ id: "a", order: 0 }, { id: "b", order: 1 }], 1, 0), [{ id: "b", order: 0 }, { id: "a", order: 1 }]);
  const parsed = parseMaterialBundle({
    bundleId: "bundle-1", title: "단별 발표", visibility: "public", rights: {
      source: "서울 청년회", owner: "서울 청년회", attribution: "서울 청년회 제공", redistribution: "download_allowed",
      consentBasis: "권리자 동의", sensitiveDataReviewed: true, retention: "managed", reviewDueAtMs: Date.now() + 1000,
    }, status: "active",
    files: [{ fileId: "file-1", revision: 2, originalName: "1.pptx", displayName: "1단", order: 0, sizeBytes: 20, contentType: "application/pptx", status: "ready", scanStatus: "clean" }],
  });
  assert.equal(parsed.files[0].revision, 2);
  assert.equal(parsed.files[0].status, "ready");
  assert.equal(parsed.visibility, "공개");
  assert.equal(parsed.rightsRecord.source, "서울 청년회");
  assert.equal(parsed.sourceLabel, "서울 청년회");
});
