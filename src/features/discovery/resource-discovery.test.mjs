import assert from "node:assert/strict";
import test from "node:test";
import {
  filterLoadedMaterials,
  countLoadedMaterialFormats,
  materialMatchesType,
  resetResourceDiscovery,
  secondaryResourceTypes,
} from "./resource-discovery.ts";

const materials = [
  { id: "a", type: "PDF", title: "청년회 운영 안내", description: "행사 준비 체크리스트" },
  { id: "b", type: "HWPX", title: "회의록 양식", description: "정기 회의 기록" },
  { id: "c", type: "CSV", title: "참여 현황", description: "신청자 표 데이터" },
];

test("자료 검색은 현재 불러온 목록의 제목과 설명을 형식 필터와 함께 좁힌다", () => {
  assert.deepEqual(filterLoadedMaterials(materials, "전체", "행사").map(({ id }) => id), ["a"]);
  assert.deepEqual(filterLoadedMaterials(materials, "DOCUMENT", "회의").map(({ id }) => id), ["b"]);
  assert.deepEqual(filterLoadedMaterials(materials, "PDF", "없는 말"), []);
});

test("형식 분포는 예시가 섞이지 않은 전달 목록만 집계하고 같은 형식을 합친다", () => {
  const counts = countLoadedMaterialFormats([...materials, { ...materials[0], id: "d" }]);
  assert.deepEqual(counts, [
    { type: "PDF", count: 2 },
    { type: "CSV", count: 1 },
    { type: "HWPX", count: 1 },
  ]);
});

test("한글·워드 묶음과 더보기 형식은 실제 저장 형식 계약을 유지한다", () => {
  assert.equal(materialMatchesType(materials[1], "DOCUMENT"), true);
  assert.equal(materialMatchesType(materials[2], "DOCUMENT"), false);
  assert.equal(secondaryResourceTypes.includes("CSV"), true);
});

test("필터 초기화는 검색과 형식만 지우고 예시 공개 상태를 보존한다", () => {
  const next = resetResourceDiscovery(new URLSearchParams("q=회의&type=CSV&examples=1"));
  assert.equal(next.toString(), "examples=1");
});
