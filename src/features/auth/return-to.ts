const defaultOAuthReturnTo = "/community";

export function safeOAuthReturnTo(
  value: string | null | undefined,
  fallback = defaultOAuthReturnTo,
): string {
  const candidate = value?.trim();
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//")
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://weave.invalid");
    if (parsed.origin !== "https://weave.invalid") return fallback;
    if (
      parsed.pathname === "/auth/complete" ||
      parsed.pathname.startsWith("/oauth/")
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export { defaultOAuthReturnTo };
