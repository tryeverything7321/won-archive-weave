import assert from "node:assert/strict";
import test from "node:test";
import { ownedEventEditorRecord } from "./owned-event-model.ts";
import { managedEventEditorValue } from "./event-editor-model.ts";

const event = {
  id: "event-owner-1", title: "공개 제목", summary: "공개 소개", description: "",
  organizerName: "청년회", startAt: new Date("2026-10-31T05:00:00Z"),
  endAt: new Date("2026-10-31T07:00:00Z"), allDay: false, timeZone: "Asia/Seoul",
  region: "서울", locationName: "서울회관", visibility: "public",
  eventState: "confirmed", sourceType: "manual", origin: "published", gallery: [],
};

test("owner edit loads the private event fields and preserves existing uploads", () => {
  const mediaUploads = [{ role: "thumbnail", storagePath: "quarantined/owner/calendar-events/event-owner-1/poster.png", fileName: "poster.png", contentType: "image/png", alt: "행사 포스터" }];
  const record = ownedEventEditorRecord(event, {
    ownerUid: "owner", status: "published", title: "최근 수정 제목",
    registrationStatus: "not_required", visibility: "member_only",
    startAt: { toDate: () => new Date("2026-11-01T05:00:00Z") },
    endAt: { toDate: () => new Date("2026-11-01T07:00:00Z") },
    mediaUploads,
  });
  const editor = managedEventEditorValue(record);
  assert.equal(editor.title, "최근 수정 제목");
  assert.equal(editor.startAt, "2026-11-01T14:00");
  assert.equal(editor.registrationStatus, "not_required");
  assert.equal(editor.visibility, "member_only");
  assert.deepEqual(record.mediaUploads, mediaUploads);
});
