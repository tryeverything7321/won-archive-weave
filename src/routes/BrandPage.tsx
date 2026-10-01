import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { Link } from "react-router-dom";
import { PageFrame } from "../components/PageFrame";

const principles = [
  {
    className: "brand-principle-flow",
    title: "열린 물결",
    body: "민트색 물결은 위브 위를 가로막는 테두리가 아니라 기록과 사람이 드나드는 열린 장면을 만듭니다.",
    visual: <span className="brand-color-flow" aria-hidden="true" />,
  },
  {
    className: "brand-principle-center",
    title: "이어지는 글자",
    body: "서로 다른 획이 한 단어 안에서 이어지듯 활동의 과정과 결과, 다음 행동을 한 흐름으로 보여 줍니다.",
    visual: (
      <span className="brand-relay-grid" aria-hidden="true">
        <i>기록</i><i>자료</i><i>다음 활동</i>
      </span>
    ),
  },
  {
    className: "brand-principle-light",
    title: "이름 그대로 쓰는 약속",
    body: "로고 일부를 떼어 상징처럼 쓰지 않습니다. 위브라는 이름 전체가 보일 때 제품과 운영 주체의 관계도 분명해집니다.",
    visual: (
      <img
        className="brand-rhythm-lockup"
        src="/brand/ot01-open-crest-mono.svg"
        alt=""
      />
    ),
  },
] as const;

export function BrandStorySection() {
  const stageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: stageRef,
    offset: ["start end", "end start"],
  });
  const rawLogoY = useTransform(scrollYProgress, [0, 1], [36, -32]);
  const logoY = useSpring(rawLogoY, { stiffness: 90, damping: 24 });

  return (
    <section className="brand-story-section" id="weave-story" aria-labelledby="weave-story-title">
      <header className="brand-story-heading">
        <p>위브라는 이름에 담긴 뜻</p>
        <h2 id="weave-story-title">기록과 마음을 한 올씩 엮는 이름</h2>
        <span>사람과 기록, 경험과 정성이 실처럼 엮여 새로운 흐름을 만든다는 뜻을 위브라는 이름에 담았습니다.</span>
      </header>
      <div className="brand-page">
        <div className="brand-visual-stage" ref={stageRef}>
          <svg
            className="brand-thread-map"
            viewBox="0 0 1200 560"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <motion.path
              d="M-40 410 C180 460 250 110 485 208 S760 520 1245 128"
              initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 0.58 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: reduceMotion ? 0 : 1.6, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.path
              d="M140 -40 C215 176 470 400 682 274 S980 70 1240 330"
              initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 0.34 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: reduceMotion ? 0 : 1.9, delay: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <motion.img
            className="brand-main-lockup"
            src="/brand/ot01-open-crest-primary.svg"
            alt="민트색 열린 물결과 네이비 글자로 구성된 위브 로고"
            style={reduceMotion ? undefined : { y: logoY }}
          />
          <span className="brand-stage-word brand-stage-word-one">사람</span>
          <span className="brand-stage-word brand-stage-word-two">기록</span>
          <span className="brand-stage-word brand-stage-word-three">경험</span>
          <span className="brand-stage-word brand-stage-word-four">정성</span>
        </div>

        <motion.section
          className="brand-name-story"
          initial={reduceMotion ? false : { opacity: 0, y: 64 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.28 }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <div>
            <p>왜 위브인가요</p>
            <h2>기록을 나눠<br />활동을 이어가도록</h2>
          </div>
          <div className="brand-name-copy">
            <p>
              Weave는 여러 가닥의 실을 엮어 하나의 천을 만든다는 뜻입니다.
              위브에서는 서로 다른 사람의 경험과 정성이 한 올씩 만나 다음 활동에
              쓸 기록과 자료가 됩니다.
            </p>
            <p>
              기록을 보관하는 데서 멈추지 않고 사람과 사람, 어제의 경험과 내일의
              실천을 잇는 곳이 되겠다는 뜻을 이름에 담았습니다.
            </p>
          </div>
        </motion.section>

        <section className="brand-principles" aria-labelledby="brand-principles-title">
          <div className="brand-principles-heading">
            <p>위브 로고를 쓰는 방식</p>
            <h2 id="brand-principles-title">이름과 관계가<br />또렷하게 보이도록</h2>
          </div>
          <div className="brand-principle-grid">
            {principles.map((principle, index) => (
              <motion.article
                className={`brand-principle ${principle.className}`}
                key={principle.title}
                initial={reduceMotion ? false : { opacity: 0, y: 54, rotate: index % 2 ? 0.8 : -0.8 }}
                whileInView={{ opacity: 1, y: 0, rotate: 0 }}
                viewport={{ once: true, amount: 0.24 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.72,
                  delay: reduceMotion ? 0 : (index % 2) * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="brand-principle-visual">{principle.visual}</div>
                <h3>{principle.title}</h3>
                <p>{principle.body}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <motion.section
          className="brand-closing"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: reduceMotion ? 0 : 0.85, ease: [0.22, 1, 0.36, 1] }}
        >
          <p>각자의 기록을 함께 나누고</p>
          <h2>그 기록으로<br />다음 활동을 시작합니다</h2>
          <Link className="button button-primary" to="/archive">
            위브의 기록 만나기 <ArrowRight size={18} />
          </Link>
        </motion.section>
      </div>
    </section>
  );
}

export function BrandPage() {
  return (
    <PageFrame
      eyebrow="청년회와 위브"
      title={<>기록과 마음을<br />한 올씩 엮는 이름</>}
      description="사람과 기록, 경험과 정성이 실처럼 엮여 새로운 흐름을 만든다는 뜻을 위브라는 이름에 담았습니다."
    >
      <BrandStorySection />
    </PageFrame>
  );
}
