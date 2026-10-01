import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { hasCurrentCommunityConsent } from '../auth/terms.js'

export type ActorRole = 'administrator' | 'moderator'

type CallableActor = {
  uid?: string
  token?: Record<string, unknown>
}

type ActorPolicyOptions = {
  allowRoles?: readonly ActorRole[]
}

type UserRecordLoader = (uid: string) => Promise<Record<string, unknown> | undefined>

export type ActorPolicyResult = {
  uid: string
  roleException: ActorRole | null
}

function actorRole(token: Record<string, unknown> | undefined): ActorRole | null {
  return token?.role === 'administrator' || token?.role === 'moderator'
    ? token.role
    : null
}

export async function evaluateActorPolicy(
  auth: CallableActor | undefined,
  loadUser: UserRecordLoader,
  options: ActorPolicyOptions = {},
): Promise<ActorPolicyResult> {
  const uid = auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다')

  const role = actorRole(auth?.token)
  if (role && options.allowRoles?.includes(role)) {
    return { uid, roleException: role }
  }

  const user = await loadUser(uid)
  if (!user || user.connected !== true) {
    throw new HttpsError('failed-precondition', '위브 계정을 다시 연결해 주세요')
  }
  if (!hasCurrentCommunityConsent(user)) {
    throw new HttpsError('failed-precondition', '최신 이용약관과 커뮤니티 규칙에 동의해 주세요')
  }
  return { uid, roleException: null }
}

export async function requireActorPolicy(
  auth: CallableActor | undefined,
  options: ActorPolicyOptions = {},
): Promise<ActorPolicyResult> {
  return evaluateActorPolicy(
    auth,
    async (uid) => {
      const snapshot = await getFirestore().collection('users').doc(uid).get()
      return snapshot.exists ? snapshot.data() : undefined
    },
    options,
  )
}
