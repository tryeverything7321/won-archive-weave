import assert from "node:assert/strict";
import test from "node:test";
import { loadUpcomingEvents, selectUpcomingEvents } from "./upcoming-events.ts";

const now = new Date("2026-09-23T03:00:00.000Z");
const base = {
  title: "청년 행사",
  summary: "",
  description: "",
  organizerName: "원불교 청년회",
  startAt: new Date("2026-09-25T03:00:00.000Z"),
  endAt: new Date("2026-09-25T05:00:00.000Z"),
  allDay: false,
  timeZone: "Asia/Seoul",
  region: "서울",
  locationName: "서울회관",
  visibility: "public",
  eventState: "confirmed",
  sourceType: "manual",
  origin: "published",
};
function event(id, overrides = {}) { return { ...base, id, ...overrides }; }

test("only real, public and still active events appear in chronological order", () => {
  const events = [
    event("later", { startAt: new Date("2026-10-02T03:00:00.000Z"), endAt: new Date("2026-10-02T05:00:00.000Z") }),
    event("soon"),
    event("fixture", { origin: "fixture" }),
    event("private", { visibility: "member_only" }),
    event("canceled", { eventState: "canceled" }),
    event("ended", { startAt: new Date("2026-09-22T03:00:00.000Z"), endAt: new Date("2026-09-22T05:00:00.000Z") }),
  ];
  assert.deepEqual(selectUpcomingEvents(events, now).map((item) => item.id), ["soon", "later"]);
});

test("a multiday event stays visible until it ends and is not duplicated across months", () => {
  const active = event("active", { startAt: new Date("2026-09-22T03:00:00.000Z"), endAt: new Date("2026-09-24T05:00:00.000Z") });
  assert.deepEqual(selectUpcomingEvents([active, active], now).map((item) => item.id), ["active"]);
});

test("loads later months when the current month has too few upcoming events", async () => {
  const seen = [];
  const repository = {
    async listMonth({ monthKey }) {
      seen.push(monthKey);
      return {
        items: monthKey === "2026-10" ? [event("oct", { startAt: new Date("2026-10-02T03:00:00.000Z"), endAt: new Date("2026-10-02T05:00:00.000Z") })] : [],
        nextCursor: { public: null, member: null, publicDone: true, memberDone: true },
        hasMore: false,
      };
    },
  };
  assert.deepEqual((await loadUpcomingEvents(repository, now)).map((item) => item.id), ["oct"]);
  assert.deepEqual(seen, ["2026-09", "2026-10", "2026-11", "2026-12"]);
});

function page(items = [], hasMore = false) {
  return { items, hasMore, nextCursor: { public: null, member: null, publicDone: !hasMore, memberDone: true } };
}

test("shows current events before later reads finish, and starts later months together", async () => {
  const waiting = new Map();
  const reads = [];
  const progress = [];
  const repository = { listMonth(input) {
    assert.equal(input.includeMember, false);
    reads.push(input.monthKey);
    if (input.monthKey === "2026-09") return Promise.resolve(page([event("soon")]));
    return new Promise(resolve => waiting.set(input.monthKey, resolve));
  } };
  const loading = loadUpcomingEvents(repository, now, events => progress.push(events.map(e => e.id)));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(progress, [["soon"]]);
  assert.deepEqual(reads, ["2026-09", "2026-10", "2026-11", "2026-12"]);
  for (const resolve of waiting.values()) resolve(page());
  assert.deepEqual((await loading).map(e => e.id), ["soon"]);
});

test("nearest month with three events avoids speculative reads", async () => {
  const reads = [];
  const repository = { async listMonth({monthKey}) { reads.push(monthKey);return page([event("one"),event("two"),event("three")]); } };
  assert.equal((await loadUpcomingEvents(repository, now)).length, 3);
  assert.deepEqual(reads, ["2026-09"]);
});

test("speculative completion order does not change chronological selection", async () => {
  const pending = new Map();
  const repository = { listMonth({monthKey}) {
    if (monthKey === "2026-09") return Promise.resolve(page());
    return new Promise(resolve => pending.set(monthKey, resolve));
  } };
  const loading = loadUpcomingEvents(repository, now);
  await new Promise(resolve => setImmediate(resolve));
  pending.get("2026-12")(page([event("dec",{startAt:new Date("2026-12-01"),endAt:new Date("2026-12-02")})]));
  pending.get("2026-11")(page([event("nov",{startAt:new Date("2026-11-01"),endAt:new Date("2026-11-02")})]));
  pending.get("2026-10")(page([event("oct",{startAt:new Date("2026-10-01"),endAt:new Date("2026-10-02")})]));
  assert.deepEqual((await loading).map(e=>e.id),["oct","nov","dec"]);
});

test("unused later rejection is handled when an earlier month supplies three events", async () => {
  const repository = { listMonth({monthKey}) {
    if (monthKey === "2026-09") return Promise.resolve(page());
    if (monthKey === "2026-10") return Promise.resolve(page([event("a"),event("b"),event("c")]));
    return Promise.reject(new Error("unused later month"));
  } };
  assert.equal((await loadUpcomingEvents(repository, now)).length,3);
  await new Promise(resolve => setImmediate(resolve));
});

test("required later failure preserves the already published progress evidence", async () => {
  const progress=[];
  const repository = { listMonth({monthKey}) {
    return monthKey === "2026-09" ? Promise.resolve(page([event("soon")])) : Promise.reject(new Error("offline"));
  } };
  await assert.rejects(loadUpcomingEvents(repository, now, items=>progress.push(items.map(e=>e.id))),/offline/);
  assert.deepEqual(progress,[["soon"]]);
});
