import type { DraftCaptureResult, DraftCodec, DraftIdentity } from "../drafts/draft-store";

const sourceModes = ["text", "upload", "google_drive_link", "instagram_url"] as const;
const kinds = ["활동 기록", "자료", "활동 레시피"] as const;
const visibilities = ["공개", "회원 전용", "보류"] as const;
const consentBases = ["내가 만든 자료예요", "단체 담당자로 올려요", "만든 사람에게 허락받았어요"] as const;
const redistributions = ["download_allowed", "view_only", "source_link_only"] as const;

type InstagramDraftAttachment = {
  sourceUrl: string;
  mediaType: "post" | "reel";
  shortcode: string;
  originalAuthor?: string;
};

export type ContributionDraftFields = {
  sourceMode: typeof sourceModes[number];
  body: string;
  bodyFormat?: "plain" | "markdown";
  sourceLinkUrl: string;
  instagramAttachments: InstagramDraftAttachment[];
  title: string;
  source: string;
  owner: string;
  kind: typeof kinds[number];
  activityTopic: string;
  activityType: string;
  activityDate: string;
  activityPlace: string;
  activitySummary: string;
  activityStory: string;
  activityOutcome: string;
  activityNextAction: string;
  recipePurpose: string;
  recipePreparation: string;
  recipePromotion: string;
  recipeLessons: string;
  visibility: typeof visibilities[number] | null;
  visibilityExplicit: boolean;
  consentConfirmed: boolean;
  attribution: string;
  consentBasis: typeof consentBases[number];
  redistribution: typeof redistributions[number];
  sensitiveDataReviewed: boolean;
};

export type ContributionCreateReservation = {
  requestId: string;
  inputFingerprint: string;
  firstValue: ContributionDraftFields;
};

export type ContributionDraftValue = ContributionDraftFields & {
  createReservation?: ContributionCreateReservation;
};

export function emptyContributionDraftValue(
  owner: string,
  kind: typeof kinds[number],
  activityTopic: string,
): ContributionDraftValue {
  return {
    sourceMode: "text",
    body: "",
    bodyFormat: "plain",
    sourceLinkUrl: "",
    instagramAttachments: [],
    title: "",
    source: "",
    owner,
    kind,
    activityTopic,
    activityType: "",
    activityDate: "",
    activityPlace: "",
    activitySummary: "",
    activityStory: "",
    activityOutcome: "",
    activityNextAction: "",
    recipePurpose: "",
    recipePreparation: "",
    recipePromotion: "",
    recipeLessons: "",
    visibility: null,
    visibilityExplicit: false,
    consentConfirmed: false,
    attribution: "",
    consentBasis: consentBases[0],
    redistribution: "view_only",
    sensitiveDataReviewed: false,
  };
}

function stringField(record: Record<string, unknown>, key: string, maxLength: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`invalid_contribution_draft:${key}`);
  return value;
}

function oneOf<T extends readonly string[]>(record: Record<string, unknown>, key: string, values: T): T[number] {
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`invalid_contribution_draft:${key}`);
  return value as T[number];
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  if (typeof record[key] !== "boolean") throw new Error(`invalid_contribution_draft:${key}`);
  return record[key];
}

function sourceLinkField(record: Record<string, unknown>): string {
  const value = stringField(record, "sourceLinkUrl", 2_048);
  if (!value) return value;
  if (/[?&](?:[^=&]*(?:token|secret|auth|code|credential)[^=&]*)=/iu.test(value)) {
    throw new Error("invalid_contribution_draft:sourceLinkUrl");
  }
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_contribution_draft:sourceLinkUrl");
  for (const key of url.searchParams.keys()) {
    if (/token|secret|auth|code|credential/i.test(key)) throw new Error("invalid_contribution_draft:sourceLinkUrl");
  }
  return value;
}

