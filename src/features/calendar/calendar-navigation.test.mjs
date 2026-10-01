import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarRestoreDecision,
  calendarViewAfterResize,
  createCalendarDetailState,
  createCalendarListRestoreState,
  filterCalendarEvents,
  parseCalendarDetailState,
  parseCalendarListRestoreState,
  parseCalendarSearch,
  serializeCalendarSearch,
} from "./calendar-navigation.ts";

const fallback = {
  month: { year: 2026, month: 8 },
  view: "agenda",
  region: "전체",
  organizer: "전체",
  search: "",
};

test("calendar URL roundtrip preserves month, explicit view, filters, and search", () => {
  const state = {
    month: { year: 2026, month: 9 },
    view: "month",
    region: "서울",
    organizer: "서울교구",
    search: "마음 공부",
  };

  assert.deepEqual(parseCalendarSearch(serializeCalendarSearch(state), fallback), state);
  assert.equal(
    serializeCalendarSearch(state),
    "?month=2026-10&view=month&region=%EC%84%9C%EC%9A%B8&organizer=%EC%84%9C%EC%9A%B8%EA%B5%90%EA%B5%AC&q=%EB%A7%88%EC%9D%8C+%EA%B3%B5%EB%B6%80",
  );
});

test("malformed URL fields use valid local fallbacks without retaining unsafe values", () => {
  assert.deepEqual(
    parseCalendarSearch("?month=2026-13&view=cards&region=%20%20&organizer=%00bad&q=%20%20", fallback),
    fallback,
  );
});

test("an explicit user view survives viewport changes while an implicit view may adapt", () => {
  assert.equal(calendarViewAfterResize("month", true, true), "month");
  assert.equal(calendarViewAfterResize("month", false, true), "agenda");
  assert.equal(calendarViewAfterResize("agenda", false, false), "month");
});

test("calendar search matches event content together with region and organizer filters", () => {
  const events = [
    { id: "seoul", title: "마음 공부", summary: "저녁 모임", description: "", locationName: "서울회관", region: "서울", organizerName: "서울교구" },
    { id: "busan", title: "청년 법회", summary: "마음 나눔", description: "", locationName: "부산회관", region: "부산", organizerName: "부산교구" },
  ];

  assert.deepEqual(filterCalendarEvents(events, { region: "서울", organizer: "서울교구", search: "저녁" }).map(({ id }) => id), ["seoul"]);
  assert.deepEqual(filterCalendarEvents(events, { region: "전체", organizer: "전체", search: "마음" }).map(({ id }) => id), ["seoul", "busan"]);
});

test("direct, malformed, and external detail returns fall back to the calendar", () => {
  assert.equal(parseCalendarDetailState(undefined), null);
  assert.equal(parseCalendarDetailState({ calendarReturn: { returnTo: "https://evil.example/calendar", historyBack: true } }), null);
  assert.equal(parseCalendarDetailState({ calendarReturn: { returnTo: "/archive", historyBack: true } }), null);
});

test("list and detail temporary state roundtrip only valid local calendar recovery", () => {
  const restoreState = createCalendarListRestoreState({ unrelated: "keep" }, "event-7", 812);
  assert.deepEqual(parseCalendarListRestoreState(restoreState), { eventId: "event-7", scrollY: 812 });
  assert.equal(restoreState.unrelated, "keep");

  const detailState = createCalendarDetailState("/calendar?month=2026-10&view=agenda&q=test");
  assert.deepEqual(parseCalendarDetailState(detailState), {
    returnTo: "/calendar?month=2026-10&view=agenda&q=test",
    historyBack: true,
  });
});

test("late and paginated results wait or load more before restoring the selected event", () => {
  const restore = { eventId: "event-7", scrollY: 812 };
  assert.equal(calendarRestoreDecision(restore, [], { resultsReady: false, hasMore: false }), "wait");
  assert.equal(calendarRestoreDecision(restore, ["event-1"], { resultsReady: true, hasMore: true }), "load-more");
  assert.equal(calendarRestoreDecision(restore, ["event-1", "event-7"], { resultsReady: true, hasMore: false }), "restore");
});

test("a deleted selected event reaches a safe calendar fallback after results are exhausted", () => {
  assert.equal(
    calendarRestoreDecision({ eventId: "deleted", scrollY: 320 }, ["event-1"], { resultsReady: true, hasMore: false }),
    "fallback",
  );
});

test("a rejected restoration page stops automatic loading until the user chooses recovery", () => {
  assert.equal(
    calendarRestoreDecision(
      { eventId: "event-7", scrollY: 812 },
      ["event-1", "event-2"],
      { resultsReady: true, hasMore: true, loadFailed: true },
    ),
    "failed",
  );
});
