import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyEventEditorValue,
  eventEditorDateInputValue,
  eventEditorSetAllDayDate,
  eventEditorSubmissionFields,
  eventEditorToggleAllDay,
  eventEditorVisibilityIsReady,
  managedEventActions,
  managedEventEditorValue,
  validateEventEditorValue,
} from "./event-editor-model.ts";

function validValue(overrides = {}) {
  return {
    ...emptyEventEditorValue(new Date("2026-09-05T00:00:00.000Z")),
    title: "청년 마음공부 모임",
    organizerName: "서울교구 청년회",
    region: "서울",
    locationName: "서울회관",
    ...overrides,
  };
}

test("a concise event does not require a summary or long description", () => {
  assert.equal(validateEventEditorValue(validValue({ summary: "", description: "" })), null);
  assert.deepEqual(emptyEventEditorValue().instagramPosts, []);
  assert.equal(emptyEventEditorValue().registrationStatus, "not_required");
});

test("an event needs either a physical place or an online link", () => {
  assert.equal(validateEventEditorValue(validValue({ locationName: "", onlineUrl: "https://meet.example.org/youth" })), null);
  assert.match(validateEventEditorValue(validValue({ locationName: "", onlineUrl: "" })), /장소/);
});

test("new events require an explicit visibility choice while existing edits retain theirs", () => {
  assert.equal(eventEditorVisibilityIsReady(false, false), false);
  assert.equal(eventEditorVisibilityIsReady(false, true), true);
  assert.equal(eventEditorVisibilityIsReady(true, false), true);
});

test("all-day input uses inclusive dates while preserving timed values across a toggle", () => {
  const timed = validValue({ startAt: "2026-10-03T10:30", endAt: "2026-10-05T12:45" });
  const allDay = eventEditorToggleAllDay(timed, true);
  assert.equal(eventEditorDateInputValue(allDay.startAt, true), "2026-10-03");
  assert.equal(eventEditorDateInputValue(allDay.endAt, true), "2026-10-05");
  assert.deepEqual(eventEditorToggleAllDay(allDay, false), timed);
  assert.equal(eventEditorSetAllDayDate(allDay.startAt, "2026-10-04"), "2026-10-04T10:30");
});

test("all-day submission sends date-only inclusive endpoints and strips stale no-registration fields", () => {
  const payload = eventEditorSubmissionFields(validValue({
    allDay: true,
    startAt: "2026-10-03T10:30",
    endAt: "2026-10-05T12:45",
    registrationStatus: "not_required",
    registrationDeadline: "2026-10-02T18:00",
    registrationUrl: "https://apply.example.org/stale",
  }));
  assert.deepEqual(payload, {
    startAt: "2026-10-03",
    endAt: "2026-10-05",
    registrationDeadline: "",
    registrationUrl: "",
  });
});

test("same-day all-day events validate and stored exclusive end becomes an inclusive editor date", () => {
  assert.equal(validateEventEditorValue(validValue({
    allDay: true,
    startAt: "2026-10-03",
    endAt: "2026-10-03",
    registrationDeadline: "2026-10-03T18:00",
  })), null);
  assert.equal(validateEventEditorValue(validValue({
    registrationStatus: "not_required",
    registrationDeadline: "not-a-date",
  })), null);
  const editor = managedEventEditorValue({
    ...validValue(),
    id: "event-1",
    allDay: true,
    startAt: new Date("2026-10-02T15:00:00.000Z"),
    endAt: new Date("2026-10-05T15:00:00.000Z"),
    registrationDeadline: undefined,
    status: "published",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdByLabel: "작성자",
    gallery: [],
    mediaUploads: [],
    instagramPosts: [{ sourceUrl: "https://www.instagram.com/reel/Abcde_1/", mediaType: "reel", shortcode: "Abcde_1" }],
  });
  assert.equal(editor.startAt, "2026-10-03");
  assert.equal(editor.endAt, "2026-10-05");
  assert.equal(editor.instagramPosts[0].shortcode, "Abcde_1");
});

test("a canceled event keeps owner edit and unpublish actions without offering cancellation again", () => {
  assert.deepEqual(managedEventActions("canceled"), {
    canEdit: true,
    canCancel: false,
    canUnpublish: true,
    canRestore: false,
    locked: false,
  });
});

test("an unpublished event offers a private restore action", () => {
  const actions = managedEventActions("unpublished");
  assert.equal(actions.canEdit, false);
  assert.equal(actions.canRestore, true);
  assert.equal(actions.canUnpublish, false);
});

test("an unpublished event is owner-visible and offers only private restoration", () => {
  assert.deepEqual(managedEventActions("unpublished"), {
    canEdit: false,
    canCancel: false,
    canUnpublish: false,
    canRestore: true,
    locked: false,
  });
});
