import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import styles from "./AuthoringFlow.module.css";

export type AuthoringFlowStep = {
  id: string;
  label: string;
  description: string;
};

type AuthoringFlowProps = {
  label: string;
  steps: readonly AuthoringFlowStep[];
};

export function AuthoringFlow({ label, steps }: AuthoringFlowProps) {
  const instanceId = useId();
  const reduceMotion = useReducedMotion();
  const [activeId, setActiveId] = useState(steps[0]?.id ?? "");

  return (
    <nav className={styles.flow} aria-label={label}>
      <ol>
        {steps.map((step, index) => {
          const active = activeId === step.id;
          return (
            <li className={styles.item} data-active={active || undefined} key={step.id}>
              <a
                href={`#${step.id}`}
                aria-current={active ? "step" : undefined}
                onClick={() => setActiveId(step.id)}
              >
                <span className={styles.number} aria-hidden="true">{index + 1}</span>
                <span className={styles.copy}>
                  <b>{step.label}</b>
                  <small>{step.description}</small>
                </span>
                {active && (
                  <motion.span
                    className={styles.activeLine}
                    layoutId={`${instanceId}-active-step`}
                    transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
                    aria-hidden="true"
                  />
                )}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
