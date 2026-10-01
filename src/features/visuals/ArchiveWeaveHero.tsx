import { useRef, type PointerEvent } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

const threads = [
  {
    className: "thread-one",
    label: "기록을 남겨요",
    meta: "활동 · 자료 · 회고",
  },
  {
    className: "thread-two",
    label: "다른 사람의 경험과 노하우를 살펴봐요",
    meta: "경험 · 노하우 · 자료",
  },
  {
    className: "thread-three",
    label: "다음 활동을 기획해 직접 열어 봐요",
    meta: "기획 · 모집 · 실행",
  },
];

export function ArchiveWeaveHero() {
  const reduceMotion = useReducedMotion();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start end", "end start"],
  });
  const scrollLift = useTransform(scrollYProgress, [0, 1], [34, -42]);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-8, 8]), {
    stiffness: 130,
    damping: 24,
  });
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [7, -7]), {
    stiffness: 130,
    damping: 24,
  });

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reduceMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - bounds.left) / bounds.width - 0.5);
    pointerY.set((event.clientY - bounds.top) / bounds.height - 0.5);
  };

  const resetPointer = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  return (
    <motion.div
      ref={heroRef}
      className="weave-hero"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.94, rotateY: -5 }}
      animate={{ opacity: 1, scale: 1, rotateY: 0 }}
      style={reduceMotion ? undefined : { y: scrollLift }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
    >
      <motion.div
        className="weave-hero-plane"
        style={reduceMotion ? undefined : { rotateX, rotateY }}
      >
        <div className="weave-flow-kicker">기록이 이어지는 방식</div>
        <svg
          className="weave-flow-path"
          viewBox="0 0 700 570"
          aria-hidden="true"
        >
          <path
            className="weave-flow-rail"
            d="M94 126 C244 126 218 278 350 284 C486 291 456 438 608 438"
          />
          <motion.path
            className="weave-flow-progress"
            d="M94 126 C244 126 218 278 350 284 C486 291 456 438 608 438"
            initial={reduceMotion ? { pathLength: 1 } : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{
              duration: reduceMotion ? 0 : 1.8,
              delay: 0.28,
              ease: [0.16, 1, 0.3, 1],
            }}
          />
          <circle cx="94" cy="126" r="8" />
          <circle cx="350" cy="284" r="8" />
          <circle cx="608" cy="438" r="8" />
        </svg>

        {threads.map((thread, index) => (
          <motion.article
            className={`weave-thread ${thread.className}`}
            key={thread.label}
            initial={
              reduceMotion ? false : { opacity: 0, y: 42, rotate: index - 1 }
            }
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{
              delay: 0.18 + index * 0.12,
              duration: 0.72,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <div className="weave-thread-body">
              <span className="weave-thread-index">0{index + 1}</span>
              <strong>{thread.label}</strong>
              <span>{thread.meta}</span>
            </div>
          </motion.article>
        ))}

        <div className="weave-signature">
          <span>기록에서 다음 만남까지</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
