import { FEEDBACK_MARKER, FEEDBACK_PREFIX, launchFeedbackBody } from "../feedback/launch-feedback-model";
import { useLocation } from "react-router-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  LoaderCircle,
  MessageCircleMore,
  PencilLine,
  Search,
  ShieldCheck,
} from "lucide-react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { callableWriteErrorMessage } from "../../lib/firebase/callable-write-error";
import { useReducedMotion } from "motion/react";
import {
  getFirebaseServices,
  isOAuthConfigured,
} from "../../lib/firebase/client";
import { acceptTerms, startOAuthLogin } from "../auth/api";
import { ProviderLoginButton } from "../auth/ProviderLoginButton";
import {
  communityApi,
  communityPostPurposes,
  parseCommunityPostPurpose,
  type CommunityPostPurpose,
} from "./api";
import {
  PostThread,
  type CommunityPostView,
} from "./PostThread";
import {
  communityFixturePosts,
  type CommunityFixturePost,
} from "./community-fixtures";
import { parseCommunityLoginProvider } from "./provider";
import { showPublicFixtures } from "../../config/public-fixtures";
import { CommunityCaseCenter } from "./CommunityCaseCenter";
import { DraftRecoveryPanel } from "../drafts/DraftRecoveryPanel";
import { useFormDraft } from "../drafts/useFormDraft";
import {
  communityArticleDraftCodec,
  communityDraftAttemptIsCurrent,
  communityDraftIdentity,
  communityDraftSubmissionCapture,
  type CommunityArticleDraft,
} from "./community-draft";
import {
  applyComposerHint,
  conversationStarterHints,
  type ComposerHint,
} from "./composer-intent";

const topics = [
  "나와 마음",
  "관계와 공동체",
  "일과 진로",
  "배움과 신앙",
  "사회와 실천",
];
const currentTermsVersion = "2026-07-20";
const currentCommunityRulesVersion = "2026-07-20";
const postPageSize = 30;
type CommunityPostItem = CommunityPostView & {
  createdAtMs: number;
};

function postView(
  item: QueryDocumentSnapshot<DocumentData>,
): CommunityPostItem {
  const data = item.data();
  return {
    id: item.id,
    body: String(data.body ?? ""),
    topic: typeof data.topic === "string" && data.topic.trim() ? data.topic.trim() : undefined,
    purpose: parseCommunityPostPurpose(data.purpose),
    pseudonym: String(data.pseudonym ?? ""),
    provider: parseCommunityLoginProvider(data.provider),
    commentCount: Number(data.commentCount ?? 0),
    createdAtMs:
      typeof data.createdAt?.toMillis === "function"
        ? Number(data.createdAt.toMillis())
        : 0,
  };
}

function Gate({ configured }: { configured: boolean }) {
  return (
    <section className="page-frame section-frame">
      <div className="page-intro">
        <p>자유 대화 공간</p>
        <h1>
          자유롭게
          <br /> 의견을 나눠요
        </h1>
        <div className="page-intro-rule" />
        <span>
          요즘의 고민과 직접 겪으며 알게 된 이야기를 편하게 나눠 보세요. 다른
          이용자에게는 별명과 로그인 경로만 보입니다.
        </span>
      </div>
      <section className="community-gate">
        <div className="gate-orbits" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="gate-copy">
          <p>커뮤니티 참여 안내</p>
          <h2>커뮤니티에 참여하려면</h2>
          <span>
            어떤 방식으로 로그인했는지는 별명 옆 아이콘으로 표시됩니다. 계정
            정보는 가입 확인과 신고 처리에만 사용합니다.
          </span>
          <div className="gate-steps">
            <b>카카오·네이버 로그인</b>
            <b>별명 정하기</b>
            <b>생각 나누기</b>
          </div>
          <div className="community-login-actions">
            <ProviderLoginButton
              disabled={!configured}
              onClick={() => startOAuthLogin("kakao", "/community")}
              provider="kakao"
            />
            <ProviderLoginButton
              disabled={!configured}
              onClick={() => startOAuthLogin("naver", "/community")}
              provider="naver"
            />
          </div>
          <small>
            {configured
              ? "로그인한 뒤 이용 안내를 확인하고 별명을 정해 주세요."
              : "로그인 연결을 준비하고 있어요."}
          </small>
        </div>
      </section>
    </section>
  );
}

