import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type DocumentData } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

if (!getApps().length) initializeApp()

export const currentOnboardingVersion = '2026-07-landing-v1'

export type OnboardingOutcome = 'completed' | 'dismissed'

export type OnboardingState = {
  version: string
  outcome: OnboardingOutcome | null
  shouldShowAutomatically: boolean
}

export function onboardingStateFromAccount(account: DocumentData | undefined): OnboardingState {
  const version = typeof account?.onboardingVersion === 'string' ? account.onboardingVersion : ''
  const completed = account?.onboardingCompletedAt != null
  const dismissed = account?.onboardingDismissedAt != null
  const outcome = completed ? 'completed' : dismissed ? 'dismissed' : null
  return {
    version,
    outcome,
    shouldShowAutomatically: version !== currentOnboardingVersion || outcome === null,
  }
}

export function onboardingMutation(
  account: DocumentData | undefined,
  requestedVersion: unknown,
  requestedOutcome: unknown,
) {
  if (requestedVersion !== currentOnboardingVersion) {
    throw new HttpsError('failed-precondition', '최신 위브 안내를 다시 불러와 주세요')
  }
  if (requestedOutcome !== 'completed' && requestedOutcome !== 'dismissed') {
    throw new HttpsError('invalid-argument', '안내 완료 상태를 확인해 주세요')
  }
  const current = onboardingStateFromAccount(account)
  if (current.version === currentOnboardingVersion && current.outcome) {
    return { changed: false, outcome: current.outcome, patch: null }
  }
  const timestampField = requestedOutcome === 'completed' ? 'onboardingCompletedAt' : 'onboardingDismissedAt'
  const obsoleteTimestampField = requestedOutcome === 'completed' ? 'onboardingDismissedAt' : 'onboardingCompletedAt'
  return {
    changed: true,
    outcome: requestedOutcome,
    patch: {
      onboardingVersion: currentOnboardingVersion,
      [timestampField]: FieldValue.serverTimestamp(),
      [obsoleteTimestampField]: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
  }
}

function requireUid(uid: string | undefined) {
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  return uid
}

export const getOnboardingState = onCall({ region: 'asia-northeast3' }, async (request) => {
  const uid = requireUid(request.auth?.uid)
  const snapshot = await getFirestore().collection('users').doc(uid).get()
  return onboardingStateFromAccount(snapshot.data())
})

export const recordOnboardingOutcome = onCall({ region: 'asia-northeast3' }, async (request) => {
  const uid = requireUid(request.auth?.uid)
  const firestore = getFirestore()
  const reference = firestore.collection('users').doc(uid)
  let result: ReturnType<typeof onboardingMutation> | undefined
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    result = onboardingMutation(snapshot.data(), request.data?.version, request.data?.outcome)
    if (result.patch) transaction.set(reference, result.patch, { merge: true })
  })
  if (!result) throw new HttpsError('internal', '안내 상태를 저장하지 못했어요')
  return {
    version: currentOnboardingVersion,
    outcome: result.outcome,
    shouldShowAutomatically: false,
    changed: result.changed,
  }
})
