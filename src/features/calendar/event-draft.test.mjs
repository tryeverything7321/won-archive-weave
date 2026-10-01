import assert from "node:assert/strict";
import test from "node:test";
import { createDraftSession, createDraftStore } from "../drafts/draft-store.ts";
import {
  calendarConnectPath,
  calendarDraftIdFromSearch,
  calendarDraftReturnFromSearch,
  calendarEditorAttemptIsCurrent,
  calendarEventDraftCodec,
  calendarEventDraftIdentity,
  calendarEventDraftNeedsFileReselection,
  calendarNewDraftPath,
  savedCalendarEventDraftRevision,
} from "./event-draft.ts";

const complete = {
  title: "청년 마음공부 모임",
  summary: "함께 공부해요",
  description: "준비물과 진행 순서를 안내합니다.",
  startAt: "2026-10-03T10:00",
  endAt: "2026-10-03T12:00",
  allDay: false,
  timeZone: "Asia/Seoul",
  region: "서울",
  organizerName: "서울교구 청년회",
  locationName: "서울회관",
  address: "서울시 동작구",
  onlineUrl: "https://meet.example.org/youth",
  registrationUrl: "https://apply.example.org/youth",
  registrationDeadline: "2026-10-02T18:00",
  registrationStatus: "open",
  visibility: "member_only",
  sourceUrl: "https://example.org/events/youth",
  instagramPosts: [{
    sourceUrl: "https://www.instagram.com/p/ABCDE/",
    mediaType: "post",
    shortcode: "ABCDE",
    originalAuthor: "weave.youth",
  }],
  visibilitySelected: true,
  existingUploads: [{
    role: "thumbnail",
    storagePath: "quarantined/member-1/calendar-events/event-1/thumbnail-photo.webp",
    fileName: "photo.webp",
    contentType: "image/webp",
    size: 1024,
    alt: "청년들이 둥글게 앉은 모습",
    displayMode: "cover",
  }],
};

