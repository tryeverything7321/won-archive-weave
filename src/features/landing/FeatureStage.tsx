import { AnimatePresence, motion, useAnimationFrame, useMotionValue, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { landingScenes } from "./feature-stage-model";
import { landingServiceStatus } from "./service-status-model";

const SCENE_DURATION = 8000;
const ROTATION_DURATION = SCENE_DURATION * landingScenes.length;

export function FeatureStage() {
  const reduceMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const [pageHidden, setPageHidden] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndexRef = useRef(0);
  const elapsedRef = useRef(0);
  const progress = useMotionValue(0);
  const scene = landingScenes[activeIndex];
  const isPaused = pageHidden || userPaused;
  const serviceStatus = landingServiceStatus(
    import.meta.env.VITE_OAUTH_ENABLED === "true"
      && Boolean(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY),
  );

  useEffect(() => {
    const onVisibilityChange = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) progress.set((activeIndex + 1) / landingScenes.length);
  }, [activeIndex, progress, reduceMotion]);

  const selectScene = (nextIndex: number, focus = false) => {
    const wrapped = (nextIndex + landingScenes.length) % landingScenes.length;
    activeIndexRef.current = wrapped;
    elapsedRef.current = wrapped * SCENE_DURATION;
    progress.set(reduceMotion ? (wrapped + 1) / landingScenes.length : wrapped / landingScenes.length);
    setActiveIndex(wrapped);
    if (focus) window.requestAnimationFrame(() => tabRefs.current[wrapped]?.focus());
  };

  useAnimationFrame((_time, delta) => {
    if (reduceMotion || isPaused || document.hidden) return;
    elapsedRef.current = (elapsedRef.current + Math.min(delta, 50)) % ROTATION_DURATION;
    const nextProgress = elapsedRef.current / ROTATION_DURATION;
    const nextIndex = Math.min(
      landingScenes.length - 1,
      Math.floor(nextProgress * landingScenes.length),
    );
    progress.set(nextProgress);
    if (nextIndex !== activeIndexRef.current) {
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
    }
  });

  return (
    <section
      className="feature-stage section-frame"
      aria-labelledby="feature-stage-title"
    >
      <div className="feature-stage-intro">
        <div className="feature-stage-intro-meta">
          <p>위브에서 이어지는 네 가지 흐름</p>
          <aside className="feature-stage-status" aria-label="현재 서비스 안내">
            <strong>{serviceStatus.label}</strong>
            <span>{serviceStatus.message}</span>
          </aside>
        </div>
        <h1 id="feature-stage-title">
          <span>모두의 기록과<span className="feature-stage-mobile-break"><br /></span> 정성이 모여</span>
          <span>맑고 밝은 내일을<span className="feature-stage-mobile-break"><br /></span> 여는 터전</span>
        </h1>
        <span>
          원불교 청년들의 활동과 이야기를 한곳에서 만나고, 필요한 자료와 다음
          만남으로 이어갑니다.
        </span>
      </div>

      <div
        aria-labelledby={`feature-tab-${scene.id}`}
        className={`feature-stage-shell scene-${scene.id}`}
        id={`feature-panel-${scene.id}`}
        role="tabpanel"
      >
        <div className="feature-stage-copy-region">
          <AnimatePresence initial={false}>
            <motion.div
              className="feature-stage-copy"
              key={`${scene.id}-copy`}
              initial={reduceMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -12 }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="feature-stage-count" aria-hidden="true">
                <span>{scene.number}</span>
                <i />
                <span>04</span>
              </div>
              <scene.icon className="feature-stage-icon" aria-hidden="true" />
              <h2>{scene.title.endsWith("남는 곳") ? <>{scene.title.slice(0, -4)}<span className="keep-phrase">남는 곳</span></> : scene.title}</h2>
              <p>{scene.description}</p>
              <Link className="button feature-stage-action" to={scene.to}>
                {scene.action} <ArrowRight size={18} />
              </Link>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="feature-stage-visual">
          <AnimatePresence initial={false}>
            <motion.img
              alt={scene.visualLabel}
              className="feature-stage-image"
              key={`${scene.id}-visual`}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.94, rotate: -2 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 1.03, rotate: 1 }}
              src={scene.imageSrc}
              transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
            />
          </AnimatePresence>
        </div>
      </div>

      <div className="feature-stage-controls">
        <div
          className="feature-stage-tabs"
          role="tablist"
          aria-label="위브 주요 기능"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") selectScene(activeIndex + 1, true);
            if (event.key === "ArrowLeft") selectScene(activeIndex - 1, true);
            if (event.key === "Home") selectScene(0, true);
            if (event.key === "End") selectScene(landingScenes.length - 1, true);
          }}
        >
          {landingScenes.map((item, index) => (
            <button
              aria-controls={`feature-panel-${item.id}`}
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              key={item.id}
              id={`feature-tab-${item.id}`}
              onClick={() => selectScene(index)}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              role="tab"
              tabIndex={index === activeIndex ? 0 : -1}
              type="button"
            >
              <span className="feature-tab-number">{item.number}</span>
              {item.title}
            </button>
          ))}
        </div>
        <div className="feature-stage-arrows" aria-label="기능 화면 이동">
          {!reduceMotion && (
            <button
              aria-label={userPaused ? "자동 전환 재생" : "자동 전환 일시 정지"}
              aria-pressed={userPaused}
              onClick={() => setUserPaused((current) => !current)}
              type="button"
            >
              {userPaused ? <Play size={18} /> : <Pause size={18} />}
            </button>
          )}
          <button aria-label="이전 기능" onClick={() => selectScene(activeIndex - 1)} type="button">
            <ArrowLeft size={19} />
          </button>
          <button aria-label="다음 기능" onClick={() => selectScene(activeIndex + 1)} type="button">
            <ArrowRight size={19} />
          </button>
        </div>
      </div>
      <div className="feature-stage-progress" aria-hidden="true">
        <motion.span style={{ scaleX: progress }} />
        {landingScenes.slice(1).map((item, index) => (
          <i key={item.id} style={{ left: `${((index + 1) / landingScenes.length) * 100}%` }} />
        ))}
      </div>
    </section>
  );
}
