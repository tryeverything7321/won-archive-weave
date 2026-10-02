import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  FolderOpen,
  Search,
} from "lucide-react";
import { motion } from "motion/react";
import { MarkdownBody } from '../features/content/MarkdownBody';
import { readTextContent } from '../features/content/text-content';
import { Navigate, Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  ActivityCard,
  EmptyState,
  MaterialRow,
} from "../components/ArchiveCards";
import { PageFrame } from "../components/PageFrame";
import { WeaveBadge } from "../components/WeaveBadge";
import { showPublicFixtures } from "../config/public-fixtures";
import { sentence } from "../lib/text";
import {
  getActivity,
  getActivityMaterials,
  topics,
  type Activity,
  type Material,
  type Topic,
} from "../content";
import {
  fixtureActivities,
  type ArchiveActivity,
  type ArchiveActivityCursor,
  type ArchiveMaterial,
  type ArchiveMaterialCursor,
} from "../data/archive-repository";
import { resetArchiveFilters } from "../data/archive-navigation";
import { materialVisibilityLabel } from "../data/material-access";
import { publishedArchiveRepository } from "../data/firestore-archive-repository";
import { useFirebaseAudience } from "../features/auth/useFirebaseAudience";
import { InstagramReferenceList } from "../features/social/InstagramReferenceList";
import { OwnedSubmissionActions } from "../features/uploads/OwnedSubmissionActions";
import { isFirebaseConfigured } from "../lib/firebase/client";
import { NotFoundPage } from "./NotFoundPage";
import fixtureStyles from './FixtureDisclosure.module.css';

