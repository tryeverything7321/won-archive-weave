import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

if (!getApps().length) initializeApp()

export function googleAccountPatch(auth: { uid?: string; token?: Record<string, unknown> } | undefined, current?: Record<string, unknown>) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', '구글 로그인이 필요합니다')
  const firebase = auth.token?.firebase as { sign_in_provider?: unknown } | undefined
  if (firebase?.sign_in_provider !== 'google.com') throw new HttpsError('permission-denied', '구글 로그인 결과를 확인할 수 없습니다')
  if (current?.provider && current.provider !== 'google') {
    throw new HttpsError('failed-precondition', '다른 로그인 방식으로 만든 계정입니다. 기존 로그인 방식을 이용해 주세요')
  }
  return { provider: 'google', connected: true }
}

export const completeGoogleLogin = onCall({ region: 'asia-northeast3' }, async request => {
  googleAccountPatch(request.auth)
  const uid = request.auth!.uid
  const db = getFirestore()
  const user = db.collection('users').doc(uid)
  await db.runTransaction(async tx => {
    const current = await tx.get(user)
    const patch = googleAccountPatch(request.auth, current.data())
    tx.set(user, { ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(db.collection('auditEvents').doc(), {
      type: 'account.google_login', uid, at: FieldValue.serverTimestamp(),
    })
  })
  return { connected: true, provider: 'google' }
})
