export type GoogleImportResult = {
  submitted: number;
  duplicates: number;
  failed: number;
  status: "published" | "partial_failure" | "failed";
  results: Array<{ index: number; status: "published" | "duplicate" | "failed" }>;
};

export function googleImportResultModel(selectedIds: string[], result: GoogleImportResult) {
  const validCount = (value: number) => Number.isInteger(value) && value >= 0 && value <= selectedIds.length;
  if (!validCount(result.submitted) || !validCount(result.duplicates) || !validCount(result.failed)
    || result.submitted + result.duplicates + result.failed !== selectedIds.length
    || !Array.isArray(result.results) || result.results.length !== selectedIds.length) {
    throw new Error("invalid_google_import_result");
  }
  const seen = new Set<number>();
  for (const item of result.results) {
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= selectedIds.length
      || seen.has(item.index) || !["published", "duplicate", "failed"].includes(item.status)) {
      throw new Error("invalid_google_import_result");
    }
    seen.add(item.index);
  }
  const submitted = result.results.filter((item) => item.status === "published").length;
  const duplicates = result.results.filter((item) => item.status === "duplicate").length;
  const retryIds = result.results.flatMap((item) => item.status === "failed" ? [selectedIds[item.index]] : []);
  if (submitted !== result.submitted || duplicates !== result.duplicates || retryIds.length !== result.failed) {
    throw new Error("invalid_google_import_result");
  }
  if (retryIds.length > 0) {
    return {
      retryIds,
      tone: "error" as const,
      message: `${submitted}개의 일정을 올렸어요.${duplicates ? ` 이미 올린 일정 ${duplicates}개는 제외했고,` : ""} 실패한 일정 ${retryIds.length}개만 다시 선택해 두었어요.`,
    };
  }
  return {
    retryIds,
    tone: "done" as const,
    message: `${submitted}개의 일정을 위브에 올렸어요${duplicates ? `. 이미 올린 일정 ${duplicates}개는 제외했어요.` : "."}`,
  };
}
