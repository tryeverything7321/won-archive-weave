import { httpsCallable } from 'firebase/functions'
import { getFirebaseServices } from '../../lib/firebase/client'

function functions() {
  const services = getFirebaseServices()
  if (!services) throw new Error('연결을 확인한 뒤 다시 시도해 주세요.')
  return services.functions
}

export async function getActivityMaterialLinks(activityId: string) {
  return (await httpsCallable<{ activityId: string }, { activityId: string; materialIds: string[] }>(functions(), 'getActivityMaterialLinks')({ activityId })).data
}
export async function setActivityMaterialLinks(activityId: string, materialIds: string[], requestId: string) {
  return (await httpsCallable<{ activityId: string; materialIds: string[]; requestId: string }, { activityId: string; linkedMaterialIds: string[]; repeated: boolean }>(functions(), 'setActivityMaterialLinks')({ activityId, materialIds, requestId })).data
}
export async function getMaterialLinkImpact(materialId: string) {
  return (await httpsCallable<{ materialId: string }, { materialId: string; linkedActivityCount: number; hasMore: boolean }>(functions(), 'getMaterialLinkImpact')({ materialId })).data
}
