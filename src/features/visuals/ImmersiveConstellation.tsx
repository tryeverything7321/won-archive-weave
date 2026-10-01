import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

export function ImmersiveConstellation() {
  const reduceMotion = useReducedMotion();
  const sceneRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (reduceMotion || !sceneRef.current) return undefined;

    const matchMedia = gsap.matchMedia();
    const context = gsap.context(() => {
      gsap.set(".constellation-node", { opacity: 1 });

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: sceneRef.current,
          start: "top 78%",
          end: "bottom 38%",
          scrub: 0.7,
        },
      });

      timeline
        .fromTo(
          ".constellation-plane",
          { rotateX: 12, rotateZ: -7, scale: 0.9, y: 42 },
          { rotateX: 0, rotateZ: 2.5, scale: 1.03, y: -8, ease: "none" },
          0,
        )
        .fromTo(
          ".constellation-line",
          { strokeDashoffset: 760 },
          { strokeDashoffset: 0, ease: "none" },
          0,
        )
        .fromTo(
          ".constellation-node",
          { scale: 0.68, y: 38, filter: "blur(8px)" },
          {
            scale: 1,
            y: 0,
            filter: "blur(0px)",
            stagger: 0.08,
            ease: "power3.out",
          },
          0.08,
        );

      matchMedia.add("(min-width: 901px)", () => {
        const rotateX = gsap.quickTo(".constellation-plane", "rotateX", {
          duration: 0.55,
          ease: "power3.out",
        });
        const rotateY = gsap.quickTo(".constellation-plane", "rotateY", {
          duration: 0.55,
          ease: "power3.out",
        });

        const onMove = (event: PointerEvent) => {
          const bounds = sceneRef.current?.getBoundingClientRect();
          if (!bounds) return;
          const x = (event.clientX - bounds.left) / bounds.width - 0.5;
          const y = (event.clientY - bounds.top) / bounds.height - 0.5;
          rotateY(x * 9);
          rotateX(y * -7);
        };

        const onLeave = () => {
          rotateY(0);
          rotateX(0);
        };

        const scene = sceneRef.current;
        scene?.addEventListener("pointermove", onMove);
        scene?.addEventListener("pointerleave", onLeave);
        return () => {
          scene?.removeEventListener("pointermove", onMove);
          scene?.removeEventListener("pointerleave", onLeave);
        };
      });
    }, sceneRef);

    return () => {
      matchMedia.revert();
      context.revert();
    };
  }, [reduceMotion]);

  return (
    <section
      ref={sceneRef}
      className="constellation section-frame"
      aria-labelledby="constellation-title"
    >
      <div className="constellation-copy">
        <h2 id="constellation-title">
          <span>흩어진 기록이 </span>
          <span>다음 활동으로 이어지는 지도</span>
        </h2>
        <p>
          지역에서 남긴 활동 기록과 노하우, 행사 자료를 한곳에서 찾아볼 수
          있습니다.
        </p>
      </div>
      <div className="constellation-stage" aria-hidden="true">
        <div className="constellation-plane">
          <div className="constellation-halo halo-one" />
          <div className="constellation-halo halo-two" />
          <svg viewBox="0 0 700 310" preserveAspectRatio="none">
            <path
              className="constellation-line"
              d="M50 230 C190 270, 205 74, 354 108 S478 276, 655 70"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeDasharray="760"
            />
          </svg>
          <span className="constellation-node node-one">
            <b>01</b>활동 후기
          </span>
          <span className="constellation-node node-two">
            <b>02</b>행사 레시피
          </span>
          <span className="constellation-node node-three">
            <b>03</b>자료 나눔
          </span>
          <span className="constellation-node node-four">
            <b>04</b>다음 만남
          </span>
        </div>
      </div>
    </section>
  );
}
