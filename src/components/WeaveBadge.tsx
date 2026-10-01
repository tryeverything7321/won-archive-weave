import type { ReactNode } from "react";

export type WeaveBadgeFamily =
  | "format"
  | "access"
  | "provenance"
  | "workflow"
  | "classification"
  | "identity";

export type WeaveBadgeTone =
  | "neutral"
  | "pdf"
  | "pptx"
  | "docx"
  | "hwp"
  | "xlsx"
  | "link"
  | "public"
  | "restricted"
  | "fixture"
  | "official"
  | "pending"
  | "working"
  | "warning"
  | "success"
  | "danger"
  | "rejected"
  | "kakao"
  | "naver";

type WeaveBadgeProps = {
  family: WeaveBadgeFamily;
  tone?: WeaveBadgeTone;
  size?: "compact" | "regular";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
};

export function WeaveBadge({
  family,
  tone = "neutral",
  size = "regular",
  icon,
  children,
  className = "",
  title,
}: WeaveBadgeProps) {
  return (
    <span
      className={`weave-badge weave-badge-${family} weave-badge-${tone} weave-badge-${size}${className ? ` ${className}` : ""}`}
      data-badge-family={family}
      data-badge-tone={tone}
      title={title}
    >
      {icon && <span className="weave-badge-icon" aria-hidden="true">{icon}</span>}
      <span className="weave-badge-label">{children}</span>
    </span>
  );
}
