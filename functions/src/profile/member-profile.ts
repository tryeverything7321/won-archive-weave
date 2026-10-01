import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type DocumentData } from 'firebase-admin/firestore'
import { onCall } from 'firebase-functions/v2/https'
import { evaluateActorPolicy, requireActorPolicy } from '../community/actor-policy.js'
import {
  normalizeMemberProfileInput,
  normalizeStoredMemberProfileForOwner,
  type MemberProfile,
  type MemberProfileInput,
} from './contracts.js'

if (!getApps().length) initializeApp()

type CallableActor = {
  uid?: string
  token?: Record<string, unknown>
}

type ProfileDocument = DocumentData | undefined

type MemberProfileDependencies = {
  loadUser(uid: string): Promise<Record<string, unknown> | undefined>
  loadProfile(uid: string): Promise<ProfileDocument>
  replaceProfile(uid: string, profile: MemberProfileInput): Promise<ProfileDocument>
}

function timestampIso(value: unknown): string | undefined {
  if (
    value
    && typeof value === 'object'
    && 'toDate' in value
    && typeof value.toDate === 'function'
  ) {
    const date = value.toDate()
    if (date instanceof Date && !Number.isNaN(date.valueOf())) return date.toISOString()
  }
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString()
  return undefined
}

export function memberProfileResponse(document: ProfileDocument) {
  const normalized = normalizeStoredMemberProfileForOwner(document)
  const profile: MemberProfile = {
    ...normalized,
    createdAt: timestampIso(document?.createdAt),
    updatedAt: timestampIso(document?.updatedAt),
  }
  if (!profile.createdAt) delete profile.createdAt
  if (!profile.updatedAt) delete profile.updatedAt

  return {
    profile,
  }
}

export async function getMemberProfileForActor(
  auth: CallableActor | undefined,
  dependencies: Pick<MemberProfileDependencies, 'loadUser' | 'loadProfile'>,
) {
  const { uid } = await evaluateActorPolicy(auth, dependencies.loadUser)
  return memberProfileResponse(await dependencies.loadProfile(uid))
}

export async function updateMemberProfileForActor(
  auth: CallableActor | undefined,
  input: unknown,
  dependencies: Pick<MemberProfileDependencies, 'loadUser' | 'replaceProfile'>,
) {
  const { uid } = await evaluateActorPolicy(auth, dependencies.loadUser)
  const profile = normalizeMemberProfileInput(input)
  return memberProfileResponse(await dependencies.replaceProfile(uid, profile))
}

async function loadProfile(uid: string) {
  const snapshot = await getFirestore().collection('memberProfiles').doc(uid).get()
  return snapshot.exists ? snapshot.data() : undefined
}

async function replaceProfile(uid: string, profile: MemberProfileInput) {
  const firestore = getFirestore()
  const reference = firestore.collection('memberProfiles').doc(uid)
  let result: DocumentData = profile

  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(reference)
    const createdAt = current.exists && current.get('createdAt') != null
      ? current.get('createdAt')
      : FieldValue.serverTimestamp()
    result = {
      ...profile,
      createdAt,
      updatedAt: FieldValue.serverTimestamp(),
    }
    transaction.set(reference, result)
  })
  return result
}

export const getMyMemberProfile = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  return memberProfileResponse(await loadProfile(uid))
})

export const updateMyMemberProfile = onCall({ region: 'asia-northeast3' }, async (request) => {
  const { uid } = await requireActorPolicy(request.auth)
  const profile = normalizeMemberProfileInput(request.data)
  return memberProfileResponse(await replaceProfile(uid, profile))
})