export function ArchivePage() {
  const { audience, ready: audienceReady } = useFirebaseAudience();
  const [search, setSearch] = useSearchParams();
  const topicValue = search.get("topic");
  const activeTopic = topics.includes(topicValue as Topic) ? topicValue as Topic : null;
  const query = search.get("q") ?? "";
  const activeType = search.get("type") ?? "전체";
  const updateFilter = (key: string, value: string | null) => setSearch(current => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true, preventScrollReset: true });
  const setActiveTopic = (value: Topic | null) => updateFilter("topic", value);
  const setQuery = (value: string) => updateFilter("q", value);
  const setActiveType = (value: string) => updateFilter("type", value === "전체" ? null : value);
  const resetFilters = () => setSearch(resetArchiveFilters, { replace: true, preventScrollReset: true });
  const [publishedActivities, setPublishedActivities] = useState<ArchiveActivity[]>([]);
  const [publishedCursor, setPublishedCursor] = useState<ArchiveActivityCursor | null>(null);
  const [hasMorePublished, setHasMorePublished] = useState(false);
  const [publishedState, setPublishedState] = useState<"loading" | "ready" | "error" | "unavailable">(
    () => isFirebaseConfigured ? "loading" : "unavailable",
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const requestId = useRef(0);

  const loadPublishedActivities = useCallback(async (
    cursor: ArchiveActivityCursor | null,
    append: boolean,
  ) => {
    const currentRequest = ++requestId.current;
    if (append) setIsLoadingMore(true);
    else {
      setPublishedState("loading");
      setPublishedActivities([]);
      setPublishedCursor(null);
      setHasMorePublished(false);
    }
    try {
      const page = await publishedArchiveRepository.listPublicActivitiesPage({ cursor, pageSize: 24, audience });
      if (currentRequest !== requestId.current) return;
      setPublishedActivities((current) => {
        if (!append) return page.items;
        const merged = new Map(current.map((item) => [item.slug, item]));
        page.items.forEach((item) => merged.set(item.slug, item));
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
    void Promise.resolve().then(() => loadPublishedActivities(null, false));
    return () => {
      requestId.current += 1;
    };
  }, [audienceReady, loadPublishedActivities]);

  const filterActivities = useCallback(<T extends Activity,>(items: T[]) => {
    const normalized = query.trim().toLowerCase();
    return items.filter(
      (activity) =>
        (!activeTopic || activity.topic.trim() === activeTopic) &&
        (activeType === "전체" || activity.type.trim() === activeType) &&
        (!normalized ||
          [
            activity.title,
            activity.summary,
            activity.story,
            activity.type,
            activity.topic,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalized)),
    );
  }, [activeTopic, activeType, query]);
  const shownPublished = useMemo(
    () => filterActivities(publishedActivities.filter(
      (activity) => audience === "member" || activity.visibility === "공개",
    )),
    [audience, filterActivities, publishedActivities],
  );
  const publishedSlugs = useMemo(
    () => new Set(shownPublished.map((activity) => activity.slug)),
    [shownPublished],
  );
  const shownFixtures = useMemo(
    () => filterActivities(fixtureActivities.filter((activity) => !publishedSlugs.has(activity.slug))),
    [filterActivities, publishedSlugs],
  );
  const activityTypes = useMemo(
    () => ["전체", ...new Set([...publishedActivities, ...fixtureActivities].map((activity) => activity.type.trim()).filter(Boolean))],
    [publishedActivities],
  );
  return (
    <PageFrame
      eyebrow="활동 기록"
      title={
        <>
          경험을 기록하고
          <br /> 활동을 이어가요
        </>
      }
      description="함께한 활동의 과정과 후기를 살펴보세요. 내 활동을 기록하고 사진이나 관련 자료도 함께 남길 수 있어요."
    >
      <div className="archive-controls">
        <Link className="button button-primary" to="/contribute?intent=activity">활동 기록 남기기</Link>
        <label className="search-box">
          <Search size={19} />
          <span className="sr-only">기록 검색</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="불러온 활동에서 찾아보기"
          />
        </label>
        <label className="archive-type-filter">
          <span>활동 형식</span>
          <select value={activeType} onChange={(event) => setActiveType(event.target.value)}>
            {activityTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
      </div>
      <div className="archive-topic-heading">
        <strong>관심 주제</strong>
        <span>활동의 종류가 아니라 기록에서 다루는 이야기예요</span>
      </div>
      <div className="filter-row" role="group" aria-label="관심 주제 필터">
        <button
          aria-pressed={!activeTopic}
          className={!activeTopic ? "active" : ""}
          onClick={() => setActiveTopic(null)}
          type="button"
        >
          전체
        </button>
        {topics.map((topic) => (
          <button
            aria-pressed={activeTopic === topic}
            className={activeTopic === topic ? "active" : ""}
            onClick={() => setActiveTopic(topic)}
            type="button"
            key={topic}
          >
            {topic}
          </button>
        ))}
      </div>
      <section className="resource-collection" aria-labelledby="published-activities-title">
        <div className="resource-collection-heading">
          <div>
            <h2 id="published-activities-title">{audience === "member" ? "활동 기록" : "공개 활동 기록"}</h2>
            <p>{audience === "member" ? "누구나 볼 수 있는 기록과 위브 로그인 이용자에게 공개된 기록을 함께 볼 수 있어요." : "누구나 볼 수 있도록 공개된 활동 기록입니다."}</p>
          </div>
          {publishedState === "loading" && <span>불러오는 중</span>}
        </div>
        {shownPublished.length > 0 ? (
          <motion.div layout className="activity-grid">
            {shownPublished.map((activity) => (
              <div className="archive-activity-entry" key={activity.slug}>
                {activity.visibility === "회원 전용" && <WeaveBadge family="access" tone="restricted" size="compact" className="archive-visibility-badge">{materialVisibilityLabel(activity.visibility)}</WeaveBadge>}
                <ActivityCard activity={activity} />
              </div>
            ))}
          </motion.div>
        ) : publishedState === "loading" ? (
          <div className="resource-status" role="status">공개 활동 기록을 불러오고 있어요.</div>
        ) : publishedState === "error" && publishedActivities.length === 0 ? (
          <div className="resource-status" role="alert">
            공개 활동 기록을 불러오지 못했어요.
            <button type="button" onClick={() => void loadPublishedActivities(null, false)}>다시 시도</button>
          </div>
        ) : (
          <div className="resource-status">현재 조건에 맞는 공개 활동 기록이 없어요.</div>
        )}
        {publishedActivities.length > 0 && publishedState === "error" && (
          <div className="resource-status" role="alert">
            다음 활동 기록을 불러오지 못했어요.
            <button type="button" onClick={() => void loadPublishedActivities(publishedCursor, true)}>다시 시도</button>
          </div>
        )}
        {hasMorePublished && publishedState !== "error" && (
          <div className="resource-status">
            <button
              type="button"
              disabled={isLoadingMore}
              onClick={() => void loadPublishedActivities(publishedCursor, true)}
            >
              {isLoadingMore ? "활동 기록을 불러오는 중" : "활동 기록 더 보기"}
            </button>
          </div>
        )}
      </section>
      {showPublicFixtures && (
      <details className={fixtureStyles.disclosure} open={search.get("examples") === "1"} onToggle={event => {
        const open = event.currentTarget.open;
        if (open !== (search.get("examples") === "1")) updateFilter("examples", open ? "1" : null);
      }}>
      <summary className={fixtureStyles.summary}>활동 기록 예시 <span>{shownFixtures.length}개</span></summary>
      <div className={fixtureStyles.content}>
      <section className="resource-collection fixture-collection" aria-labelledby="fixture-activities-title">
        <h2 className="sr-only" id="fixture-activities-title">활동 기록 예시 목록</h2>
        {shownFixtures.length > 0 ? (
          <motion.div layout className="activity-grid">
            {shownFixtures.map((activity) => (
              <ActivityCard activity={activity} key={activity.slug} />
            ))}
          </motion.div>
        ) : (
          <EmptyState
            onReset={resetFilters}
          />
        )}
      </section>
      </div>
      </details>
      )}
    </PageFrame>
  );
}

export function ActivityPage() {
  const location = useLocation();
  const { state } = location;
  const candidateReturn = state?.archiveReturn;
  const returnTo = typeof candidateReturn === "string" && /^\/(archive|resources)(\?[^#]*)?$/.test(candidateReturn)
    ? candidateReturn : "/archive";
  const { audience, ready: audienceReady } = useFirebaseAudience();
  const { slug } = useParams();
  const fixtureActivity = showPublicFixtures && slug ? getActivity(slug) : undefined;
  const [publishedActivity, setPublishedActivity] = useState<ArchiveActivity>();
  const [publishedMaterials, setPublishedMaterials] = useState<ArchiveMaterial[]>([]);
  const [materialsScope, setMaterialsScope] = useState("");
  const [materialCursor, setMaterialCursor] = useState<ArchiveMaterialCursor | null>(null);
  const [hasMoreMaterials, setHasMoreMaterials] = useState(false);
  const [materialState, setMaterialState] = useState<"loading" | "ready" | "error">(
    () => isFirebaseConfigured ? "loading" : "ready",
  );
  const [isLoadingMoreMaterials, setIsLoadingMoreMaterials] = useState(false);
  const [lookup, setLookup] = useState<{
    slug?: string;
    audience: "public" | "member";
    state: "loading" | "ready" | "error";
  }>(
    () => ({ slug, audience, state: isFirebaseConfigured ? "loading" : "ready" }),
  );
  const requestId = useRef(0);
  const materialRequestId = useRef(0);

  const loadPublishedActivity = useCallback(async () => {
    if (!slug || !isFirebaseConfigured) return;
    const currentRequest = ++requestId.current;
    setLookup({ slug, audience, state: "loading" });
    setPublishedActivity(undefined);
    try {
      const activity = await publishedArchiveRepository.getPublicActivity(slug, { audience });
      if (currentRequest !== requestId.current) return;
      setPublishedActivity(activity);
      setLookup({ slug, audience, state: "ready" });
    } catch {
      if (currentRequest === requestId.current) setLookup({ slug, audience, state: "error" });
    }
  }, [audience, slug]);

  const loadPublishedMaterials = useCallback(async (
    cursor: ArchiveMaterialCursor | null,
    append: boolean,
  ) => {
    if (!slug || !isFirebaseConfigured) return;
    const currentRequest = ++materialRequestId.current;
    if (append) setIsLoadingMoreMaterials(true);
    else {
      setMaterialState("loading");
      setPublishedMaterials([]);
      setMaterialCursor(null);
      setHasMoreMaterials(false);
    }
    try {
      const [page, parent] = await Promise.all([
        publishedArchiveRepository.listPublicActivityMaterialsPage(slug, {cursor, pageSize: 24, audience}),
        publishedArchiveRepository.getPublicActivity(slug, { audience }),
      ]);
      const reused = parent ? await publishedArchiveRepository.listLinkedMaterials(parent, { audience }) : [];
      const readableItems = parent ? [...new Map([...page.items, ...reused].map((item) => [item.id, item])).values()] : [];
      if (currentRequest !== materialRequestId.current) return;
      setMaterialsScope(`${slug}:${audience}`);
      setPublishedMaterials((current) => {
        if (!append) return readableItems;
        const merged = new Map(current.map((item) => [item.id, item]));
        readableItems.forEach((item) => merged.set(item.id, item));
        return [...merged.values()];
      });
      setMaterialCursor(page.nextCursor);
      setHasMoreMaterials(page.hasMore);
      setMaterialState("ready");
    } catch {
      if (currentRequest === materialRequestId.current) setMaterialState("error");
    } finally {
      if (currentRequest === materialRequestId.current) setIsLoadingMoreMaterials(false);
    }
  }, [audience, slug]);

  useEffect(() => {
    if (!slug || !isFirebaseConfigured || !audienceReady) return;
    void Promise.resolve().then(loadPublishedActivity);
    void Promise.resolve().then(() => loadPublishedMaterials(null, false));
    return () => {
      requestId.current += 1;
      materialRequestId.current += 1;
    };
  }, [audienceReady, loadPublishedActivity, loadPublishedMaterials, slug]);

  const lookupState = lookup.slug === slug && lookup.audience === audience
    ? lookup.state
    : isFirebaseConfigured ? "loading" : "ready";
  const visiblePublishedActivity = publishedActivity
    && audienceReady
    && publishedActivity.slug === slug
    && (audience === "member" || publishedActivity.visibility === "공개")
    ? publishedActivity
    : undefined;
  const activity = visiblePublishedActivity ?? fixtureActivity;
  const linkedMaterials = useMemo(() => {
    const fixtures = activity && fixtureActivity
      ? getActivityMaterials(activity.slug).filter(
          (material) => audience === "member" || material.visibility === "공개",
        )
      : [];
    const merged = new Map<string, ArchiveMaterial | Material>(
      publishedMaterials
        .filter(() => audienceReady && materialsScope === `${slug}:${audience}`)
        .filter((material) => audience === "member" || material.visibility === "공개")
        .map((material) => [material.id, material]),
    );
    fixtures.forEach((material) => {
      if (!merged.has(material.id)) merged.set(material.id, material);
    });
    return [...merged.values()];
  }, [activity, audience, audienceReady, fixtureActivity, materialsScope, publishedMaterials, slug]);

  if (!activity && lookupState === "loading") {
    return (
      <PageFrame eyebrow="활동 기록" title="활동 기록을 불러오고 있어요" description="잠시만 기다려 주세요.">
        <div className="resource-status" role="status">공개 활동 기록을 확인하고 있어요.</div>
      </PageFrame>
    );
  }
  if (!activity && lookupState === "error") {
    return (
      <PageFrame eyebrow="활동 기록" title="활동 기록을 불러오지 못했어요" description="연결 상태를 확인한 뒤 다시 시도해 주세요.">
        <div className="resource-status" role="alert">
          <button type="button" onClick={() => void loadPublishedActivity()}>다시 시도</button>
        </div>
      </PageFrame>
    );
  }
  if (visiblePublishedActivity?.materialRedirectId) return <Navigate replace to={`/materials/${encodeURIComponent(visiblePublishedActivity.materialRedirectId)}`} state={{returnTo}} />;
  if (!activity) return <NotFoundPage />;
  const isFixtureActivity = !visiblePublishedActivity && Boolean(fixtureActivity);
  const instagramAttachments = visiblePublishedActivity?.instagramAttachments ?? [];
  return (
    <article className="detail-page section-frame">
      <Link className="back-link" to={returnTo}>
        <ArrowLeft size={17} /> {returnTo.startsWith("/resources") ? "자료 나눔으로 돌아가기" : "활동 기록으로 돌아가기"}
      </Link>
      <div className={`detail-hero ${activity.tone}`}>
        <div className="detail-hero-copy">
          {isFixtureActivity && <WeaveBadge family="provenance" tone="fixture" size="compact">예시</WeaveBadge>}
          <p className="detail-topic">
            {[activity.topic, activity.type, "visibility" in activity && activity.visibility === "회원 전용" ? "위브 로그인 이용자에게 공개" : ""].map((value) => value.trim()).filter(Boolean).join(" · ")}
          </p>
          <h1>{activity.title}</h1>
          <p>{sentence(activity.summary)}</p>
        </div>
      </div>
      {visiblePublishedActivity && <>
        <OwnedSubmissionActions id={visiblePublishedActivity.id ?? visiblePublishedActivity.slug} returnTo={returnTo} kind="activity" />
        <Link className="button button-secondary" to={`/archive-relations/new?targetType=activity&targetId=${encodeURIComponent(visiblePublishedActivity.id ?? visiblePublishedActivity.slug)}&returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`}>이 기록을 행사에 연결</Link>
      </>}
      <div className="detail-layout">
        <section>
          <h2>활동 이야기</h2>
          {'textContent' in activity && readTextContent(activity.textContent) ? <MarkdownBody format={readTextContent(activity.textContent)!.format} body={readTextContent(activity.textContent)!.body} /> : <p>{sentence(activity.story)}</p>}
          {activity.outcome.trim() && <div className="outcome">
            <strong>남긴 결과</strong>
            <span>{sentence(activity.outcome)}</span>
          </div>}
        </section>
        <aside className="detail-meta" aria-label="활동 기록 정보">
          <dl className="activity-facts">
            {!isFixtureActivity && activity.date && (
              <div>
                <dt><CalendarDays size={16} /> 날짜</dt>
                <dd>{activity.date}</dd>
              </div>
            )}
            {!isFixtureActivity && activity.place && (
              <div>
                <dt><FolderOpen size={16} /> 장소</dt>
                <dd>{activity.place}</dd>
              </div>
            )}
            <div>
              <dt>활동 형식</dt>
              <dd>{activity.type.trim() || "미분류"}</dd>
            </div>
            <div>
              <dt>관심 주제</dt>
              <dd>{activity.topic.trim() || "미분류"}</dd>
            </div>
            <div>
              <dt>공개 범위</dt>
              <dd>{materialVisibilityLabel(visiblePublishedActivity?.visibility ?? "공개")}</dd>
            </div>
            <div>
              <dt>작성자·주최</dt>
              <dd>{visiblePublishedActivity ? visiblePublishedActivity.owner || "작성자 정보 없음" : "둘러보기 예시"}</dd>
            </div>
            {(!visiblePublishedActivity || visiblePublishedActivity.attribution || visiblePublishedActivity.source) && <div>
              <dt>출처</dt>
              <dd>{visiblePublishedActivity?.attribution || visiblePublishedActivity?.source || "둘러보기 예시"}</dd>
            </div>}
            {visiblePublishedActivity?.updatedAt && (
              <div>
                <dt>최근 수정</dt>
                <dd>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(visiblePublishedActivity.updatedAt)}</dd>
              </div>
            )}
          </dl>
          {activity.nextAction && (
            <div className="activity-next-action">
              <strong>다음에 해볼 일</strong>
              <span>{activity.nextAction}</span>
            </div>
          )}
        </aside>
      </div>
      {activity.recipe && (
        <section className="recipe-panel">
          <div>
            <p className="detail-topic">활동 레시피</p>
            <h2>우리 지역에서 시작하기</h2>
          </div>
          <dl>
            <div>
              <dt>목적</dt>
              <dd>{sentence(activity.recipe.purpose)}</dd>
            </div>
            <div>
              <dt>준비</dt>
              <dd>{sentence(activity.recipe.preparation)}</dd>
            </div>
            <div>
              <dt>홍보</dt>
              <dd>{sentence(activity.recipe.promotion)}</dd>
            </div>
            <div>
              <dt>다음 활동에 참고할 점</dt>
              <dd>{sentence(activity.recipe.lessons)}</dd>
            </div>
          </dl>
        </section>
      )}
      <InstagramReferenceList attachments={instagramAttachments} />
      <section className="linked-materials">
        <div className="section-heading">
          <h2>관련 자료</h2>
        </div>
        <div className="materials-list">
          {linkedMaterials.map((material) => (
            <MaterialRow key={material.id} material={material} />
          ))}
        </div>
        {materialState === "ready" && linkedMaterials.length === 0 && (
          <div className="resource-status">아직 이 활동에 연결된 자료가 없어요.</div>
        )}
        {materialState === "loading" && (
          <div className="resource-status" role="status">연결된 자료를 불러오고 있어요</div>
        )}
        {materialState === "error" && (
          <div className="resource-status" role="alert">
            <span>연결된 자료를 불러오지 못했어요</span>
            <button type="button" onClick={() => void loadPublishedMaterials(materialCursor, publishedMaterials.length > 0)}>
              다시 시도
            </button>
          </div>
        )}
        {materialState === "ready" && hasMoreMaterials && (
          <div className="resource-status">
            <button
              type="button"
              disabled={isLoadingMoreMaterials}
              aria-busy={isLoadingMoreMaterials}
              onClick={() => void loadPublishedMaterials(materialCursor, true)}
            >
              {isLoadingMoreMaterials ? "자료를 불러오는 중" : "자료 더 보기"}
            </button>
          </div>
        )}
      </section>
    </article>
  );
}
