import { httpsCallable } from 'firebase/functions'
import { getFirebaseServices } from '../../lib/firebase/client'
import { ONBOARDING_VERSION, type OnboardingOutcome, type OnboardingSaveResult, type OnboardingState } from './onboarding-model'

function services() {
  const value = getFirebaseServices()
  if (!value) throw new Error('Firebase is not configured')
  return value
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const callable = httpsCallable<Record<string, never>, OnboardingState>(services().functions, 'getOnboardingState')
  return (await callable({})).data
}

export async function recordOnboardingOutcome(outcome: OnboardingOutcome): Promise<OnboardingSaveResult> {
  const callable = httpsCallable<{ version: string; outcome: OnboardingOutcome }, OnboardingSaveResult>(services().functions, 'recordOnboardingOutcome')
  return (await callable({ version: ONBOARDING_VERSION, outcome })).data
}
