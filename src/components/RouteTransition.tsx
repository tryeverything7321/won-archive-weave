import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

type RouteTransitionProps = {
  routeKey: string;
  children: ReactNode;
};

export function RouteTransition({ routeKey, children }: RouteTransitionProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="route-stage"
      data-route={routeKey}
      initial={
        reduceMotion
          ? { opacity: 1 }
          : { opacity: 0, y: 34, rotateX: 5, scale: 0.985 }
      }
      animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
      exit={
        reduceMotion
          ? { opacity: 1 }
          : { opacity: 0, y: -20, rotateX: -3, scale: 1.008 }
      }
      transition={{
        duration: reduceMotion ? 0 : 0.58,
        ease: [0.22, 1, 0.36, 1],
      }}
      style={{ transformPerspective: 1400, transformOrigin: "50% 8%" }}
    >
      {children}
    </motion.div>
  );
}
