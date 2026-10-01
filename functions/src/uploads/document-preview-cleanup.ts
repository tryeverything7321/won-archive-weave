import { getApps, initializeApp } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { DOCUMENT_PREVIEW_PREFIX } from './document-preview.js'

if (!getApps().length) initializeApp()

export const cleanMaterialPreviewCache = onDocumentWritten({ document: 'materials/{materialId}', region: 'asia-northeast3', retry: true }, async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!before) return
  if (after && ['status', 'visibility', 'attachmentStatus', 'approvedStoragePath'].every(key => before[key] === after[key])
    && before.rights?.redistribution === after.rights?.redistribution) return
  const materialId = event.params.materialId
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(materialId)) return
  await getStorage().bucket().deleteFiles({ prefix: `${DOCUMENT_PREVIEW_PREFIX}${materialId}/`, force: true })
})
