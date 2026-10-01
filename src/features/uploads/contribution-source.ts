export type SourceMode = "text" | "upload" | "google_drive_link" | "instagram_url";
export type Redistribution = "download_allowed" | "view_only" | "source_link_only";

/** Clear the native input after reading so choosing the same file emits change again. */
export function consumeFileSelection<T>(input: { files: ArrayLike<T> | null; value: string }): T | null {
  const selected = input.files?.[0] ?? null;
  input.value = "";
  return selected;
}

export function redistributionForSourceSelection(
  editing: boolean,
  nextMode: SourceMode,
  current: Redistribution,
): Redistribution {
  return !editing && nextMode === "upload" ? "download_allowed" : current;
}

export const sourceModeOptions: ReadonlyArray<{
  value: SourceMode;
  label: string;
  description: string;
}> = [
  { value: "text", label: "글만 올리기", description: "회의록이나 공유할 내용을 직접 적거나 붙여 넣으세요. 파일 없이 바로 게시할 수 있어요." },
  {
    value: "upload",
    label: "파일",
    description: "위브에 파일을 보관하고 안전 검사가 끝난 뒤 공개해요.",
  },
  {
    value: "google_drive_link",
    label: "Google",
    description: "Drive, Docs, Sheets, Slides의 공개 원본 링크를 연결해요.",
  },
  {
    value: "instagram_url",
    label: "Instagram",
    description: "공개 게시물이나 릴의 원문 링크만 연결해요.",
  },
];

export function sourceSpecificFields<T>(
  sourceMode: SourceMode,
  sourceLinkUrl: string,
  instagramAttachments: T[],
): { sourceLinkUrl?: string; instagramAttachments?: T[] } {
  if (sourceMode === "google_drive_link") {
    return { sourceLinkUrl: sourceLinkUrl.trim() };
  }
  if (sourceMode === "instagram_url") {
    return { instagramAttachments };
  }
  return {};
}