function CommunityFixtureBoard({
  posts,
  onChoose,
}: {
  posts: CommunityFixturePost[];
  onChoose: (post: CommunityFixturePost) => void;
}) {
  return (
    <div className="community-fixture-board">
      <header>
        <div>
          <p>둘러보기 예시</p>
          <h3>이런 이야기를 나눌 수 있어요</h3>
        </div>
        <span>
          실제 게시글이 아니라 위브에서 이어질 수 있는 대화를 보여 주는 예시입니다.
        </span>
      </header>
      <div className="community-fixture-grid">
        {posts.map((post) => (
          <article key={post.id}>
            <div className="community-fixture-labels">
              <b>{post.purpose}</b>
              <span>{post.topic}</span>
            </div>
            <p>{post.body}</p>
            <footer>
              <strong>{post.pseudonym}</strong>
              <span>둘러보기 예시</span>
            </footer>
            <aside>
              <b>이어질 수 있는 답글</b>
              <p>{post.response}</p>
            </aside>
            <button type="button" onClick={() => onChoose(post)}>
              이 주제로 글쓰기 <ArrowRight size={16} aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

export function CommunityExperience() {
  const reduceMotion = useReducedMotion();
  const services = useMemo(() => getFirebaseServices(), []);
  const [user, setUser] = useState<User | null>(
    () => services?.auth.currentUser ?? null,
  );
  const [accountLoading, setAccountLoading] = useState(Boolean(services?.auth.currentUser));
  const [accountError, setAccountError] = useState("");
  const [accountRetry, setAccountRetry] = useState(0);
  const [pseudonym, setPseudonym] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [rulesChecked, setRulesChecked] = useState(false);
  const [draftPseudonym, setDraftPseudonym] = useState("");
  const [topic, setTopic] = useState("");
  const [purpose, setPurpose] = useState<CommunityPostPurpose>("생각 나눔");
  const [body, setBody] = useState("");
  const [composerHint, setComposerHint] = useState("");
  const [search, setSearch] = useState("");
  const [purposeFilter, setPurposeFilter] = useState<CommunityPostPurpose | "모든 이야기">("모든 이야기");
  const [topicFilter, setTopicFilter] = useState("전체");
  const [sort, setSort] = useState<"recent" | "comments">("recent");
  const [recentPosts, setRecentPosts] = useState<CommunityPostItem[]>([]);
  const [olderPosts, setOlderPosts] = useState<CommunityPostItem[]>([]);
  const [recentCursor, setRecentCursor] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [olderCursor, setOlderCursor] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasOlderPosts, setHasOlderPosts] = useState(false);
  const [loadingOlderPosts, setLoadingOlderPosts] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [feedErrorSource, setFeedErrorSource] = useState<
    "recent" | "older" | null
  >(null);
  const [feedRetry, setFeedRetry] = useState(0);
  const hasLoadedOlderPosts = useRef(false);
  const { search: routeSearch } = useLocation();
  const feedbackMode = new URLSearchParams(routeSearch).get("feedback") === "launch";
  const bodyLimit = feedbackMode ? 2000 - FEEDBACK_PREFIX.length : 2000;
  const [composerOpen, setComposerOpen] = useState(() => new URLSearchParams(window.location.search).get("compose") === "1");
  useEffect(() => {
    if (new URLSearchParams(routeSearch).get("compose") === "1") queueMicrotask(() => setComposerOpen(true));
  }, [routeSearch]);
  const composerTriggerRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [ownershipState, setOwnershipState] = useState<{
    key: string;
    ids: Set<string>;
    hiddenIds: Set<string>;
    error: boolean;
    canManageAll: boolean;
  }>({ key: "", ids: new Set(), hiddenIds: new Set(), error: false, canManageAll: false });
  const [ownershipRetry, setOwnershipRetry] = useState(0);
  const previousComposerOwner = useRef(user?.uid ?? null);
  const composerOwnerRef = useRef(user?.uid ?? null);
  const composerGenerationRef = useRef(0);
  const articleDraftValue = useMemo<CommunityArticleDraft>(
    () => ({ purpose, topic, body }),
    [body, purpose, topic],
  );
  const articleDraftValueRef = useRef(articleDraftValue);
  const articleDraftIdentity = useMemo(
    () => communityDraftIdentity({ ownerId: user?.uid ?? "signed-out", mode: "article" }),
    [user?.uid],
  );
  const articleDraft = useFormDraft({
    identity: articleDraftIdentity,
    value: articleDraftValue,
    codec: communityArticleDraftCodec,
    active: Boolean(user) && !accountLoading,
    onRestore: (restored) => {
      setPurpose(restored.purpose);
      setTopic(restored.topic);
      setBody(restored.body);
      setComposerHint("");
    },
  });

  useLayoutEffect(() => {
    composerOwnerRef.current = user?.uid ?? null;
    articleDraftValueRef.current = articleDraftValue;
  }, [articleDraftValue, user?.uid]);
  const posts = useMemo(() => {
    const unique = new Map<string, CommunityPostItem>();
    [...olderPosts, ...recentPosts].forEach((post) =>
      unique.set(post.id, post),
    );
    return [...unique.values()].sort(
      (left, right) =>
        right.createdAtMs - left.createdAtMs ||
        right.id.localeCompare(left.id),
    );
  }, [olderPosts, recentPosts]);
  const visiblePosts = useMemo(() => {
    if (ownershipState.error) return [];
    const keyword = search.trim().toLocaleLowerCase("ko-KR");
    const filtered = posts.filter((post) => {
      if (ownershipState.hiddenIds.has(post.id)) return false;
      const matchesPurpose =
        purposeFilter === "모든 이야기" || post.purpose === purposeFilter;
      const matchesTopic = topicFilter === "전체" || post.topic === topicFilter;
      const matchesSearch =
        !keyword ||
        post.body.toLocaleLowerCase("ko-KR").includes(keyword) ||
        post.pseudonym.toLocaleLowerCase("ko-KR").includes(keyword);
      return matchesPurpose && matchesTopic && matchesSearch;
    });
    return [...filtered].sort((left, right) =>
      sort === "comments"
        ? right.commentCount - left.commentCount || right.createdAtMs - left.createdAtMs
        : right.createdAtMs - left.createdAtMs,
    );
  }, [ownershipState.error, ownershipState.hiddenIds, posts, purposeFilter, search, sort, topicFilter]);
  const visibleFixturePosts = useMemo(() => {
    if (!showPublicFixtures) return [];
    const keyword = search.trim().toLocaleLowerCase("ko-KR");
    return communityFixturePosts.filter((post) => {
      const matchesPurpose =
        purposeFilter === "모든 이야기" || post.purpose === purposeFilter;
      const matchesTopic = topicFilter === "전체" || post.topic === topicFilter;
      const matchesSearch =
        !keyword ||
        post.body.toLocaleLowerCase("ko-KR").includes(keyword) ||
        post.pseudonym.toLocaleLowerCase("ko-KR").includes(keyword);
      return matchesPurpose && matchesTopic && matchesSearch;
    });
  }, [purposeFilter, search, topicFilter]);
  const postIdKey = useMemo(
    () => posts.map((post) => post.id).sort().join("\u0000"),
    [posts],
  );
  const ownershipLoading = Boolean(postIdKey) && ownershipState.key !== postIdKey;

  useEffect(() => {
    if (!services) return undefined;
    return onAuthStateChanged(services.auth, (nextUser) => {
      const nextOwner = nextUser?.uid ?? null;
      if (previousComposerOwner.current !== nextOwner) {
        composerGenerationRef.current += 1;
        setPseudonym(null);
        setTermsAccepted(false);
        setPurpose("생각 나눔");
        setTopic("");
        setBody("");
        setComposerHint("");
        setNotice("");
        setWorking(false);
        previousComposerOwner.current = nextOwner;
      }
      setRecentPosts([]);
      setOlderPosts([]);
      setRecentCursor(null);
      setOlderCursor(null);
      setHasOlderPosts(false);
      setFeedError("");
      setFeedErrorSource(null);
      setFeedLoading(Boolean(nextUser));
      setAccountError("");
      setOwnershipState({ key: "", ids: new Set(), hiddenIds: new Set(), error: false, canManageAll: false });
      hasLoadedOlderPosts.current = false;
      setUser(nextUser);
      if (!nextUser) {
        setPseudonym(null);
        setTermsAccepted(false);
        setAccountLoading(false);
      } else {
        setAccountLoading(true);
      }
    });
  }, [services]);

  useEffect(() => {
    if (!services || !user) return undefined;
    let active = true;
    void getDoc(doc(services.firestore, "users", user.uid))
      .then((snapshot) => {
        if (!active) return;
        const data = snapshot.data();
        setAccountError("");
        setPseudonym(typeof data?.pseudonym === "string" ? data.pseudonym : null);
        setTermsAccepted(
          data?.termsVersion === currentTermsVersion &&
            data?.communityRulesVersion === currentCommunityRulesVersion,
        );
      })
      .catch(() => {
        if (active) setAccountError("참여 정보를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
      })
      .finally(() => {
        if (active) setAccountLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountRetry, services, user]);

  useEffect(() => {
    if (!postIdKey) {
      return undefined;
    }
    let active = true;
    const postIds = postIdKey.split("\u0000");
    const chunks = Array.from(
      { length: Math.ceil(postIds.length / 50) },
      (_, index) => postIds.slice(index * 50, (index + 1) * 50),
    );
    void Promise.all(chunks.map((ids) => communityApi.ownership({ postIds: ids })))
      .then((results) => {
        if (!active) return;
        setOwnershipState({
          key: postIdKey,
          ids: new Set(results.flatMap((result) => result.postIds)),
          hiddenIds: new Set(results.flatMap((result) => result.hiddenPostIds)),
          error: false,
          canManageAll: results.some((result) => result.canManageAll),
        });
      })
      .catch(() => {
        if (active) setOwnershipState({ key: postIdKey, ids: new Set(), hiddenIds: new Set(), error: true, canManageAll: false });
      });
    return () => {
      active = false;
    };
  }, [ownershipRetry, postIdKey]);

  useEffect(() => {
    if (!services || !user || !termsAccepted || !pseudonym) {
      return undefined;
    }
    return onSnapshot(
      query(
        collection(services.firestore, "communityPosts"),
        where("status", "==", "active"),
        orderBy("createdAt", "desc"),
        limit(postPageSize),
      ),
      (snapshot) => {
        setRecentPosts(snapshot.docs.map(postView));
        setRecentCursor(snapshot.docs.at(-1) ?? null);
        if (!hasLoadedOlderPosts.current) {
          setHasOlderPosts(snapshot.size === postPageSize);
        }
        setFeedError("");
        setFeedErrorSource(null);
        setFeedLoading(false);
      },
      () => {
        setFeedError(
          "커뮤니티 글을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
        );
        setFeedErrorSource("recent");
        setFeedLoading(false);
      },
    );
  }, [feedRetry, pseudonym, services, termsAccepted, user]);

  if (!services || !user) {
    return <Gate configured={Boolean(services) && isOAuthConfigured} />;
  }

  const confirmTerms = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!termsChecked || !rulesChecked) return;
    setWorking(true);
    setNotice("");
    try {
      await acceptTerms(currentTermsVersion, currentCommunityRulesVersion);
      setTermsAccepted(true);
      setNotice("이용 동의를 확인했어요. 이제 사용할 별명을 정해 주세요.");
    } catch {
      setNotice("동의 내용을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setWorking(false);
    }
  };

  const createPseudonym = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking(true);
    setNotice("");
    try {
      const create = httpsCallable<
        { pseudonym: string },
        { pseudonym: string }
      >(services.functions, "createOrRotatePseudonym");
      const { data } = await create({ pseudonym: draftPseudonym });
      setPseudonym(data.pseudonym);
      setNotice("별명을 저장했어요. 이제 글과 댓글을 남길 수 있어요.");
    } catch {
      setNotice("별명을 정하지 못했어요. 다른 이름으로 다시 시도해 주세요.");
    } finally {
      setWorking(false);
    }
  };

  const createPost = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedOwner = user?.uid;
    const submittedValue = { ...articleDraftValueRef.current };
    const submissionCapture = communityDraftSubmissionCapture(articleDraft.capture());
    if (submittedValue.body.trim().length < 2 || submittedValue.body.length > bodyLimit) {
      setNotice(`내용을 2~${bodyLimit.toLocaleString("ko-KR")}자로 적어 주세요.`);
      composerRef.current?.focus();
      return;
    }
    if (!submittedOwner) {
      setNotice("로그인 상태를 확인한 뒤 다시 시도해 주세요.");
      return;
    }
    const submittedAttempt = {
      identity: articleDraftIdentity,
      generation: composerGenerationRef.current,
    };
    setWorking(true);
    setNotice(submissionCapture.localSaveUnavailable
      ? "이 기기의 임시저장을 확인하지 못했지만 글 등록을 계속하고 있어요."
      : "");
    try {
      await communityApi.createPost({
        body: launchFeedbackBody(submittedValue.body, feedbackMode),
        topic: submittedValue.topic || null,
        purpose: submittedValue.purpose,
      });
      const currentOwner = composerOwnerRef.current;
      const completionIsCurrent = communityDraftAttemptIsCurrent(
        submittedAttempt,
        currentOwner
          ? {
              identity: communityDraftIdentity({ ownerId: currentOwner, mode: "article" }),
              generation: composerGenerationRef.current,
            }
          : null,
      );
      const completed = completionIsCurrent && submissionCapture.revision
        ? articleDraft.complete(
            submissionCapture.revision,
            { purpose: "생각 나눔", topic: "", body: "" },
          )
        : "unavailable";
      const current = articleDraftValueRef.current;
      if (
        completed === "cleared"
        && currentOwner === submittedOwner
        && current.body === submittedValue.body
        && current.topic === submittedValue.topic
        && current.purpose === submittedValue.purpose
      ) {
        setPurpose("생각 나눔");
        setTopic("");
        setBody("");
        setComposerHint("");
      }
      if (completionIsCurrent) {
        setNotice(submissionCapture.localSaveUnavailable
          ? "생각을 남겼어요. 이 기기의 임시저장은 지우지 않았어요."
          : "생각을 남겼어요.");
      }
    } catch (error) {
      const currentOwner = composerOwnerRef.current;
      if (communityDraftAttemptIsCurrent(
        submittedAttempt,
        currentOwner
          ? {
              identity: communityDraftIdentity({ ownerId: currentOwner, mode: "article" }),
              generation: composerGenerationRef.current,
            }
          : null,
      )) {
        const reason = callableWriteErrorMessage(error, "커뮤니티 글");
        setNotice(submissionCapture.localSaveUnavailable
          ? `${reason} 이 기기의 임시저장도 확인하지 못했어요. 내용을 복사해 두세요.`
          : reason);
      }
    } finally {
      const currentOwner = composerOwnerRef.current;
      if (communityDraftAttemptIsCurrent(
        submittedAttempt,
        currentOwner
          ? {
              identity: communityDraftIdentity({ ownerId: currentOwner, mode: "article" }),
              generation: composerGenerationRef.current,
            }
          : null,
      )) setWorking(false);
    }
  };

  const chooseComposerHint = (selection: ComposerHint) => {
    const next = applyComposerHint(
      { body, purpose, topic, hint: composerHint },
      selection,
    );
    setBody(next.body);
    setPurpose(next.purpose);
    setTopic(next.topic);
    setComposerHint(next.hint);
    setComposerOpen(true);
    requestAnimationFrame(() => {
    composerRef.current?.focus({ preventScroll: true });
    composerRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
    });
  };

  const loadOlderPosts = async () => {
    const cursor = olderCursor ?? recentCursor;
    if (!cursor || loadingOlderPosts) return;
    setLoadingOlderPosts(true);
    setFeedError("");
    setFeedErrorSource(null);
    try {
      const snapshot = await getDocs(
        query(
          collection(services.firestore, "communityPosts"),
          where("status", "==", "active"),
          orderBy("createdAt", "desc"),
          startAfter(cursor),
          limit(postPageSize),
        ),
      );
      setOlderPosts((current) => {
        const unique = new Map(current.map((post) => [post.id, post]));
        snapshot.docs.map(postView).forEach((post) => unique.set(post.id, post));
        return [...unique.values()];
      });
      hasLoadedOlderPosts.current = true;
      setOlderCursor(snapshot.docs.at(-1) ?? cursor);
      setHasOlderPosts(snapshot.size === postPageSize);
    } catch {
      setFeedError(
        "이전 글을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      );
      setFeedErrorSource("older");
    } finally {
      setLoadingOlderPosts(false);
    }
  };

  return (
    <section className="page-frame section-frame">
      <div className="page-intro">
        <p>자유 대화 공간</p>
        <h1>
          자유롭게
          <br /> 의견을 나눠요
        </h1>
        <div className="page-intro-rule" />
        <span>궁금한 점이나 요즘의 고민, 직접 겪으며 알게 된 이야기를 편하게 나눠 보세요.</span>
      </div>
      {accountLoading ? (
        <div className="community-empty" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={27} aria-hidden="true" />
          <h2>참여 정보를 불러오는 중이에요</h2>
        </div>
      ) : accountError ? (
        <div className="community-empty community-account-error" role="alert">
          <MessageCircleMore size={27} aria-hidden="true" />
          <h2>참여 정보를 확인하지 못했어요</h2>
          <p>{accountError}</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              setAccountError("");
              setAccountLoading(true);
              setAccountRetry((value) => value + 1);
            }}
          >
            다시 시도하기
          </button>
        </div>
      ) : !termsAccepted ? (
        <form className="community-terms" onSubmit={confirmTerms}>
          <ShieldCheck size={30} aria-hidden="true" />
          <div>
            <h2>커뮤니티 이용 전 확인해 주세요</h2>
            <p>
              로그인 계정은 다른 이용자에게 공개되지 않습니다. 계정 정보는 가입
              확인과 신고 처리에만 사용합니다.
            </p>
          </div>
          <label>
            <input
              required
              type="checkbox"
              checked={termsChecked}
              onChange={(event) => setTermsChecked(event.target.checked)}
            />
            <span>
              <a href="/policies/terms">서비스 이용약관</a>과{" "}
              <a href="/policies/privacy">개인정보 처리 안내</a>를 확인했습니다.
            </span>
          </label>
          <label>
            <input
              required
              type="checkbox"
              checked={rulesChecked}
              onChange={(event) => setRulesChecked(event.target.checked)}
            />
            <span>
              <a href="/policies/community">
                서로를 특정하거나 해치지 않는 커뮤니티 규칙
              </a>
              에 동의합니다.
            </span>
          </label>
          <button
            className="button button-primary"
            disabled={working || !termsChecked || !rulesChecked}
            type="submit"
          >
            {working ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ArrowRight size={18} />
            )}{" "}
            동의하고 계속하기
          </button>
          {notice && <p className="community-notice">{notice}</p>}
        </form>
      ) : !pseudonym ? (
        <form className="pseudonym-setup" onSubmit={createPseudonym}>
          <div className="pseudonym-setup-copy">
            <span>마지막 단계</span>
            <h2>커뮤니티에서 사용할 별명을 정해 주세요</h2>
            <p>
              다른 이용자에게는 별명과 로그인 경로만 보입니다. 한 번 정한 별명은
              90일 뒤에 바꿀 수 있어요.
            </p>
          </div>
          <div className="pseudonym-setup-actions">
            <label>
              <span>사용할 별명</span>
              <input
                required
                minLength={2}
                maxLength={18}
                value={draftPseudonym}
                onChange={(event) => setDraftPseudonym(event.target.value)}
                placeholder="예: 맑은바람"
              />
              <small>한글, 영문, 숫자로 2~18자</small>
            </label>
            <button
              className="button button-primary"
              disabled={working}
              type="submit"
            >
              이 이름으로 시작하기 <ArrowRight size={18} />
            </button>
          </div>
          {notice && <p className="community-notice">{notice}</p>}
        </form>
      ) : (
        <div className="community-live">
          <section className="community-board-heading" aria-labelledby="community-board-title">
            <div>
              <p>함께 나누는 이야기</p>
              <h2 id="community-board-title">요즘 위브에서는</h2>
            </div>
            <div className="community-board-tools">
              <button ref={composerTriggerRef} className="button button-primary" type="button" aria-expanded={composerOpen} aria-controls="community-composer" onClick={() => {
                setComposerOpen(!composerOpen);
                if (!composerOpen) requestAnimationFrame(() => composerRef.current?.focus());
              }}><PencilLine size={18} aria-hidden="true" />{composerOpen ? "작성 잠시 접기" : "이야기 남기기"}</button>
              <label className="community-search">
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">글 검색</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="글 내용이나 이름으로 찾아보기"
                />
              </label>
              <label>
                <span className="sr-only">정렬</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                  <option value="recent">최신순</option>
                  <option value="comments">댓글 많은 순</option>
                </select>
              </label>
              <label>
                <span className="sr-only">관심 주제</span>
                <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
                  <option value="전체">모든 주제</option>
                  {topics.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
            </div>
          </section>

          <form id="community-composer" hidden={!composerOpen} className="community-composer" onSubmit={createPost}>
            {feedbackMode && <div className="community-feedback-context" role="region" aria-label="위브 이용 피드백 작성"><strong>위브를 써본 이야기를 들려주세요</strong><p>좋았던 점, 불편했던 점, 있으면 좋을 기능을 적어주세요. 글에는 ‘위브 피드백’ 말머리가 붙습니다.</p><button className="button button-ghost" type="button" onClick={() => { setSearch(FEEDBACK_MARKER); setComposerOpen(false); composerTriggerRef.current?.focus(); }}>다른 피드백 보고 댓글 남기기</button></div>}
            <DraftRecoveryPanel
              state={articleDraft.state}
              recovery={articleDraft.recovery}
              onContinue={articleDraft.continueDraft}
              onStartNew={() => {
                articleDraft.startNew({ purpose: "생각 나눔", topic: "", body: "" });
                setPurpose("생각 나눔");
                setTopic("");
                setBody("");
                setComposerHint("");
              }}
              onDelete={() => {
                articleDraft.deleteDraft({ purpose: "생각 나눔", topic: "", body: "" });
                setPurpose("생각 나눔");
                setTopic("");
                setBody("");
                setComposerHint("");
              }}
              onRetry={articleDraft.retry}
            />
            <div className="composer-top">
              <span>
                <PencilLine size={16} /> 의견 남기기
              </span>
              <label className="community-purpose-select">
                <span>글의 성격</span>
                <select
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value as CommunityPostPurpose)}
                >
                  {communityPostPurposes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
            <textarea
              ref={composerRef}
              aria-label="작성할 이야기"
              aria-describedby="community-composer-hint community-composer-safety community-composer-length"
              required
              minLength={2}
              maxLength={bodyLimit}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={composerHint || "요즘 마음에 남은 일이나 다른 사람과 나누고 싶은 경험을 적어 주세요"}
            />
            <small id="community-composer-length">2~{bodyLimit.toLocaleString('ko-KR')}자 · 현재 {body.length.toLocaleString('ko-KR')}자</small>
            <small id="community-composer-hint" role="status" aria-live="polite">
              {composerHint
                ? `글감 도움 · ${composerHint}`
                : "예시를 골라도 작성 중인 내용은 그대로 유지돼요"}
            </small>
            <details className="community-topic-disclosure">
              <summary>{topic ? `관심 주제 · ${topic}` : "관심 주제도 덧붙일까요"}</summary>
              <label>
                <span>관심 주제</span>
                <select value={topic} onChange={(event) => setTopic(event.target.value)}>
                  <option value="">선택하지 않음</option>
                  {topics.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <small>글을 찾기 쉽게 돕는 선택 정보예요</small>
              </label>
            </details>
            <div>
              <small id="community-composer-safety">
                이름이나 연락처처럼 개인을 알아볼 수 있는 내용은 적지 말아 주세요.
              </small>
              <button
                className="button button-primary"
                disabled={working}
                type="submit"
              >
                {working ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <ArrowRight size={18} />
                )}{" "}
                글 올리기
              </button>
            </div>
          </form>
          {notice && <p className="community-notice" role="status">{notice}</p>}
          <div className="community-purpose-filters" aria-label="글의 성격 필터" role="group">
            {(["모든 이야기", ...communityPostPurposes] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={purposeFilter === item}
                onClick={() => setPurposeFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {ownershipState.error && (
            <div className="community-notice community-ownership-error" role="alert">
              <span>글 관리 권한을 확인하지 못했어요</span>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setOwnershipState((current) => ({ ...current, key: "", error: false }));
                  setOwnershipRetry((value) => value + 1);
                }}
              >
                다시 시도하기
              </button>
            </div>
          )}
          <section
            className="community-feed"
            aria-label="커뮤니티 글 목록"
          >
            {feedLoading || ownershipLoading ? (
              <div className="community-empty" role="status" aria-live="polite">
                <LoaderCircle className="spin" size={27} aria-hidden="true" />
                <h2>{ownershipLoading ? "숨김 설정을 적용하고 있어요" : "이야기를 불러오는 중이에요"}</h2>
              </div>
            ) : ownershipState.error ? (
              <div className="community-empty community-feed-error" role="alert">
                <MessageCircleMore size={27} aria-hidden="true" />
                <h2>숨김 설정을 확인하지 못했어요</h2>
                <p>숨긴 이용자의 글이 섞이지 않도록 목록을 잠시 닫았어요.</p>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    setOwnershipState((current) => ({ ...current, key: "", error: false }));
                    setOwnershipRetry((value) => value + 1);
                  }}
                >
                  다시 시도하기
                </button>
              </div>
            ) : feedError && !posts.length ? (
              <div className="community-empty community-feed-error" role="alert">
                <MessageCircleMore size={27} aria-hidden="true" />
                <h2>이야기를 불러오지 못했어요</h2>
                <p>{feedError}</p>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setFeedRetry((value) => value + 1)}
                >
                  다시 시도하기
                </button>
              </div>
            ) : visiblePosts.length ? (
              visiblePosts.map((post) => (
                <PostThread
                  key={`${user.uid}:${post.id}`}
                  post={post}
                  services={services}
                  actorUid={user.uid}
                  ownsPost={ownershipState.ids.has(post.id)}
                  isAdministrator={ownershipState.canManageAll}
                  ownershipLoading={ownershipLoading}
                  ownershipUnavailable={ownershipState.error}
                  topics={topics}
                  onBlockComplete={() => {
                    setOwnershipState((current) => ({ ...current, key: "" }));
                    setOwnershipRetry((value) => value + 1);
                  }}
                />
              ))
            ) : visibleFixturePosts.length ? (
              <CommunityFixtureBoard
                posts={visibleFixturePosts}
                onChoose={(post) => {
                  chooseComposerHint({
                    purpose: post.purpose,
                    topic: post.topic,
                    hint: `${post.topic}에 대해 나누고 싶은 이야기를 적어 주세요`,
                  });
                }}
              />
            ) : (
              <div className="community-empty">
                <MessageCircleMore size={27} />
                <h2>{posts.length || showPublicFixtures ? "찾는 글이 없어요" : "아직 첫 이야기를 기다리고 있어요"}</h2>
                <p>{posts.length || showPublicFixtures ? "검색어나 관심 주제를 바꿔 보세요." : "긴 글이 아니어도 괜찮아요. 오늘의 생각이나 경험을 편하게 남겨 보세요."}</p>
                {!posts.length && !feedError && (
                  <div className="community-starters" aria-label="글감 예시">
                    {conversationStarterHints.map((starter) => (
                      <button
                        key={starter.label}
                        type="button"
                        onClick={() => chooseComposerHint(starter)}
                      >
                        {starter.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
          <CommunityCaseCenter />
          {visiblePosts.length > 0 && visibleFixturePosts.length > 0 && (
            <CommunityFixtureBoard
              posts={visibleFixturePosts}
              onChoose={(post) => {
                chooseComposerHint({
                  purpose: post.purpose,
                  topic: post.topic,
                  hint: `${post.topic}에 대해 나누고 싶은 이야기를 적어 주세요`,
                });
              }}
            />
          )}
          {feedError && posts.length > 0 && (
            <div className="community-notice" role="alert">
              <p>{feedError}</p>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  if (feedErrorSource === "older") void loadOlderPosts();
                  else setFeedRetry((value) => value + 1);
                }}
              >
                다시 시도하기
              </button>
            </div>
          )}
          {!feedError && hasOlderPosts && (
            <button
              className="button button-secondary"
              type="button"
              disabled={loadingOlderPosts}
              aria-busy={loadingOlderPosts}
              onClick={() => void loadOlderPosts()}
            >
              {loadingOlderPosts && (
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
              )}
              {loadingOlderPosts ? "불러오는 중" : "이전 글 더 보기"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
