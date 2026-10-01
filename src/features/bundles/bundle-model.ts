import { uploadContentType, uploadFileError } from "../uploads/file-policy";

export const maximumBundleFiles = 10;
export const maximumBundleFileBytes = 20 * 1024 * 1024;
export const maximumBundleBytes = 100 * 1024 * 1024;

export type BundleVisibility = "공개" | "회원 전용" | "보류";
export type BundleRights = "download_allowed" | "view_only" | "source_link_only";
export type BundleRightsRecord = {
  source: string;
  owner: string;
  attribution: string;
  redistribution: BundleRights;
  consentBasis: string;
  sensitiveDataReviewed: true;
  retention: "managed" | "source_link" | "takedown_pending";
  reviewDueAtMs: number;
};
export type BundleFileStatus = "upload_pending" | "scanning" | "ready" | "blocked" | "error" | "withdrawn";

export type LocalBundleFile = {
  clientFileId: string;
  file: File;
  displayName: string;
  order: number;
  status: "selected" | "hashing" | "uploading" | "uploaded" | "failed";
  progress: number;
  error?: string;
  fileId?: string;
  revision?: number;
};

export type MaterialBundleFile = {
  fileId: string;
  revision: number;
  originalName: string;
  displayName: string;
  order: number;
  sizeBytes: number;
  contentType: string;
  status: BundleFileStatus;
  scanStatus: "pending" | "clean" | "blocked" | "error";
};

export type MaterialBundle = {
  bundleId: string;
  title: string;
  description: string;
  ownerLabel: string;
  sourceLabel: string;
  attributionLabel: string;
  visibility: BundleVisibility;
  rights: BundleRights;
  rightsRecord?: BundleRightsRecord;
  status: "draft" | "active" | "withdrawn";
  eventId?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  files: MaterialBundleFile[];
};

export function baseFileName(name: string): string {
  const leaf = name.replace(/\\/gu, "/").split("/").pop() ?? name;
  return leaf.replace(/\.[^.]+$/u, "").trim() || "새 자료";
}

export function suggestedBundleTitle(files: readonly Pick<File, "name">[]): string {
  if (files.length === 0) return "";
  const first = baseFileName(files[0].name);
  return files.length === 1 ? first : `${first} 외 ${files.length - 1}개`;
}

export function bundleSelectionError(
  current: readonly Pick<LocalBundleFile, "file">[],
  incoming: readonly Pick<File, "name" | "size" | "type">[],
): string | null {
  if (current.length + incoming.length > maximumBundleFiles) return "한 묶음에는 파일을 10개까지 올릴 수 있어요.";
  const invalid = incoming.map(uploadFileError).find(Boolean);
  if (invalid) return invalid;
  const total = [...current.map((item) => item.file.size), ...incoming.map((file) => file.size)]
    .reduce((sum, size) => sum + size, 0);
  if (total > maximumBundleBytes) return "한 묶음의 파일은 모두 합해 100MB 이하로 올려 주세요.";
  return null;
}

export function createLocalBundleFiles(files: readonly File[]): LocalBundleFile[] {
  return files.map((file, index) => ({
    clientFileId: crypto.randomUUID(),
    file,
    displayName: baseFileName(file.name),
    order: index,
    status: "selected",
    progress: 0,
  }));
}

export function reorderBundleFiles<T extends { order: number }>(files: readonly T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= files.length || to >= files.length || from === to) return [...files];
  const next = [...files];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next.map((file, order) => ({ ...file, order }));
}

export function bundleFileDescriptor(item: LocalBundleFile, sha256: string, replaceFileId?: string) {
  return {
    clientFileId: item.clientFileId,
    name: item.file.name,
    displayName: item.displayName.trim() || baseFileName(item.file.name),
    order: item.order,
    size: item.file.size,
    contentType: uploadContentType(item.file),
    sha256,
    ...(replaceFileId ? { replaceFileId } : {}),
  };
}

export function serverBundleVisibility(visibility: BundleVisibility): "public" | "member_only" | "hold" {
  if (visibility === "공개") return "public";
  if (visibility === "회원 전용") return "member_only";
  return "hold";
}

export function displayBundleVisibility(value: unknown): BundleVisibility {
  if (value === "public" || value === "공개") return "공개";
  if (value === "member_only" || value === "회원 전용") return "회원 전용";
  return "보류";
}

