import assert from "node:assert/strict";
import test from "node:test";
import { eventActionModel } from "./event-action-model.ts";

const now = new Date("2026-07-24T03:00:00.000Z");
const base = {
  id: "event-1",
  title: "청년 모임",
  summary: "",
  description: "",
  organizerName: "위브",
  startAt: new Date("2026-07-25T03:00:00.000Z"),
  endAt: new Date("2026-07-25T05:00:00.000Z"),
  allDay: false,
  timeZone: "Asia/Seoul",
  region: "서울",
  locationName: "회관",
  visibility: "public",
  eventState: "confirmed",
  sourceType: "manual",
  origin: "published",
};

test("closed registration never exposes an application action", () => {
  const model = eventActionModel({
    ...base,
    registrationStatus: "closed",
    registrationUrl: "https://example.com/apply",
  }, now);
  assert.equal(model.state, "closed");
  assert.equal(model.registration, null);
});

test("a passed deadline closes registration even when its stored status is open", () => {
  const model = eventActionModel({
    ...base,
    registrationStatus: "open",
    registrationDeadline: new Date("2026-07-24T02:59:00.000Z"),
    registrationUrl: "https://example.com/apply",
  }, now);
  assert.equal(model.state, "closed");
  assert.equal(model.registration, null);
});

test("canceled and ended events cannot be added to a calendar or applied for", () => {
  const canceled = eventActionModel({
    ...base,
    eventState: "canceled",
    registrationUrl: "https://example.com/apply",
  }, now);
  const ended = eventActionModel({
    ...base,
    startAt: new Date("2026-07-23T01:00:00.000Z"),
    endAt: new Date("2026-07-23T02:00:00.000Z"),
    registrationUrl: "https://example.com/apply",
  }, now);
  assert.equal(canceled.canAddToCalendar, false);
  assert.equal(canceled.registration, null);
  assert.equal(ended.canAddToCalendar, false);
  assert.equal(ended.registration, null);
});

test("an open external application keeps an explicit external action", () => {
  const model = eventActionModel({
    ...base,
    registrationStatus: "open",
    registrationUrl: "https://example.com/apply",
  }, now);
  assert.equal(model.state, "open");
  assert.deepEqual(model.registration, {
    url: "https://example.com/apply",
    label: "외부에서 신청하기",
  });
});

test("an event without an application link does not imply an external application page", () => {
  const model = eventActionModel({
    ...base,
    registrationStatus: "open",
  }, now);
  assert.equal(model.label, "신청 방법 확인");
  assert.match(model.description, /신청 링크가 등록되지 않았어요/);
  assert.equal(model.registration, null);
});

test("an ended event without a source link does not direct visitors to an absent original", () => {
  const model = eventActionModel({
    ...base,
    startAt: new Date("2026-07-23T01:00:00.000Z"),
    endAt: new Date("2026-07-23T02:00:00.000Z"),
  }, now);
  assert.equal(model.label, "행사 종료");
  assert.doesNotMatch(model.description, /원문/);
});
