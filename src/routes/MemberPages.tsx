import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  CalendarClock,
  ContactRound,
  FolderKanban,
  Link2Off,
  LoaderCircle,
  LogOut,
  Settings2,
  ShieldCheck,
  UserRound,
  Waypoints,
} from "lucide-react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Link } from "react-router-dom";
import experienceStyles from "../features/experience/Experience.module.css";
import { useOperatorAccess } from "../features/auth/useOperatorAccess";
import { PageFrame } from "../components/PageFrame";
import { RouteLoading } from "../components/RouteLoading";
import { getFirebaseServices, isOAuthConfigured } from "../lib/firebase/client";
import { startOAuthLogin } from "../features/auth/api";
import { ProviderLoginButton } from "../features/auth/ProviderLoginButton";
import { ProviderBadge } from "../features/community/ProviderBadge";
import {
  adjacentProfileSection,
  communityAccessMessage,
  profileSectionFromSearch,
  profileSectionUrl,
  type AccountProfile,
  type ProfileSection,
} from "../features/profile/account-model";
import { MemberProfileForm } from "../features/profile/MemberProfileForm";
import { readMyProfilePhoto } from "../features/profile/member-profile-api";
import { OnboardingFlow } from "../features/onboarding/OnboardingFlow";
import {
  managedEventEditorValue,
  type ManagedEvent,
} from "../features/calendar/event-editor-model";

const currentTermsVersion = "2026-07-20";
const currentCommunityRulesVersion = "2026-07-20";

const ContributionForm = lazy(() =>
  import("../features/uploads/ContributionForm").then((m) => ({
    default: m.ContributionForm,
  })),
);
const CommunityExperience = lazy(() =>
  import("../features/community/CommunityExperience").then((m) => ({
    default: m.CommunityExperience,
  })),
);
const SubmissionManager = lazy(() =>
  import("../features/uploads/SubmissionManager").then((m) => ({
    default: m.SubmissionManager,
  })),
);
const EventManager = lazy(() =>
  import("../features/calendar/EventManager").then((m) => ({
    default: m.EventManager,
  })),
);
const EventEditor = lazy(() =>
  import("../features/calendar/EventEditor").then((m) => ({
    default: m.EventEditor,
  })),
);

export function ContributePage() {
  return (
    <PageFrame
      eyebrow="등록하기"
      title={
        <>
          활동 기록·자료 올리기
        </>
      }
      description="활동 후기나 공유할 자료를 남겨 주세요. 공개 범위를 직접 선택하고, 등록 후에는 내 위브에서 게시 상태와 관리 메뉴를 확인할 수 있어요."
    >
      <Suspense fallback={<RouteLoading />}>
        <ContributionForm />
      </Suspense>
    </PageFrame>
  );
}

export function CommunityPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <CommunityExperience />
    </Suspense>
  );
}

