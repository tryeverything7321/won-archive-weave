export const currentTermsVersion = '2026-07-20'
export const currentCommunityRulesVersion = '2026-07-20'

export function hasCurrentCommunityConsent(value: { termsVersion?: unknown; communityRulesVersion?: unknown }): boolean {
  return value.termsVersion === currentTermsVersion && value.communityRulesVersion === currentCommunityRulesVersion
}