export function createBundleRightsRecord(input: {
  source: string;
  owner: string;
  attribution: string;
  redistribution: BundleRights;
  consentBasis: string;
  nowMs?: number;
}): BundleRightsRecord {
  return {
    source: input.source.trim(),
    owner: input.owner.trim(),
    attribution: input.attribution.trim(),
    redistribution: input.redistribution,
    consentBasis: input.consentBasis.trim(),
    sensitiveDataReviewed: true,
    retention: input.redistribution === "source_link_only" ? "source_link" : "managed",
    reviewDueAtMs: (input.nowMs ?? Date.now()) + 2 * 365 * 24 * 60 * 60 * 1_000,
  };
}

export function bundleFileStatusCopy(status: BundleFileStatus) {
  if (status === "ready") return { label: "열람 가능", tone: "success" as const, actionable: true };
  if (status === "scanning" || status === "upload_pending") return { label: "안전 확인 중", tone: "working" as const, actionable: false };
  if (status === "blocked") return { label: "안전 검사 차단", tone: "error" as const, actionable: false };
  if (status === "error") return { label: "처리 실패", tone: "error" as const, actionable: false };
  return { label: "공개 중단", tone: "neutral" as const, actionable: false };
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseFile(value: unknown): MaterialBundleFile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const statuses = new Set<BundleFileStatus>(["upload_pending", "scanning", "ready", "blocked", "error", "withdrawn"]);
  const scans = new Set(["pending", "clean", "blocked", "error"] as const);
  if (!text(row.fileId, 160) || !statuses.has(row.status as BundleFileStatus) || !scans.has(row.scanStatus as never)) return null;
  return {
    fileId: text(row.fileId, 160),
    revision: Number.isSafeInteger(row.revision) ? Number(row.revision) : 1,
    originalName: text(row.originalName, 160),
    displayName: text(row.displayName, 160) || text(row.originalName, 160),
    order: Number.isSafeInteger(row.order) ? Number(row.order) : 0,
    sizeBytes: Number.isSafeInteger(row.sizeBytes) ? Number(row.sizeBytes) : 0,
    contentType: text(row.contentType, 160),
    status: row.status as BundleFileStatus,
    scanStatus: row.scanStatus as MaterialBundleFile["scanStatus"],
  };
}

export function parseMaterialBundle(value: unknown): MaterialBundle {
  if (!value || typeof value !== "object") throw new Error("자료 묶음 응답을 확인하지 못했어요.");
  const row = value as Record<string, unknown>;
  const bundleId = text(row.bundleId, 160);
  const title = text(row.title, 160);
  if (!bundleId || !title || !Array.isArray(row.files)) throw new Error("자료 묶음 응답을 확인하지 못했어요.");
  const visibility = displayBundleVisibility(row.visibility);
  const rawRights = row.rights && typeof row.rights === "object" ? row.rights as Record<string, unknown> : null;
  const redistribution: BundleRights = rawRights?.redistribution === "download_allowed" || rawRights?.redistribution === "source_link_only"
    ? rawRights.redistribution
    : row.rights === "download_allowed" || row.rights === "source_link_only" ? row.rights : "view_only";
  const rightsRecord = rawRights && text(rawRights.source, 160) && text(rawRights.owner, 160) && text(rawRights.attribution, 160) && text(rawRights.consentBasis, 500)
    ? {
        source: text(rawRights.source, 160),
        owner: text(rawRights.owner, 160),
        attribution: text(rawRights.attribution, 160),
        redistribution,
        consentBasis: text(rawRights.consentBasis, 500),
        sensitiveDataReviewed: true as const,
        retention: rawRights.retention === "source_link"
          ? "source_link" as const
          : rawRights.retention === "takedown_pending" ? "takedown_pending" as const : "managed" as const,
        reviewDueAtMs: typeof rawRights.reviewDueAtMs === "number" ? rawRights.reviewDueAtMs : Date.now() + 365 * 24 * 60 * 60 * 1_000,
      }
    : undefined;
  const status = row.status === "active" || row.status === "withdrawn" ? row.status : "draft";
  return {
    bundleId,
    title,
    description: text(row.description, 5_000),
    ownerLabel: text(row.ownerLabel, 160),
    sourceLabel: rawRights ? text(rawRights.source, 160) : "",
    attributionLabel: rawRights ? text(rawRights.attribution, 160) : "",
    visibility,
    rights: redistribution,
    ...(rightsRecord ? { rightsRecord } : {}),
    status,
    ...(text(row.eventId, 160) ? { eventId: text(row.eventId, 160) } : {}),
    ...(typeof row.createdAtMs === "number" ? { createdAtMs: row.createdAtMs } : {}),
    ...(typeof row.updatedAtMs === "number" ? { updatedAtMs: row.updatedAtMs } : {}),
    files: row.files.map(parseFile).filter((file): file is MaterialBundleFile => file !== null).sort((a, b) => a.order - b.order),
  };
}
