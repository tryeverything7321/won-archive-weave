export const ONBOARDING_VERSION = '2026-07-landing-v1' as const

export type OnboardingOutcome = 'completed' | 'dismissed'

export type OnboardingState = {
  version: string
  outcome: OnboardingOutcome | null
  shouldShowAutomatically: boolean
}

export type OnboardingSaveResult = OnboardingState & {
  outcome: OnboardingOutcome
  changed: boolean
}

export function isCurrentOnboardingTerminal(state: OnboardingState): boolean {
  return state.version === ONBOARDING_VERSION && state.outcome !== null
}
