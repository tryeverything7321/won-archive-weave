import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeFileSelection,
  redistributionForSourceSelection,
  sourceModeOptions,
  sourceSpecificFields,
} from "./contribution-source.ts";

test("file input is cleared after selection so the same file can be selected again", () => {
  const file = { name: "동일파일.pdf" };
  const input = { files: [file], value: "C:\\fakepath\\동일파일.pdf" };
  assert.equal(consumeFileSelection(input), file);
  assert.equal(input.value, "");
});

test("a new file contribution is downloadable while an edit preserves saved rights", () => {
  assert.equal(redistributionForSourceSelection(false, "upload", "view_only"), "download_allowed");
  assert.equal(redistributionForSourceSelection(true, "upload", "view_only"), "view_only");
  assert.equal(redistributionForSourceSelection(false, "text", "view_only"), "view_only");
});

test("source selector exposes text and the existing attachment paths", () => {
  assert.deepEqual(
    sourceModeOptions.map(({ value, label }) => ({ value, label })),
    [
      { value: "text", label: "글만 올리기" },
      { value: "upload", label: "파일" },
      { value: "google_drive_link", label: "Google" },
      { value: "instagram_url", label: "Instagram" },
    ],
  );
});

test("source payload keeps only the field relevant to the selected path", () => {
  const instagramAttachments = [{ url: "https://www.instagram.com/p/example/" }];

  assert.deepEqual(
    sourceSpecificFields("upload", "https://docs.google.com/document/d/example/edit", instagramAttachments),
    {},
  );
  assert.deepEqual(
    sourceSpecificFields("google_drive_link", " https://docs.google.com/document/d/example/edit ", instagramAttachments),
    { sourceLinkUrl: "https://docs.google.com/document/d/example/edit" },
  );
  assert.deepEqual(
    sourceSpecificFields("instagram_url", "https://docs.google.com/document/d/example/edit", instagramAttachments),
    { instagramAttachments },
  );
});
