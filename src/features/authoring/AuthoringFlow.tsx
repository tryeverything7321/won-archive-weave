import { useId, useState, useLayoutEffect, useRef } from "react";
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

  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const header = document.querySelector<HTMLElement>(".topbar");
    if (!nav) return;
    const targets = steps.map(step => document.getElementById(step.id)).filter((node): node is HTMLElement => Boolean(node));
    const prior = targets.map(node => node.style.scrollMarginTop);
    const offset = () => {
      const headerBottom = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
      nav.style.top = `${headerBottom + 8}px`;
      return headerBottom + (getComputedStyle(nav).position === "sticky" ? nav.offsetHeight + 8 : 0) + 16;
    };
    const measure = () => { const value = offset(); targets.forEach(node => { node.style.scrollMarginTop = `${value}px`; }); };
    const focus = (event: FocusEvent) => {
      const node = event.target;
      if (!(node instanceof HTMLElement) || !nav.closest("form")?.contains(node) || nav.contains(node)) return;
      const top = node.getBoundingClientRect().top;
      const safeTop = offset();
      if (top < safeTop) window.scrollBy({top: top - safeTop, behavior: "instant"});
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    if (header) observer.observe(header);
    window.addEventListener("resize", measure);
    document.addEventListener("focusin", focus);
    measure();
    return () => {
      observer.disconnect(); window.removeEventListener("resize", measure); document.removeEventListener("focusin", focus);
      targets.forEach((node, index) => { node.style.scrollMarginTop = prior[index]; });
    };
  }, [steps]);

  return (
    <nav ref={navRef} className={styles.flow} aria-label={label}>
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
