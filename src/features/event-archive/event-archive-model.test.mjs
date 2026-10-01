import assert from "node:assert/strict";
import test from "node:test";
import { archiveEventContextQuery, archiveEventDateLabel, archiveRelationPath, eventContextQuery, pastEventYearIsValid } from "./event-archive-model.ts";

test("연도만 아는 과거 행사는 임의 날짜 없이 연도로 표시한다", () => {
  assert.equal(archiveEventDateLabel({ datePrecision: "year", heldYear: 2025 }), "2025년");
  assert.equal(pastEventYearIsValid(2025, 2026), true);
  assert.equal(pastEventYearIsValid(2027, 2026), false);
});

test("행사에서 시작한 등록은 종류와 기존 행사 ID 및 복귀 경로를 보존한다", () => {
  const path = eventContextQuery("event 1", "material", "/events/event 1");
  assert.equal(path, "/contribute?kind=material&calendarEventId=event+1&returnTo=%2Fevents%2Fevent+1");
});

test("연도만 있는 행사의 등록은 일정 ID를 만들지 않고 아카이브 행사 ID를 보존한다", () => {
  const path = archiveEventContextQuery("archive:event-1998", "activity", "/archive-events/archive%3Aevent-1998");
  const url = new URL(path, "https://weave.example");
  assert.equal(url.searchParams.get("archiveEventId"), "archive:event-1998");
  assert.equal(url.searchParams.get("calendarEventId"), null);
  assert.equal(url.searchParams.get("kind"), "activity");
});

test("관계 대상은 기존 원본 URL로 이동하고 새 사본 경로를 만들지 않는다", () => {
  assert.equal(archiveRelationPath({ id: "bundle-1", targetType: "bundle" }), "/bundles/bundle-1");
  assert.equal(archiveRelationPath({ id: "material-1", targetType: "material" }), "/materials/material-1");
  assert.equal(archiveRelationPath({ id: "activity-1", targetType: "activity" }), "/activities/activity-1");
});
