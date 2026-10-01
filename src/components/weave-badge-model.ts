import type { WeaveBadgeTone } from "./WeaveBadge";

export function formatBadgeTone(format: string): WeaveBadgeTone {
  const normalized = format.toUpperCase();
  if (normalized === "PDF") return "pdf";
  if (normalized === "PPTX") return "pptx";
  if (normalized === "DOCX") return "docx";
  if (normalized === "HWP" || normalized === "HWPX") return "hwp";
  if (normalized === "XLSX") return "xlsx";
  if (normalized === "LINK") return "link";
  return "neutral";
}

export function workflowBadgeTone(status: string): WeaveBadgeTone {
  const normalized = status.toLowerCase();
  if (["approved", "published", "clean", "completed", "resolved", "active"].includes(normalized)) return "success";
  if (["rejected", "blocked", "removed", "deleted", "canceled", "cancelled"].includes(normalized)) return "rejected";
  if (["error", "failed", "dead_letter"].includes(normalized)) return "danger";
  if (["held", "hold", "tentative", "revision_requested", "unpublished"].includes(normalized)) return "warning";
  if (["publishing", "working", "processing", "pending_cleanup"].includes(normalized)) return "working";
  return "pending";
}
