import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, FilePenLine, Search, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { MaterialRow } from "../components/ArchiveCards";
import { PageFrame } from "../components/PageFrame";
import { showPublicFixtures } from "../config/public-fixtures";
import {
  fixtureMaterials,
  type ArchiveMaterial,
  type ArchiveMaterialCursor,
} from "../data/archive-repository";
import { publishedArchiveRepository } from "../data/firestore-archive-repository";
import { useFirebaseAudience } from "../features/auth/useFirebaseAudience";
import { isFirebaseConfigured } from "../lib/firebase/client";
import { useSubmissionManagement } from "../features/uploads/useSubmissionManagement";
import {
  filterLoadedMaterials,
  countLoadedMaterialFormats,
  primaryResourceTypes,
  resetResourceDiscovery,
  secondaryResourceTypes,
} from "../features/discovery/resource-discovery";
import discoveryStyles from "../features/discovery/DiscoveryExperience.module.css";
import fixtureStyles from "./FixtureDisclosure.module.css";

const MaterialFormatChart = lazy(() => import("../features/discovery/MaterialFormatChart").then((module) => ({ default: module.MaterialFormatChart })));

export function ResourcesPage() {
  const { audience, ready: audienceReady } = useFirebaseAudience();
  const [search, setSearch] = useSearchParams();
  const activeType = search.get("type") ?? "전체";
  const query = search.get("q") ?? "";
  const updateFilter = (key: string, value: string | null) => setSearch(current => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true, preventScrollReset: true });
  const setActiveType = (value: string) => updateFilter("type", value === "전체" ? null : value);
  const [showMoreFormats, setShowMoreFormats] = useState(() => secondaryResourceTypes.includes(activeType as typeof secondaryResourceTypes[number]));
  const [showFormatSummary, setShowFormatSummary] = useState(false);
  const [publishedMaterials, setPublishedMaterials] = useState<ArchiveMaterial[]>([]);
  const [publishedState, setPublishedState] = useState<
    "loading" | "ready" | "error" | "unavailable"
  >(() => (isFirebaseConfigured ? "loading" : "unavailable"));
  const [publishedCursor, setPublishedCursor] = useState<ArchiveMaterialCursor | null>(null);
  const [hasMorePublished, setHasMorePublished] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const requestId = useRef(0);
  const types = [
    { value: "전체", label: "모든 자료", tone: "all" },
    { value: "TEXT", label: "글·회의록", tone: "all" },
    { value: "PDF", label: "PDF 문서", tone: "pdf" },
    { value: "PPTX", label: "발표 자료·PPT", tone: "pptx" },
    { value: "DOCUMENT", label: "한글·워드 문서", tone: "document" },
    { value: "XLSX", label: "엑셀 자료", tone: "xlsx" },
    { value: "IMAGE", label: "사진·포스터", tone: "all" },
    { value: "TXT", label: "텍스트 파일", tone: "all" },
    { value: "CSV", label: "표 데이터", tone: "all" },
    { value: "FILE", label: "첨부 파일", tone: "all" },
    { value: "LINK", label: "웹 링크", tone: "link" },
  ] as const;
  const activeTypeLabel = types.find((type) => type.value === activeType)?.label ?? "자료";
  const primaryTypes = types.filter((type) => primaryResourceTypes.includes(type.value as typeof primaryResourceTypes[number]));
  const secondaryTypes = types.filter((type) => secondaryResourceTypes.includes(type.value as typeof secondaryResourceTypes[number]));
  const secondaryTypeIsActive = secondaryResourceTypes.includes(activeType as typeof secondaryResourceTypes[number]);

  const loadPublishedMaterials = useCallback(async (
    cursor: ArchiveMaterialCursor | null,
    append: boolean,
  ) => {
    const currentRequest = ++requestId.current;
    if (append) setIsLoadingMore(true);
    else {
      setPublishedState("loading");
      setPublishedMaterials([]);
      setPublishedCursor(null);
      setHasMorePublished(false);
    }
    try {
      const page = await publishedArchiveRepository.listPublicMaterialsPage({ cursor, pageSize: 24, audience });
      if (currentRequest !== requestId.current) return;
      setPublishedMaterials((current) => {
        if (!append) return page.items;
        const merged = new Map(current.map((item) => [item.id, item]));
        page.items.forEach((item) => merged.set(item.id, item));
        return [...merged.values()];
      });
      setPublishedCursor(page.nextCursor);
      setHasMorePublished(page.hasMore);
      setPublishedState("ready");
    } catch {
      if (currentRequest === requestId.current) setPublishedState("error");
    } finally {
      if (currentRequest === requestId.current) setIsLoadingMore(false);
    }
  }, [audience]);

  useEffect(() => {
    if (!isFirebaseConfigured || !audienceReady) return;
    void Promise.resolve().then(() => loadPublishedMaterials(null, false));
    return () => {
      requestId.current += 1;
    };
  }, [audienceReady, loadPublishedMaterials]);

  const shownPublished = filterLoadedMaterials(publishedMaterials.filter(
    (material) => audience === "member" || material.visibility === "공개",
  ), activeType, query);
  const management = useSubmissionManagement(shownPublished.map((material) => material.id));
  const shownFixtures = filterLoadedMaterials(fixtureMaterials.filter(
    (material) => audience === "member" || material.visibility === "공개",
  ), activeType, query);
  const publicCollectionIsEmpty =
    publishedMaterials.length === 0 &&
    publishedState !== "loading" &&
    publishedState !== "error" &&
    !hasMorePublished;
  const visiblePublishedMaterials = useMemo(
    () => publishedMaterials.filter((material) => audience === "member" || material.visibility === "공개"),
    [audience, publishedMaterials],
  );
  const formatCounts = useMemo(() => countLoadedMaterialFormats(visiblePublishedMaterials), [visiblePublishedMaterials]);

  return (
    <PageFrame
      eyebrow="자료 나눔"
      title={
        <>
          필요한 자료를
          <br /> 찾고 나눠요
        </>
      }
      description={showPublicFixtures
        ? "회의록과 붙여넣은 글, 행사 안내문, 발표 자료, 한글 양식처럼 다시 쓸 수 있는 내용을 찾아보세요."
        : "회의록과 붙여넣은 글, 행사 안내문, 발표 자료, 한글 양식처럼 다시 쓸 수 있는 내용을 찾아보세요."}
    >
      <section className={`${discoveryStyles.resourceWorkbench} resource-tools`} aria-labelledby="resource-tools-title">
        <div className={discoveryStyles.resourceHeading}>
          <h2 id="resource-tools-title">자료 찾기</h2>
          <p>지금까지 불러온 자료의 제목과 설명에서 찾아요</p>
        </div>
        <div className={discoveryStyles.searchRow}>
          <label className={discoveryStyles.searchField}>
            <Search size={19} aria-hidden="true" />
            <span className="sr-only">불러온 자료 검색</span>
            <input type="search" value={query} onChange={(event) => updateFilter("q", event.target.value || null)} placeholder="제목이나 설명 검색" />
          </label>
          <Link className="contribute-link" to="/contribute?intent=material">
            <FilePenLine size={18} /> 자료 올리기
          </Link>
        </div>
        <div className={discoveryStyles.filterSection}>
          <span className={discoveryStyles.filterLabel}>자료 형식</span>
          <div className={`${discoveryStyles.filterGroup} filter-row resources-filter`} role="group" aria-label="주요 자료 형식 필터">
            {primaryTypes.map((type) => (
              <button
                type="button"
                aria-label={`${type.label}만 보기`}
                aria-pressed={activeType === type.value}
                className={`resource-filter-${type.tone} ${activeType === type.value ? "active" : ""}`}
                onClick={() => setActiveType(type.value)}
                key={type.value}
              >
                {type.label}
              </button>
            ))}
          </div>
          <details className={discoveryStyles.moreFormats} open={showMoreFormats || secondaryTypeIsActive} onToggle={(event) => setShowMoreFormats(event.currentTarget.open)}>
            <summary>다른 형식 보기 <ChevronDown size={17} aria-hidden="true" /></summary>
            <div className={`${discoveryStyles.filterGroup} filter-row resources-filter`} role="group" aria-label="다른 자료 형식 필터">
              {secondaryTypes.map((type) => (
                <button
                  type="button"
                  aria-label={`${type.label}만 보기`}
                  aria-pressed={activeType === type.value}
                  className={`resource-filter-${type.tone} ${activeType === type.value ? "active" : ""}`}
                  onClick={() => setActiveType(type.value)}
                  key={type.value}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </details>
        </div>
        <div className={discoveryStyles.resultStatus} aria-live="polite">
          <span className={discoveryStyles.loadedScope}>불러온 실제 자료 {publishedMaterials.length}건 중 <strong>{shownPublished.length}건</strong> 표시</span>
          {(query || activeType !== "전체") && <button className={discoveryStyles.resetButton} type="button" onClick={() => setSearch(resetResourceDiscovery, { replace: true, preventScrollReset: true })}><X size={16} /> 검색·형식 초기화</button>}
        </div>
        {formatCounts.length > 0 && <details className={discoveryStyles.formatSummary} open={showFormatSummary} onToggle={(event) => setShowFormatSummary(event.currentTarget.open)}>
          <summary>불러온 자료의 형식 분포 <ChevronDown size={17} aria-hidden="true" /></summary>
          {showFormatSummary && <Suspense fallback={<p role="status">형식 분포를 준비하고 있어요.</p>}>
            <p className={discoveryStyles.formatSummaryCopy}>현재 권한으로 불러온 실제 자료 {visiblePublishedMaterials.length}개만 집계했습니다. 예시 자료와 아직 불러오지 않은 자료는 포함하지 않습니다.</p>
            <MaterialFormatChart counts={formatCounts} />
          </Suspense>}
        </details>}
      </section>
      <h2 className="sr-only">공유 자료 목록</h2>
      <section className={`resource-collection ${publicCollectionIsEmpty ? "resource-collection-empty" : ""}`} aria-labelledby="published-materials-title">
        <div className={`resource-collection-heading ${publicCollectionIsEmpty ? "sr-only" : ""}`}>
          <div>
            <h2 id="published-materials-title">{audience === "member" ? "공유 자료" : "공개 자료"}</h2>
            <p>{audience === "member" ? "누구나 볼 수 있는 자료와 위브 로그인 이용자에게 공개된 자료를 함께 볼 수 있어요." : "누구나 볼 수 있도록 공개된 자료입니다."}</p>
          </div>
          {publishedState === "loading" && <span>불러오는 중</span>}
        </div>
        {publishedMaterials.length > 0 ? (
          <>
            {shownPublished.length > 0 ? (
              <div className="materials-list resources-list">
                {shownPublished.map((material) => (
                  <MaterialRow key={material.id} material={material} showActivity ownedManagement={management.records.get(material.id)} onDeleted={(id) => setPublishedMaterials((current) => current.filter((item) => item.id !== id))} />
                ))}
              </div>
            ) : (
              <div className="resource-status">
                지금 불러온 목록에는 {query ? `‘${query}’ 검색과 ` : ""}‘{activeTypeLabel}’ 형식에 맞는 자료가 없어요.
                {hasMorePublished && <p>아직 불러오지 않은 자료가 있어요. 필터를 유지한 채 다음 자료를 확인할 수 있습니다.</p>}
                <button type="button" onClick={() => setSearch(resetResourceDiscovery, { replace: true, preventScrollReset: true })}>전체 자료 보기</button>
              </div>
            )}
            {management.phase === "error" && <div className="resource-status" role="alert">내 자료의 수정 권한을 확인하지 못했어요. <button type="button" onClick={management.retry}>다시 확인</button></div>}
            {publishedState === "error" && (
              <div className="resource-status" role="alert">
                다음 자료를 불러오지 못했어요.
                <button type="button" onClick={() => void loadPublishedMaterials(publishedCursor, true)}>
                  다시 시도
                </button>
              </div>
            )}
            {hasMorePublished && publishedState !== "error" && (
              <div className="resource-status">
                <button
                  type="button"
                  disabled={isLoadingMore}
                  onClick={() => void loadPublishedMaterials(publishedCursor, true)}
                >
                  {isLoadingMore ? "자료를 불러오는 중" : "자료 더 보기"}
                </button>
              </div>
            )}
          </>
        ) : publishedState === "loading" ? (
          <div className="resource-status" role="status">공개 자료를 불러오고 있어요.</div>
        ) : publishedState === "error" ? (
          <div className="resource-status" role="alert">
            공개 자료를 불러오지 못했어요.
            <button type="button" onClick={() => void loadPublishedMaterials(null, false)}>
              다시 시도
            </button>
          </div>
        ) : hasMorePublished ? (
          <div className="resource-status">
            지금 불러온 목록에는 표시할 자료가 없어요.
            <button
              type="button"
              disabled={isLoadingMore}
              onClick={() => void loadPublishedMaterials(publishedCursor, true)}
            >
              {isLoadingMore ? "자료를 불러오는 중" : "다음 자료 보기"}
            </button>
          </div>
        ) : (
          <div className="resource-public-empty">
            <div>
              <p>공개 자료</p>
              <h3>
                {activeType === "전체"
                  ? "공개 자료를 준비하고 있어요"
                  : `‘${activeTypeLabel}’ 공개 자료를 기다리고 있어요`}
              </h3>
              <span>
                새 자료가 공개되면 이 목록에 바로 표시됩니다.
                {showPublicFixtures
                  ? " 자료를 올려 함께 나눠 주세요."
                  : " 활동에서 남긴 기록과 자료를 나눠 주세요."}
              </span>
            </div>
            <Link to="/contribute?intent=material">
              자료 올리기 <ArrowRight size={17} />
            </Link>
          </div>
        )}
      </section>
      {showPublicFixtures && (
      <section className="resource-collection fixture-collection" aria-labelledby="fixture-materials-title">
        <h2 className="sr-only" id="fixture-materials-title">자료 사용 예시</h2>
        <details className={fixtureStyles.disclosure} open={search.get("examples") === "1"} onToggle={event => {
          const open = event.currentTarget.open;
          if (open !== (search.get("examples") === "1")) updateFilter("examples", open ? "1" : null);
        }}>
          <summary className={fixtureStyles.summary}>사용 예시 보기 <span>자료 {shownFixtures.length}개</span></summary>
          <div className={fixtureStyles.content}>
            <p>위브의 자료 분류와 이용 흐름을 보여 주는 예시입니다.</p>
            {shownFixtures.length ? (
              <div className="materials-list resources-list">
                {shownFixtures.map((material) => (
                  <MaterialRow key={material.id} material={material} showActivity />
                ))}
              </div>
            ) : (
              <div className="resource-status">이 형식의 예시 자료가 없어요.</div>
            )}
          </div>
        </details>
      </section>
      )}
    </PageFrame>
  );
}
