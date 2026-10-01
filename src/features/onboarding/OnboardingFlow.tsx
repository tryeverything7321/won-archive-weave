import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  FolderArchive,
  MessageCircleMore,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged } from "firebase/auth";
import { useLocation } from "react-router-dom";
import { getFirebaseServices } from "../../lib/firebase/client";
import { getOnboardingState, recordOnboardingOutcome } from "./onboarding-api";

const guideSteps = [
  {
    title: "흩어진 기록을 한곳에서 만나요",
    body: "활동 과정과 결과, 발표 자료와 회고를 함께 살펴볼 수 있어요.",
    icon: FolderArchive,
    accent: "#42b9ed",
  },
  {
    title: "가까운 행사와 모임을 찾아요",
    body: "전국의 일정을 날짜와 지역별로 보고, 다음 만남을 준비해요.",
    icon: CalendarDays,
    accent: "#f2ca52",
  },
  {
    title: "위브에서 생각을 나눠요",
    body: "위브에서 사용할 이름을 정한 뒤, 질문과 경험을 편안하게 나눌 수 있어요.",
    icon: MessageCircleMore,
    accent: "#69d4b3",
  },
  {
    title: "이제 위브를 둘러볼까요",
    body: "기록을 남기고, 다른 사람의 노하우를 발견하고, 다음 활동을 직접 만들어 봐요.",
    icon: Sparkles,
    accent: "#86b9ff",
  },
] as const;

type OnboardingFlowProps = {
  open: boolean;
  onClose: () => void;
  persistOutcome?: boolean;
};

export function OnboardingFlow({ open, onClose, persistOutcome = false }: OnboardingFlowProps) {
  const reduceMotion = useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const step = guideSteps[stepIndex];

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      void finish("dismissed");
      return;
    }
    if (event.key === "ArrowRight" && stepIndex < guideSteps.length - 1) {
      setStepIndex((current) => current + 1);
    }
    if (event.key === "ArrowLeft" && stepIndex > 0) {
      setStepIndex((current) => current - 1);
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [open]);

  const finish = async (outcome: "completed" | "dismissed") => {
    if (saving) return;
    if (!persistOutcome) {
      setStepIndex(0);
      setError("");
      onClose();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await recordOnboardingOutcome(outcome);
      setStepIndex(0);
      onClose();
    } catch {
      setError("안내 상태를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <AnimatePresence onExitComplete={() => {
      if (!open && openerRef.current?.isConnected) openerRef.current.focus();
    }}>
      {open && (
        <motion.div
          className="onboarding-backdrop"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="presentation"
        >
          <motion.section
            aria-labelledby="onboarding-title"
            aria-modal="true"
            className="onboarding-dialog"
            initial={reduceMotion ? false : { opacity: 0, y: 34, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            role="dialog"
            transition={{ duration: reduceMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={handleDialogKeyDown}
          >
            <div className="onboarding-topline">
              <span>처음 만나는 위브</span>
              <button
                aria-label="안내 닫기"
                disabled={saving}
                onClick={() => void finish("dismissed")}
                ref={closeButtonRef}
                type="button"
              >
                <X size={21} />
              </button>
            </div>

            <div className="onboarding-layout">
              <div className="onboarding-steps" aria-label="안내 순서">
                {guideSteps.map((item, index) => (
                  <button
                    aria-current={index === stepIndex ? "step" : undefined}
                    key={item.title}
                    onClick={() => setStepIndex(index)}
                    type="button"
                  >
                    <span>0{index + 1}</span>
                    <i />
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  className="onboarding-content"
                  key={step.title}
                  initial={reduceMotion ? false : { opacity: 0, x: 22 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, x: -16 }}
                  transition={{ duration: reduceMotion ? 0 : 0.32 }}
                >
                  <div className="onboarding-illustration" style={{ "--guide-accent": step.accent } as React.CSSProperties}>
                    <span aria-hidden="true">0{stepIndex + 1}</span>
                    <step.icon aria-hidden="true" />
                    <i aria-hidden="true" />
                  </div>
                  <div className="onboarding-copy">
                    <p>{stepIndex + 1} / {guideSteps.length}</p>
                    <h2 id="onboarding-title">{step.title}</h2>
                    <span>{step.body}</span>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="onboarding-actions">
              <button
                className="onboarding-secondary"
                disabled={stepIndex === 0 || saving}
                onClick={() => setStepIndex((current) => current - 1)}
                type="button"
              >
                <ArrowLeft size={18} /> 이전
              </button>
              {stepIndex < guideSteps.length - 1 ? (
                <button
                  className="button button-primary"
                  onClick={() => setStepIndex((current) => current + 1)}
                  type="button"
                >
                  다음 <ArrowRight size={18} />
                </button>
              ) : (
                <button
                  className="button button-primary"
                  disabled={saving}
                  onClick={() => void finish("completed")}
                  type="button"
                >
                  {saving ? "저장하는 중" : "위브 시작하기"} <ArrowRight size={18} />
                </button>
              )}
            </div>
            {error && <p className="onboarding-error" role="alert">{error}</p>}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function FirstLoginOnboardingGate() {
  const services = useMemo(() => getFirebaseServices(), []);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!services || pathname !== "/") return;
    return onAuthStateChanged(services.auth, (user) => {
      if (!user) {
        setOpen(false);
        return;
      }
      void getOnboardingState()
        .then((state) => setOpen(state.shouldShowAutomatically))
        .catch(() => setOpen(false));
    });
  }, [pathname, services]);

  return (
    <OnboardingFlow
      open={open && pathname === "/"}
      onClose={() => setOpen(false)}
      persistOutcome
    />
  );
}
