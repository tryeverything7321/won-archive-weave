export const maxInstagramAttachments = 5;

export type InstagramPostAttachmentValue = {
  sourceUrl: string;
  mediaType: "post" | "reel";
  shortcode: string;
  originalAuthor?: string;
};

export class InstagramUrlError extends Error {
  constructor(
    public readonly code: "invalid_url" | "unsupported_url" | "duplicate" | "too_many" | "invalid_author",
    message: string,
  ) {
    super(message);
  }
}

const supportedHosts = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
const shortcodePattern = /^[A-Za-z0-9_-]{5,64}$/;
const authorPattern = /^[A-Za-z0-9._]{1,30}$/;

export function normalizeInstagramPostUrl(value: string): InstagramPostAttachmentValue {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new InstagramUrlError("invalid_url", "Instagram 게시물이나 릴 링크를 확인해 주세요");
  }
  if (
    url.protocol !== "https:" ||
    !supportedHosts.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new InstagramUrlError("unsupported_url", "공개 Instagram 게시물이나 릴 링크만 연결할 수 있어요");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || (parts[0] !== "p" && parts[0] !== "reel") || !shortcodePattern.test(parts[1])) {
    throw new InstagramUrlError("unsupported_url", "공개 Instagram 게시물이나 릴 링크만 연결할 수 있어요");
  }
  const mediaType = parts[0] === "p" ? "post" : "reel";
  const shortcode = parts[1];
  return {
    sourceUrl: `https://www.instagram.com/${mediaType === "post" ? "p" : "reel"}/${shortcode}/`,
    mediaType,
    shortcode,
  };
}

export function normalizeInstagramAuthor(value: string): string | undefined {
  const author = value.trim().replace(/^@/, "");
  if (!author) return undefined;
  if (!authorPattern.test(author)) {
    throw new InstagramUrlError("invalid_author", "작성자 계정은 영문, 숫자, 마침표, 밑줄로 입력해 주세요");
  }
  return author;
}

export function appendInstagramAttachment(
  current: InstagramPostAttachmentValue[],
  url: string,
  author = "",
): InstagramPostAttachmentValue[] {
  if (current.length >= maxInstagramAttachments) {
    throw new InstagramUrlError("too_many", `Instagram 링크는 ${maxInstagramAttachments}개까지 연결할 수 있어요`);
  }
  const normalized = normalizeInstagramPostUrl(url);
  if (current.some((item) => item.sourceUrl === normalized.sourceUrl)) {
    throw new InstagramUrlError("duplicate", "이미 연결한 Instagram 링크예요");
  }
  const originalAuthor = normalizeInstagramAuthor(author);
  return [...current, { ...normalized, ...(originalAuthor ? { originalAuthor } : {}) }];
}

export function readInstagramAttachments(value: unknown): InstagramPostAttachmentValue[] {
  if (!Array.isArray(value)) return [];
  const attachments: InstagramPostAttachmentValue[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, maxInstagramAttachments)) {
    if (!item || typeof item !== "object") continue;
    const data = item as Record<string, unknown>;
    if (typeof data.sourceUrl !== "string") continue;
    try {
      const normalized = normalizeInstagramPostUrl(data.sourceUrl);
      if (seen.has(normalized.sourceUrl)) continue;
      const originalAuthor = typeof data.originalAuthor === "string"
        ? normalizeInstagramAuthor(data.originalAuthor)
        : undefined;
      seen.add(normalized.sourceUrl);
      attachments.push({ ...normalized, ...(originalAuthor ? { originalAuthor } : {}) });
    } catch {
      // Public readers ignore malformed legacy values instead of exposing unchecked URLs.
    }
  }
  return attachments;
}
