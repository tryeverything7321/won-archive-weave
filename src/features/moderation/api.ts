import { httpsCallable } from 'firebase/functions'
import { getFirebaseServices } from '../../lib/firebase/client'

export async function moderatePost(input: { postId: string; action: 'hold' | 'remove' | 'restore'; reason: string }) {
  const services = getFirebaseServices()
  if (!services) throw new Error('Firebase is not configured')
  const payload = { ...input, requestId: crypto.randomUUID() }
  const callable = httpsCallable<typeof payload, { status: 'active' | 'held' | 'removed' }>(services.functions, 'moderateCommunityContent')
  return (await callable(payload)).data
}

export async function moderateComment(input: { postId: string; commentId: string; action: 'hold' | 'remove' | 'restore'; reason: string }) {
  const services = getFirebaseServices()
  if (!services) throw new Error('Firebase is not configured')
  const payload = { ...input, requestId: crypto.randomUUID() }
  const callable = httpsCallable<typeof payload, { status: 'active' | 'held' | 'removed' }>(services.functions, 'moderateCommunityComment')
  return (await callable(payload)).data
}