export function ProfilePage() {
  const operatorAccess = useOperatorAccess();
  const services = useMemo(() => getFirebaseServices(), []);
  const [user, setUser] = useState<User | null>(
    () => services?.auth.currentUser ?? null,
  );
  const [account, setAccount] = useState<{
    provider?: "kakao" | "naver" | "google";
    pseudonym?: string;
    termsVersion?: string;
    communityRulesVersion?: string;
  }>({});
  const [authReady, setAuthReady] = useState(!services || Boolean(services.auth.currentUser));
  const [accountLoading, setAccountLoading] = useState(Boolean(services?.auth.currentUser));
  const [accountError, setAccountError] = useState("");
  const [accountRetry, setAccountRetry] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [activeProfileSection, setActiveProfileSection] = useState<ProfileSection>(
    () => profileSectionFromSearch(window.location.search),
  );
  const [managementView, setManagementView] = useState<"submissions" | "events">(() => new URLSearchParams(window.location.search).get("manage") === "events" ? "events" : "submissions");
  const eventManagementRef = useRef<HTMLDivElement>(null);
  const [eventSavedNotice, setEventSavedNotice] = useState("");
  const [eventEditor, setEventEditor] = useState<ManagedEvent | "new" | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");
  const [profilePhotoRevision, setProfilePhotoRevision] = useState(0);
  useEffect(() => {
    if (!services) return undefined;
    return onAuthStateChanged(services.auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      setAccount({});
      setAccountError("");
      setAccountLoading(Boolean(nextUser));
    });
  }, [services]);
  useEffect(() => {
    const restoreSection = () => {
      setActiveProfileSection(profileSectionFromSearch(window.location.search));
      setManagementView(new URLSearchParams(window.location.search).get("manage") === "events" ? "events" : "submissions");
    };
    window.addEventListener("popstate", restoreSection);
    return () => window.removeEventListener("popstate", restoreSection);
  }, []);
  useEffect(() => {
    if (!services || !user) return undefined;
    let active = true;
    void getDoc(doc(services.firestore, "users", user.uid))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) throw new Error("Account document is missing");
        const data = snapshot.data();
        setAccount({
          provider:
            data?.provider === "kakao" || data?.provider === "naver" || data?.provider === "google"
              ? data.provider
              : undefined,
          pseudonym:
            typeof data?.pseudonym === "string" ? data.pseudonym : undefined,
          termsVersion:
            typeof data?.termsVersion === "string" ? data.termsVersion : undefined,
          communityRulesVersion:
            typeof data?.communityRulesVersion === "string"
              ? data.communityRulesVersion
              : undefined,
        });
      })
      .catch(() => {
        if (active) setAccountError("계정 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      })
      .finally(() => {
        if (active) setAccountLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountRetry, services, user]);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const uid = user?.uid;

    if (!uid) {
      queueMicrotask(() => {
        if (active) setProfilePhotoUrl("");
      });
      return () => {
        active = false;
      };
    }

    void readMyProfilePhoto(uid)
      .then((photo) => {
        if (!active) return;
        objectUrl = photo ? URL.createObjectURL(photo) : "";
        setProfilePhotoUrl(objectUrl);
      })
      .catch(() => {
        if (active) setProfilePhotoUrl("");
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profilePhotoRevision, user?.uid]);
  const profile: AccountProfile = {
    provider: account.provider,
    connected: Boolean(user),
    termsAccepted: account.termsVersion === currentTermsVersion,
    communityRulesAccepted: account.communityRulesVersion === currentCommunityRulesVersion,
    pseudonym: account.pseudonym,
    wonBuddhismVerification: "not_available",
  };
  const providerLabel =
    profile.provider === "kakao"
      ? "카카오로 연결됨"
      : profile.provider === "naver"
        ? "네이버로 연결됨"
        : profile.provider === "google" ? "구글로 연결됨" : "계정 연결을 확인하고 있어요";

  const logOut = async () => {
    if (!services || loggingOut) return;
    setLoggingOut(true);
    setAccountError("");
    try {
      await signOut(services.auth);
      setAccount({});
    } catch {
      setAccountError("로그아웃하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setLoggingOut(false);
    }
  };

  const chooseProfilePhoto = () => {
    const photoInput = document.querySelector<HTMLInputElement>(
      "[data-profile-photo-input]",
    );
    if (photoInput) {
      photoInput.click();
      return;
    }

    setActiveProfileSection("info");
    window.history.replaceState(
      window.history.state,
      "",
      profileSectionUrl(window.location, "info"),
    );
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("[data-profile-photo-section]")
        ?.scrollIntoView({ block: "start" });
    });
  };

  const retryAccount = () => {
    setAccount({});
    setAccountError("");
    setAccountLoading(true);
    setAccountRetry((value) => value + 1);
  };

  const selectProfileSection = (section: ProfileSection) => {
    setActiveProfileSection(section);
    window.history.replaceState(
      window.history.state,
      "",
      profileSectionUrl(window.location, section),
    );
  };

  const moveProfileSection = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    section: ProfileSection,
  ) => {
    const next = adjacentProfileSection(section, event.key);
    if (!next) return;
    event.preventDefault();
    selectProfileSection(next);
    document.getElementById(`profile-${next}-tab`)?.focus();
  };

  if (!authReady) {
    return (
      <PageFrame
        variant="gate"
        eyebrow="내 위브"
        title={<>내 위브를<br />불러오고 있어요</>}
        description="로그인 상태를 확인한 뒤 내 기록과 계정 정보를 보여 드릴게요."
      >
        <div className="community-empty" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={27} aria-hidden="true" />
          <h2>로그인 상태를 확인하고 있어요</h2>
        </div>
      </PageFrame>
    );
  }

  if (!user) {
    return (
      <PageFrame
        variant="gate"
        eyebrow="내 위브"
        title={<>로그인하고<br />내 위브를 시작해요</>}
        description="카카오·네이버·구글 계정을 연결하면 내가 남긴 기록과 커뮤니티 활동을 한곳에서 확인할 수 있어요."
      >
        <section className="community-gate profile-login-gate">
          <div className="gate-orbits" aria-hidden="true"><span /><span /><span /></div>
          <div className="gate-copy">
            <p>로그인 방법 선택</p>
            <h2>사용할 계정을 골라 주세요</h2>
            <span>로그인 방법은 다른 이용자에게 아이콘으로만 표시되며 계정 정보는 공개되지 않아요.</span>
            <div className="community-login-actions">
              <ProviderLoginButton
                disabled={!services || !isOAuthConfigured}
                onClick={() => startOAuthLogin("kakao", "/profile")}
                provider="kakao"
              />
              <ProviderLoginButton
                disabled={!services || !isOAuthConfigured}
                onClick={() => startOAuthLogin("naver", "/profile")}
                provider="naver"
              />
              <ProviderLoginButton disabled={!isOAuthConfigured} provider="google" onClick={() => startOAuthLogin("google", "/profile")} />
            </div>
            {!isOAuthConfigured && <small>로그인 연결을 준비하고 있어요.</small>}
          </div>
        </section>
      </PageFrame>
    );
  }

  if (accountLoading) {
    return (
      <PageFrame
        variant="gate"
        eyebrow="내 위브"
        title={<>내 정보와 활동을<br />불러오고 있어요</>}
        description="저장한 내 정보와 위브 별명, 내가 남긴 기록을 확인하고 있어요."
      >
        <div className="community-empty" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={27} aria-hidden="true" />
          <h2>계정 정보를 불러오는 중이에요</h2>
        </div>
      </PageFrame>
    );
  }

  if (accountError) {
    return (
      <PageFrame
        variant="recovery"
        eyebrow="내 위브"
        title={<>계정 정보를<br />불러오지 못했어요</>}
        description={accountError}
      >
        <div className="community-empty" role="alert">
          <h2>다시 불러오거나 로그아웃할 수 있어요</h2>
          <div className="profile-recovery-actions">
              {operatorAccess.state === "allowed" && <Link className="button button-secondary" to="/admin"><ShieldCheck size={18} /> 운영 센터</Link>}
            <button className="button button-primary" onClick={retryAccount} type="button">
              다시 시도하기
            </button>
            <button className="button button-secondary" disabled={loggingOut} onClick={() => void logOut()} type="button">
              <LogOut size={18} /> {loggingOut ? "로그아웃 중" : "로그아웃"}
            </button>
          </div>
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame
      eyebrow="내 위브"
      title={
        <>
          내 정보와 활동을
          <br /> 한곳에서 관리해요
        </>
      }
      description="내 정보와 로그인 설정, 내가 남긴 기록과 행사를 필요한 곳에서 바로 관리할 수 있어요."
    >
      <div className="profile-dashboard">
        <section className="profile-hero-panel">
          <button
            className="profile-avatar"
            type="button"
            aria-label={profilePhotoUrl ? "프로필 사진 변경" : "프로필 사진 추가"}
            onClick={chooseProfilePhoto}
          >
            {profilePhotoUrl ? <img src={profilePhotoUrl} alt="" /> : <UserRound aria-hidden="true" />}
          </button>
          <div>
            <p>{user ? "위브에 참여 중" : "로그인 전"}</p>
            <h2>{profile.pseudonym ?? "위브를 시작해 보세요"}</h2>
            <ProviderBadge provider={profile.provider} />
            <span>{communityAccessMessage(profile)}</span>
          </div>
          {user && (
            <div className="profile-recovery-actions">
              <button className="button button-secondary" type="button" onClick={chooseProfilePhoto}>
                사진 변경
              </button>
              <button className="button button-secondary" disabled={loggingOut} onClick={() => void logOut()} type="button">
                <LogOut size={18} /> {loggingOut ? "로그아웃 중" : "로그아웃"}
              </button>
            </div>
          )}
        </section>
        <nav
          className="profile-section-nav"
          aria-label="내 위브 메뉴"
          role="tablist"
        >
          <button
            aria-controls="profile-info-panel"
            aria-current={activeProfileSection === "info" ? "page" : undefined}
            aria-selected={activeProfileSection === "info"}
            id="profile-info-tab"
            onKeyDown={(event) => moveProfileSection(event, "info")}
            onClick={() => selectProfileSection("info")}
            role="tab"
            tabIndex={activeProfileSection === "info" ? 0 : -1}
            type="button"
          >
            <ContactRound aria-hidden="true" />
            <span><b>내 정보</b><small>프로필과 참가 정보</small></span>
          </button>
          <button
            aria-controls="profile-activity-panel"
            aria-current={activeProfileSection === "activity" ? "page" : undefined}
            aria-selected={activeProfileSection === "activity"}
            id="profile-activity-tab"
            onKeyDown={(event) => moveProfileSection(event, "activity")}
            onClick={() => selectProfileSection("activity")}
            role="tab"
            tabIndex={activeProfileSection === "activity" ? 0 : -1}
            type="button"
          >
            <FolderKanban aria-hidden="true" />
            <span><b>내 활동</b><small>기록과 행사 관리</small></span>
          </button>
          <button
            aria-controls="profile-account-panel"
            aria-current={activeProfileSection === "account" ? "page" : undefined}
            aria-selected={activeProfileSection === "account"}
            id="profile-account-tab"
            onKeyDown={(event) => moveProfileSection(event, "account")}
            onClick={() => selectProfileSection("account")}
            role="tab"
            tabIndex={activeProfileSection === "account" ? 0 : -1}
            type="button"
          >
            <Settings2 aria-hidden="true" />
            <span><b>계정 및 안내</b><small>로그인과 이용 설정</small></span>
          </button>
        </nav>

        {activeProfileSection === "info" && (
          <section
            className="profile-section-panel"
            aria-labelledby="profile-info-tab"
            data-profile-photo-section
            id="profile-info-panel"
            role="tabpanel"
          >
            <MemberProfileForm
              user={user}
              onPhotoChanged={() => setProfilePhotoRevision((value) => value + 1)}
            />
          </section>
        )}

        {activeProfileSection === "activity" && (
          <section
            className="profile-section-panel"
            aria-labelledby="profile-activity-tab"
            id="profile-activity-panel"
            role="tabpanel"
          >
            <header className="profile-section-heading">
              <h2>기록·자료와 행사</h2>
              <span>공개 상태를 확인하고 필요한 항목을 관리해 주세요.</span>
            </header>
            <div className={experienceStyles.managementChoices} role="group" aria-label="관리할 콘텐츠">
              {([['submissions', '기록·자료'], ['events', '행사']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={managementView === value} aria-controls={`management-${value}`} onClick={() => {
                setManagementView(value);
                const next = new URL(window.location.href); next.searchParams.set('manage', value); window.history.replaceState(window.history.state, '', next.pathname + next.search);
              }}>{label} 관리</button>)}
            </div>
            <div id="management-submissions" hidden={managementView !== 'submissions'}>
              <div className={experienceStyles.managementLinks}><Link to="/contribute?intent=activity">활동 기록 남기기</Link><Link to="/contribute?intent=material">자료 나누기</Link></div>
            <Suspense fallback={<RouteLoading />}>
              <SubmissionManager key={user?.uid} />
            </Suspense>
            </div>
            <div ref={eventManagementRef} id="management-events" hidden={managementView !== 'events'} tabIndex={-1}>
              {eventSavedNotice && <p role="status">{eventSavedNotice}</p>}
            <Suspense fallback={<RouteLoading />}>
              {eventEditor ? (
                <EventEditor
                  key={`${user?.uid}:${eventEditor === "new" ? "new" : eventEditor.id}`}
                  eventId={eventEditor === "new" ? undefined : eventEditor.id}
                  initialValue={eventEditor === "new" ? undefined : {
                    ...managedEventEditorValue(eventEditor),
                    mediaUploads: eventEditor.mediaUploads,
                    status: eventEditor.status,
                    reviewReason: eventEditor.reviewReason,
                  }}
                  onCancel={() => setEventEditor(null)}
                  onSaved={(result) => {
                    setEventEditor(null);
                    setEventSavedNotice(result.status === "review_queued" ? "행사 내용을 저장했어요. 사진은 보안 검사 후 표시됩니다." : "행사를 저장했어요. 아래 목록에서 확인해 주세요.");
                    requestAnimationFrame(() => {
                      const panel = eventManagementRef.current;
                      if (panel && !panel.hidden) panel.focus({ preventScroll: true });
                    });
                  }}
                />
              ) : (
                <EventManager
                  onCreate={() => setEventEditor("new")}
                  onEdit={(event) => setEventEditor(event)}
                />
              )}
            </Suspense>
            </div>
          </section>
        )}

        {activeProfileSection === "account" && (
          <section
            className="profile-section-panel"
            aria-labelledby="profile-account-tab"
            id="profile-account-panel"
            role="tabpanel"
          >
            <header className="profile-section-heading">
              <h2>로그인과 이용 안내</h2>
              <span>공개 별명과 로그인 경로를 확인할 수 있어요.</span>
            </header>
            <div className="profile-grid">
              <section className="profile-card">
                <Link2Off />
                <p>연결 계정</p>
                <h2 className="profile-provider-title">
                  <ProviderBadge provider={profile.provider} />
                  {providerLabel}
                </h2>
                <span>로그인 경로만 별명 옆에 표시되며 계정 정보는 공개되지 않아요.</span>
                <button
                  className="button button-secondary"
                  disabled={loggingOut}
                  onClick={() => void logOut()}
                  type="button"
                >
                  <LogOut size={18} /> {loggingOut ? "로그아웃 중" : "로그아웃"}
                </button>
              </section>
              <section className="profile-card">
                <AtSign />
                <p>위브 별명</p>
                <h2>{profile.pseudonym ?? "아직 정하지 않았어요"}</h2>
                <span>별명은 90일에 한 번 바꿀 수 있어요.</span>
                <small>
                  <CalendarClock size={15} /> 다음 변경 가능일은 커뮤니티에서 확인할 수 있어요.
                </small>
              </section>
              <section className="profile-card">
                <Waypoints />
                <p>위브 이용 안내</p>
                <h2>위브의 주요 기능을 다시 살펴봐요</h2>
                <span>활동 기록과 행사, 커뮤니티를 이용하는 방법을 네 단계로 안내해요.</span>
                <button type="button" onClick={() => setGuideOpen(true)}>
                  안내 다시 보기
                </button>
              </section>
            </div>
            <aside className="verification-note">
              <ShieldCheck />
              <div>
                <h2>회원 확인 기능을 준비하고 있어요</h2>
                <p>
                  회원 확인 전에도 네이버·카카오·구글 로그인과 별명 설정을 마치면
                  커뮤니티에 참여할 수 있어요.
                </p>
              </div>
            </aside>
          </section>
        )}
        <OnboardingFlow open={guideOpen} onClose={() => setGuideOpen(false)} />
      </div>
    </PageFrame>
  );
}
