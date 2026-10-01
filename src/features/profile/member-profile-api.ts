import { httpsCallable } from 'firebase/functions'
import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseServices } from '../../lib/firebase/client'
import {
  memberProfilePhotoPath,
  normalizeMemberProfile,
  parseMemberProfile,
  type MemberProfileInput,
  type MemberProfileValue,
} from './member-profile-model'
import { assertMemberProfilePayload } from './profile-load-state'
import { requireProfilePhotoOwner } from './account-model'

function services() {
  const value = getFirebaseServices()
  if (!value) throw new Error('Firebase is not configured')
  return value
}

export async function getMyMemberProfile(): Promise<MemberProfileValue> {
  const firebase = services()
  const callable = httpsCallable<void, { profile: unknown }>(
    firebase.functions,
    'getMyMemberProfile',
  )
  const result = await callable()
  return parseMemberProfile(assertMemberProfilePayload(result.data.profile))
}

export async function updateMyMemberProfile(input: MemberProfileInput): Promise<MemberProfileValue> {
  const firebase = services()
  const callable = httpsCallable<MemberProfileInput, { profile: unknown }>(
    firebase.functions,
    'updateMyMemberProfile',
  )
  const result = await callable(normalizeMemberProfile(input))
  return parseMemberProfile(assertMemberProfilePayload(result.data.profile))
}

type ProfilePhotoReadDependencies = {
  currentUid(): string | null
  readObject(path: string): Promise<Blob>
}

type ProfilePhotoWriteDependencies = {
  currentUid(): string | null
  uploadObject(path: string, file: File, ownerUid: string): Promise<void>
  deleteObject(path: string): Promise<void>
}

function firebaseProfilePhotoReadDependencies(): ProfilePhotoReadDependencies {
  const firebase = services()
  return {
    currentUid: () => firebase.auth.currentUser?.uid ?? null,
    readObject: (path) => getBlob(ref(firebase.storage, path)),
  }
}

function firebaseProfilePhotoWriteDependencies(): ProfilePhotoWriteDependencies {
  const firebase = services()
  return {
    currentUid: () => firebase.auth.currentUser?.uid ?? null,
    uploadObject: async (path, file, ownerUid) => {
      await uploadBytes(ref(firebase.storage, path), file, {
        contentType: file.type,
        customMetadata: { ownerUid },
      })
    },
    deleteObject: async (path) => {
      await deleteObject(ref(firebase.storage, path))
    },
  }
}

function storageErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return typeof error.code === 'string' ? error.code : ''
}

export async function readMyProfilePhoto(
  uid: string,
  dependencies: ProfilePhotoReadDependencies = firebaseProfilePhotoReadDependencies(),
): Promise<Blob | null> {
  requireProfilePhotoOwner(dependencies.currentUid(), uid)
  try {
    return await dependencies.readObject(memberProfilePhotoPath(uid))
  } catch (error: unknown) {
    if (storageErrorCode(error) === 'storage/object-not-found') return null
    throw error
  }
}

export async function uploadMyProfilePhoto(
  uid: string,
  file: File,
  dependencies: ProfilePhotoWriteDependencies = firebaseProfilePhotoWriteDependencies(),
): Promise<void> {
  requireProfilePhotoOwner(dependencies.currentUid(), uid)
  await dependencies.uploadObject(memberProfilePhotoPath(uid), file, uid)
}

export async function deleteMyProfilePhoto(
  uid: string,
  dependencies: ProfilePhotoWriteDependencies = firebaseProfilePhotoWriteDependencies(),
): Promise<void> {
  requireProfilePhotoOwner(dependencies.currentUid(), uid)
  try {
    await dependencies.deleteObject(memberProfilePhotoPath(uid))
  } catch (error: unknown) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'storage/object-not-found'
    ) {
      return
    }
    throw error
  }
}
