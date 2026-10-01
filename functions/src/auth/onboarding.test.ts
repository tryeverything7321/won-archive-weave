import assert from 'node:assert/strict'
import test from 'node:test'
import { currentOnboardingVersion, onboardingMutation, onboardingStateFromAccount } from './onboarding.js'

test('new and older-version accounts are eligible for automatic onboarding', () => {
  assert.equal(onboardingStateFromAccount(undefined).shouldShowAutomatically, true)
  assert.equal(onboardingStateFromAccount({ onboardingVersion: '2026-06-v1', onboardingCompletedAt: {} }).shouldShowAutomatically, true)
})

test('completion and dismissal both stop automatic onboarding for the current version', () => {
  const completed = onboardingStateFromAccount({ onboardingVersion: currentOnboardingVersion, onboardingCompletedAt: {} })
  const dismissed = onboardingStateFromAccount({ onboardingVersion: currentOnboardingVersion, onboardingDismissedAt: {} })
  assert.deepEqual(completed, { version: currentOnboardingVersion, outcome: 'completed', shouldShowAutomatically: false })
  assert.deepEqual(dismissed, { version: currentOnboardingVersion, outcome: 'dismissed', shouldShowAutomatically: false })
})

test('recording the same version is idempotent and stale clients cannot change the terminal outcome', () => {
  const account = { onboardingVersion: currentOnboardingVersion, onboardingCompletedAt: {} }
  const repeated = onboardingMutation(account, currentOnboardingVersion, 'completed')
  const staleDismiss = onboardingMutation(account, currentOnboardingVersion, 'dismissed')
  assert.deepEqual(repeated, { changed: false, outcome: 'completed', patch: null })
  assert.deepEqual(staleDismiss, { changed: false, outcome: 'completed', patch: null })
})

test('only the current version and explicit terminal outcomes are accepted', () => {
  assert.throws(() => onboardingMutation({}, 'old', 'completed'), /latest|최신|failed-precondition/)
  assert.throws(() => onboardingMutation({}, currentOnboardingVersion, 'started'), /invalid-argument|완료 상태/)
})
