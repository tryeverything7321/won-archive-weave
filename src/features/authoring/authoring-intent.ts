export type NewContributionKind = "활동 기록" | "자료";

export function contributionIntentHref(kind: NewContributionKind): string {
  return `/contribute?intent=${kind === "자료" ? "material" : "activity"}#contribution-first-input`;
}