function instagramField(record: Record<string, unknown>): InstagramDraftAttachment[] {
  if (!Array.isArray(record.instagramAttachments) || record.instagramAttachments.length > 5) {
    throw new Error("invalid_contribution_draft:instagramAttachments");
  }
  return record.instagramAttachments.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid_contribution_draft:instagramAttachments");
    const value = item as Record<string, unknown>;
    const sourceUrl = stringField(value, "sourceUrl", 256);
    const mediaType = oneOf(value, "mediaType", ["post", "reel"] as const);
    const shortcode = stringField(value, "shortcode", 64);
    const expectedUrl = `https://www.instagram.com/${mediaType === "post" ? "p" : "reel"}/${shortcode}/`;
    if (!/^[A-Za-z0-9_-]{5,64}$/.test(shortcode) || sourceUrl !== expectedUrl) throw new Error("invalid_contribution_draft:instagramAttachments");
    const originalAuthor = value.originalAuthor === undefined ? undefined : stringField(value, "originalAuthor", 30);
    if (originalAuthor && !/^[A-Za-z0-9._]{1,30}$/.test(originalAuthor)) throw new Error("invalid_contribution_draft:instagramAttachments");
    return { sourceUrl, mediaType, shortcode, ...(originalAuthor ? { originalAuthor } : {}) };
  });
}

function decodeContributionDraftFields(value: unknown): ContributionDraftFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_contribution_draft");
  const record = value as Record<string, unknown>;
  const visibility = record.visibility === null ? null : oneOf(record, "visibility", visibilities);
  const visibilityExplicit = record.visibilityExplicit === undefined
    ? false
    : booleanField(record, "visibilityExplicit");
  if (visibilityExplicit && visibility === null) throw new Error("invalid_contribution_draft:visibility");
  return {
    sourceMode: oneOf(record, "sourceMode", sourceModes),
    body: stringField(record, "body", 50_000),
    ...(record.bodyFormat === undefined ? {} : { bodyFormat: oneOf(record, "bodyFormat", ["plain", "markdown"] as const) }),
    sourceLinkUrl: sourceLinkField(record),
    instagramAttachments: instagramField(record),
    title: stringField(record, "title", 120),
    source: stringField(record, "source", 240),
    owner: stringField(record, "owner", 160),
    kind: oneOf(record, "kind", kinds),
    activityTopic: stringField(record, "activityTopic", 120),
    activityType: stringField(record, "activityType", 120),
    activityDate: stringField(record, "activityDate", 40),
    activityPlace: stringField(record, "activityPlace", 200),
    activitySummary: stringField(record, "activitySummary", 600),
    activityStory: stringField(record, "activityStory", 2_000),
    activityOutcome: stringField(record, "activityOutcome", 1_000),
    activityNextAction: stringField(record, "activityNextAction", 1_000),
    recipePurpose: stringField(record, "recipePurpose", 300),
    recipePreparation: stringField(record, "recipePreparation", 500),
    recipePromotion: stringField(record, "recipePromotion", 400),
    recipeLessons: stringField(record, "recipeLessons", 500),
    visibility,
    visibilityExplicit,
    consentConfirmed: booleanField(record, "consentConfirmed"),
    attribution: stringField(record, "attribution", 240),
    consentBasis: oneOf(record, "consentBasis", consentBases),
    redistribution: oneOf(record, "redistribution", redistributions),
    sensitiveDataReviewed: booleanField(record, "sensitiveDataReviewed"),
  };
}

function createReservationField(record: Record<string, unknown>): ContributionCreateReservation | undefined {
  if (record.createReservation === undefined) return undefined;
  if (!record.createReservation || typeof record.createReservation !== "object" || Array.isArray(record.createReservation)) {
    throw new Error("invalid_contribution_draft:createReservation");
  }
  const reservation = record.createReservation as Record<string, unknown>;
  const requestId = stringField(reservation, "requestId", 128);
  const inputFingerprint = stringField(reservation, "inputFingerprint", 500_000);
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(requestId) || !inputFingerprint) {
    throw new Error("invalid_contribution_draft:createReservation");
  }
  const firstValue = decodeContributionDraftFields(reservation.firstValue);
  const legacyFirstValue = reservation.firstValue as Record<string, unknown>;
  return {
    requestId,
    inputFingerprint,
    firstValue: legacyFirstValue.visibilityExplicit === undefined && firstValue.visibility !== null
      ? { ...firstValue, visibilityExplicit: true }
      : firstValue,
  };
}

