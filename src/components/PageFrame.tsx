import type { ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";

export function PageFrame({
  eyebrow,
  title,
  description,
  children,
  variant = "utility",
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
  variant?: "editorial" | "utility" | "gate" | "recovery" | "detail";
}) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : 0.75;

  return (
    <section className={`page-frame page-frame-${variant} section-frame`} data-page-archetype={variant}>
      <motion.div
        className="page-intro"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: {
            transition: { staggerChildren: reduceMotion ? 0 : 0.11 },
          },
        }}
      >
        <motion.p className="page-eyebrow" variants={introItem(duration, 18)}>
          <span className="page-eyebrow-index" aria-hidden="true" />
          {eyebrow}
        </motion.p>
        <motion.h1 variants={introItem(duration, 42)}>{title}</motion.h1>
        <motion.div
          className="page-intro-rule"
          variants={{
            hidden: { scaleX: reduceMotion ? 1 : 0, opacity: 0 },
            visible: {
              scaleX: 1,
              opacity: 1,
              transition: { duration, ease: [0.22, 1, 0.36, 1] },
            },
          }}
        />
        <motion.span variants={introItem(duration, 24)}>
          {description}
        </motion.span>
      </motion.div>
      <motion.div
        className="page-content-stage"
        initial={reduceMotion ? false : { opacity: 0, y: 44 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration,
          delay: reduceMotion ? 0 : 0.38,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        {children}
      </motion.div>
    </section>
  );
}

function introItem(duration: number, distance: number): Variants {
  return {
    hidden: { opacity: 0, y: distance, filter: "blur(8px)" },
    visible: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { duration, ease: [0.22, 1, 0.36, 1] },
    },
  };
}
