import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { disconnectAccountSession, termsAcceptancePatch } from './account-service.js'
import { currentCommunityRulesVersion, currentTermsVersion } from './terms.js'

if (!getApps().length) initializeApp()

function version(value: unknown, label: string): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}(?:-[a-z0-9-]+)?$/.test(result)) throw new HttpsError('invalid-argument', `${label} 버전을 확인해 주세요`)
  return result
}

export const acceptMemberTerms = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  const termsVersion = version(request.data?.termsVersion, '이용약관')
  const communityRulesVersion = version(request.data?.communityRulesVersion, '커뮤니티 규칙')
  if (termsVersion !== currentTermsVersion || communityRulesVersion !== currentCommunityRulesVersion) {
    throw new HttpsError('failed-precondition', '최신 이용약관과 커뮤니티 규칙을 확인해 주세요')
  }
  const firestore = getFirestore()
  await firestore.collection('users').doc(request.auth.uid).set({
    ...termsAcceptancePatch({ termsVersion, communityRulesVersion }),
    termsAcceptedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  await firestore.collection('auditEvents').doc().set({
    type: 'account.terms_accepted', uid: request.auth.uid, termsVersion, communityRulesVersion, at: FieldValue.serverTimestamp(),
  })
  return { termsVersion, communityRulesVersion }
})

export const disconnectPlatformAccount = onCall({ region: 'asia-northeast3' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  const firestore = getFirestore()
  await disconnectAccountSession(request.auth.uid, {
    async markDisconnected(uid) {
      const batch = firestore.batch()
      batch.set(firestore.collection('users').doc(uid), {
        connected: false,
        communityEligible: false,
        disconnectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      batch.set(firestore.collection('auditEvents').doc(), {
        type: 'account.disconnected',
        uid,
        at: FieldValue.serverTimestamp(),
      })
      await batch.commit()
    },
    revokeRefreshTokens: (uid) => getAuth().revokeRefreshTokens(uid),
  })
  return { disconnected: true }
})