function decodeContributionDraft(value: unknown): ContributionDraftValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_contribution_draft");
  const record = value as Record<string, unknown>;
  const createReservation = createReservationField(record);
  return {
    ...decodeContributionDraftFields(record),
    ...(createReservation ? { createReservation } : {}),
  };
}

export const contributionDraftCodec: DraftCodec<ContributionDraftValue> = {
  encode: decodeContributionDraft,
  decode: decodeContributionDraft,
};

export function contributionDraftFields(value: ContributionDraftValue): ContributionDraftFields {
  return decodeContributionDraftFields(value);
}

export function contributionSubmissionPayload(value: ContributionDraftFields): Record<string, unknown> {
  if (!value.visibility || !value.visibilityExplicit) throw new Error("공개 범위를 선택해 주세요.");
  const resolvedSource = value.source.trim() || (
    value.sourceMode === "text" ? "작성자 직접 작성" : value.sourceMode === "upload"
      ? "위브에 직접 올린 파일"
      : value.sourceMode === "google_drive_link"
        ? "Google 원본 링크"
        : "Instagram 원문 링크"
  );
  const resolvedOwner = value.owner.trim();
  const hasActivityDetails = value.kind === "활동 기록" || value.kind === "활동 레시피";
  const hasRecipeDetails = value.kind === "활동 레시피" && Boolean(
    value.recipePurpose.trim()
    || value.recipePreparation.trim()
    || value.recipePromotion.trim()
    || value.recipeLessons.trim(),
  );
  return {
    title: value.title,
    sourceMode: value.sourceMode,
    textContent: { schemaVersion: 1, format: value.bodyFormat ?? "markdown", body: value.body },
    ...(value.sourceMode === "google_drive_link"
      ? { sourceLinkUrl: value.sourceLinkUrl.trim() }
      : value.sourceMode === "instagram_url" ? { instagramAttachments: value.instagramAttachments } : {}),
    source: resolvedSource,
    owner: resolvedOwner,
    kind: value.kind,
    ...(hasActivityDetails ? {
      activity: {
        topic: value.activityTopic,
        type: value.activityType,
        date: value.activityDate,
        place: value.activityPlace,
        summary: value.activitySummary.trim() || value.title.trim(),
        story: value.activityStory,
        outcome: value.activityOutcome,
        nextAction: value.activityNextAction,
      },
    } : {}),
    ...(hasRecipeDetails ? {
      recipe: {
        purpose: value.recipePurpose,
        preparation: value.recipePreparation,
        promotion: value.recipePromotion,
        lessons: value.recipeLessons,
      },
    } : {}),
    visibility: value.visibility,
    consentConfirmed: value.consentConfirmed,
    attribution: value.attribution.trim() || resolvedOwner,
    consentBasis: value.consentBasis,
    redistribution: value.sourceMode === "text"
      ? "view_only"
      : value.sourceMode === "upload" ? value.redistribution : "source_link_only",
    retention: value.sourceMode === "upload" || value.sourceMode === "text" ? "managed" : "source_link",
    sensitiveDataReviewed: value.sensitiveDataReviewed,
  };
}

export function contributionDraftIdentity(ownerId: string, entryKind: typeof kinds[number], documentId: string): DraftIdentity {
  return { ownerId, kind: `contribution:${entryKind}`, documentId: documentId || "new" };
}

export function contributionDraftFileReselection(
  sourceMode: typeof sourceModes[number],
  hasSelectedFile: boolean,
): boolean | undefined {
  if (sourceMode !== "upload") return false;
  return hasSelectedFile ? true : undefined;
}

export function savedContributionDraftRevision(result: DraftCaptureResult | undefined): string | undefined {
  return result?.status === "saved" ? result.revision : undefined;
}

export function contributionDraftActive(
  hasAuthenticatedOwner: boolean,
  isEditing: boolean,
  editLoad: "loading" | "ready" | "error",
): boolean {
  return hasAuthenticatedOwner && (!isEditing || editLoad === "ready");
}