class MemoryStorage {
  #values = new Map();
  get length() { return this.#values.size; }
  key(index) { return [...this.#values.keys()][index] ?? null; }
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, value); }
  removeItem(key) { this.#values.delete(key); }
}

test("calendar event codec roundtrips every editor field and existing media edit", () => {
  assert.deepEqual(calendarEventDraftCodec.decode(calendarEventDraftCodec.encode(complete)), complete);
});

test("calendar event codec strips unknown data and rejects credentials or file objects", () => {
  const encoded = calendarEventDraftCodec.encode({ ...complete, providerToken: "secret", file: new Uint8Array([1]) });
  assert.equal("providerToken" in encoded, false);
  assert.equal("file" in encoded, false);
  assert.throws(() => calendarEventDraftCodec.encode({ ...complete, onlineUrl: "https://meet.example/?token=secret" }));
  assert.throws(() => calendarEventDraftCodec.decode({ ...encoded, visibility: "private" }));
  assert.throws(() => calendarEventDraftCodec.decode({ ...encoded, existingUploads: [{ file: "bytes" }] }));
});

test("legacy event drafts without an explicit marker require a new visibility choice", () => {
  const { visibilitySelected: _legacyMissing, ...legacy } = complete;
  assert.equal(calendarEventDraftCodec.decode(legacy).visibilitySelected, false);
  assert.throws(() => calendarEventDraftCodec.decode({ ...complete, visibilitySelected: "yes" }));
});

test("legacy drafts default missing Instagram posts while new malformed media and links fail closed", () => {
  const legacy = { ...complete };
  delete legacy.instagramPosts;
  legacy.existingUploads = legacy.existingUploads.map(({ displayMode: _missing, ...image }) => image);
  const decoded = calendarEventDraftCodec.decode(legacy);
  assert.deepEqual(decoded.instagramPosts, []);
  assert.equal(decoded.existingUploads[0].displayMode, undefined);
  assert.throws(() => calendarEventDraftCodec.decode({
    ...complete,
    existingUploads: [{ ...complete.existingUploads[0], displayMode: "stretch" }],
  }));
  assert.throws(() => calendarEventDraftCodec.decode({
    ...complete,
    instagramPosts: [{ sourceUrl: "https://evil.example/p/ABCDE/", mediaType: "post", shortcode: "ABCDE" }],
  }));
});

test("create and edit drafts use stable account-scoped document identities", () => {
  assert.deepEqual(calendarEventDraftIdentity("member-1", undefined, "draft_A1b2C3d4"), {
    ownerId: "member-1",
    kind: "calendar:event:create",
    documentId: "draft_A1b2C3d4",
  });
  assert.deepEqual(calendarEventDraftIdentity("member-1", "event-7", "ignored"), {
    ownerId: "member-1",
    kind: "calendar:event:edit",
    documentId: "event-7",
  });
});

test("new event draft id survives create to import to explicit return without open redirects", () => {
  const createPath = calendarNewDraftPath("draft_A1b2C3d4");
  const connectPath = calendarConnectPath(createPath);
  assert.equal(createPath, "/calendar/new?draft=draft_A1b2C3d4");
  assert.equal(calendarDraftIdFromSearch(new URL(createPath, "https://weave.test").search), "draft_A1b2C3d4");
  assert.equal(calendarDraftReturnFromSearch(new URL(connectPath, "https://weave.test").search), createPath);
  assert.equal(calendarDraftReturnFromSearch("?returnTo=https%3A%2F%2Fevil.example"), null);
  assert.equal(calendarDraftIdFromSearch("?draft=%2Fcalendar%2Fnew"), null);
});

test("file selections persist only a reselection flag and stale owner operations are rejected", () => {
  assert.equal(calendarEventDraftNeedsFileReselection(true), true);
  assert.equal(calendarEventDraftNeedsFileReselection(false), undefined);
  const attempt = { generation: 4, uid: "member-1" };
  assert.equal(calendarEditorAttemptIsCurrent(attempt, 4, "member-1"), true);
  assert.equal(calendarEditorAttemptIsCurrent(attempt, 5, "member-1"), false);
  assert.equal(calendarEditorAttemptIsCurrent(attempt, 4, "member-2"), false);
  assert.equal(calendarEditorAttemptIsCurrent(attempt, 4, undefined), false);
});

test("only a saved exact capture revision can be completed", () => {
  assert.equal(savedCalendarEventDraftRevision({ status: "saved", revision: "rev-1", savedAtMs: 1 }), "rev-1");
  assert.equal(savedCalendarEventDraftRevision({ status: "error", reason: "quota", revision: "rev-2" }), undefined);
  assert.equal(savedCalendarEventDraftRevision({ status: "unchanged", revision: "rev-3" }), undefined);
});

test("same create document reloads every field and an older submit cannot clear a newer edit", () => {
  const identity = calendarEventDraftIdentity("member-1", undefined, "draft_A1b2C3d4");
  const store = createDraftStore(new MemoryStorage(), () => 100);
  const first = createDraftSession({ identity, codec: calendarEventDraftCodec, store, hydrationNonce: "mount-1" });
  first.prime(complete);
  const submitted = first.capture(complete, { fileReselectionRequired: true });
  assert.equal(submitted.status, "saved");
  first.update({ ...complete, title: "응답을 기다리며 고친 제목" }, { fileReselectionRequired: true });
  assert.equal(first.complete(submitted.revision), "stale");

  const reloaded = createDraftSession({ identity, codec: calendarEventDraftCodec, store, hydrationNonce: "mount-2" }).load();
  assert.equal(reloaded.status, "ready");
  assert.equal(reloaded.draft.value.title, "응답을 기다리며 고친 제목");
  assert.equal(reloaded.draft.fileReselectionRequired, true);
  assert.equal(
    store.load(calendarEventDraftIdentity("member-2", undefined, "draft_A1b2C3d4")).status,
    "missing",
  );
});
