import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Files, Menu, UserRound, X } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
} from "motion/react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { WeaveLogoLockup } from "../components/WeaveLogoLockup";
import { WeaveSymbol } from "../components/WeaveSymbol";
import { InstagramGlyph } from "../components/InstagramGlyph";
import { LaunchFeedbackNudge } from "../features/feedback/LaunchFeedbackNudge";
import { FirstLoginOnboardingGate } from "../features/onboarding/OnboardingFlow";
import { parseCalendarListRestoreState } from "../features/calendar/calendar-navigation";
import { RequiredProfileGate } from "../features/profile/RequiredProfileGate";
import { DraftSessionBoundary } from './DraftSessionBoundary';

import { CreateMenu } from "../features/experience/CreateMenu";
import experienceStyles from "../features/experience/Experience.module.css";

const menuItems = [
  ["/archive", "활동 기록"],
  ["/resources", "자료 나눔"],
  ["/calendar", "행사 일정"],
  ["/community", "커뮤니티"],
  ["/about", "청년회와 위브"],
] as const;

export function SiteLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const workspace = /^\/(archive|resources|calendar|events|community|contribute|profile)(\/|$)/.test(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 28,
    mass: 0.2,
  });

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = Array.from(
      mobileMenuRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [],
    );
    focusable[0]?.focus();

    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleMenuKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleMenuKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="site-shell" data-workspace={workspace || undefined}>
      <DraftSessionBoundary />
      <RequiredProfileGate />
      <motion.div
        className="scroll-progress"
        style={{ scaleX: smoothProgress }}
        aria-hidden="true"
      />
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <header className="topbar">
        <Link className="brand weave-brand" to="/" aria-label="위브 홈">
          <WeaveLogoLockup className="weave-brand-wordmark" label="" variant="full" />
          <WeaveSymbol className="weave-brand-symbol" decorative />
          <span className="weave-brand-copy">
            <small>모두의 기록과 정성이 모여</small>
            <small>맑고 밝은 내일을 여는 터전</small>
          </span>
        </Link>
        <nav className="desktop-nav" aria-label="주요 메뉴">
          {menuItems.map(([to, label]) => (
            <NavLink key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="top-actions">
          <div className={experienceStyles.desktopCreate}><CreateMenu /></div>
          <Link className="profile-link" to="/profile" aria-label="내 프로필">
            <UserRound size={18} />
            <span>내 위브</span>
          </Link>
          <a
            className="instagram-link"
            href="https://www.instagram.com/won_buddhism_youth/"
            target="_blank"
            rel="noreferrer"
            aria-label="원불교 청년회 공식 인스타그램"
          >
            <InstagramGlyph size={17} />
          </a>
          <button
            ref={menuButtonRef}
            className="menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
            <span className="sr-only">
              {menuOpen ? "메뉴 닫기" : "메뉴 열기"}
            </span>
          </button>
        </div>
      </header>
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.button
              aria-label="메뉴 닫기"
              className="mobile-nav-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setMenuOpen(false);
                requestAnimationFrame(() => menuButtonRef.current?.focus());
              }}
              type="button"
            />
            <motion.nav
              ref={mobileMenuRef}
              id="mobile-menu"
              className="mobile-nav"
              aria-label="모바일 메뉴"
              aria-modal="true"
              role="dialog"
              initial={
                reduceMotion
                  ? false
                  : {
                      opacity: 0,
                      y: -16,
                      clipPath: "inset(0 0 100% 0 round 0 0 24px 24px)",
                    }
              }
              animate={{
                opacity: 1,
                y: 0,
                clipPath: "inset(0 0 0% 0 round 0 0 24px 24px)",
              }}
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : {
                      opacity: 0,
                      y: -12,
                      clipPath: "inset(0 0 100% 0 round 0 0 24px 24px)",
                    }
              }
              transition={{
                duration: reduceMotion ? 0 : 0.42,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {menuItems.map(([to, label], index) => (
                <motion.div
                  key={to}
                  initial={reduceMotion ? false : { opacity: 0, x: -18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: reduceMotion ? 0 : 0.06 + index * 0.045 }}
                >
                  <NavLink to={to} onClick={() => setMenuOpen(false)}>
                    {label}
                  </NavLink>
                </motion.div>
              ))}
              <NavLink to="/contribute" onClick={() => setMenuOpen(false)}>
                기록·자료 올리기
              </NavLink>
              <NavLink to="/profile" onClick={() => setMenuOpen(false)}>
                내 위브
              </NavLink>
              <NavLink to="/start" onClick={() => setMenuOpen(false)}>
                원불교가 처음인가요
              </NavLink>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
      <RouteFocus />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      {!menuOpen && <nav className={experienceStyles.dock} aria-label="자주 하는 일">
        <NavLink to="/resources"><Files size={20} aria-hidden="true" />자료 찾기</NavLink>
        <NavLink to="/calendar"><CalendarDays size={20} aria-hidden="true" />행사 찾기</NavLink>
        <CreateMenu mobile />
        <NavLink to="/profile"><UserRound size={20} aria-hidden="true" />내 위브</NavLink>
      </nav>}
      <FirstLoginOnboardingGate />
      <LaunchFeedbackNudge />
      <footer className="footer section-frame">
        <div className="footer-identity">
          <Link className="footer-weave" to="/">
            <WeaveLogoLockup label="위브" variant="full" />
            <span className="footer-tagline">
              <span>모두의 기록과 정성이 모여</span>
              <span>맑고 밝은 내일을 여는 터전</span>
            </span>
          </Link>
        </div>
        <nav className="footer-policies" aria-label="서비스와 운영 안내">
          <Link to="/about#weave-story">청년회와 위브</Link>
          <Link to="/policies/terms">이용약관</Link>
          <Link to="/policies/privacy">개인정보 처리 안내</Link>
          <Link to="/policies/community">커뮤니티 규칙</Link>
        </nav>
        <a
          className="footer-instagram"
          href="https://www.instagram.com/won_buddhism_youth/"
          target="_blank"
          rel="noreferrer"
          aria-label="원불교 청년회 공식 인스타그램 열기(새 창)"
        >
          <InstagramGlyph size={18} />
          공식 인스타그램
        </a>
      </footer>
    </div>
  );
}

function RouteFocus() {
  const reduceMotion = useReducedMotion();
  const { pathname, hash, state } = useLocation();
  const calendarRestoring = pathname === "/calendar" && parseCalendarListRestoreState(state) !== null;
  const focusedRoute = useRef<string | null>(null);
  useEffect(() => {
    const routeKey = `${pathname}${hash}`;
    // Query/state updates belong to the current page and must not steal focus.
    if (focusedRoute.current === routeKey) return;
    focusedRoute.current = routeKey;
    // CalendarPage restores focus and scroll once its result rows are ready.
    if (calendarRestoring) return;
    if (hash) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(hash)?.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start",
        });
      });
      return;
    }
    document
      .querySelector<HTMLElement>("#main")
      ?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [calendarRestoring, hash, pathname, reduceMotion]);
  return null;
}
