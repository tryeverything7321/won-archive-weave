import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, Timestamp, getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  decodeOperatorAuditCursor,
  encodeOperatorAuditCursor,
  operatorAuditPageSize,
  projectOperatorAuditEvent,
  type OperatorAuditCursor,
  type OperatorAuditEvent,
} from './audit-model.js'

if (!getApps().length) initializeApp()

const auditScanBatchSize = 100
const auditMaximumScannedDocuments = 1_000

function requireOperator(auth: { uid?: string; token?: Record<string, unknown> } | undefined): void {
  if (!auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  if (auth.token?.role !== 'moderator' && auth.token?.role !== 'administrator') {
    throw new HttpsError('permission-denied', '운영 권한이 필요합니다')
  }
}

function cursorFor(document: QueryDocumentSnapshot): OperatorAuditCursor | null {
  const at = document.get('at')
  return at instanceof Timestamp ? { seconds: at.seconds, nanoseconds: at.nanoseconds, id: document.id } : null
}

export const listOperatorAuditEvents = onCall({ region: 'asia-northeast3' }, async (request) => {
  requireOperator(request.auth)
  const pageSize = operatorAuditPageSize(request.data?.limit)
  let scanCursor = decodeOperatorAuditCursor(request.data?.cursor)
  const firestore = getFirestore()
  const accepted: Array<{ event: OperatorAuditEvent; cursor: OperatorAuditCursor }> = []
  let scanned = 0
  let queryExhausted = false
  let lastScannedCursor: OperatorAuditCursor | null = scanCursor

  while (accepted.length < pageSize + 1 && scanned < auditMaximumScannedDocuments && !queryExhausted) {
    const batchSize = Math.min(auditScanBatchSize, auditMaximumScannedDocuments - scanned)
    let query = firestore.collection('auditEvents')
      .orderBy('at', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(batchSize)
    if (scanCursor) query = query.startAfter(new Timestamp(scanCursor.seconds, scanCursor.nanoseconds), scanCursor.id)
    const snapshot = await query.get()
    if (snapshot.empty) {
      queryExhausted = true
      break
    }
    scanned += snapshot.size
    queryExhausted = snapshot.size < batchSize
    for (const document of snapshot.docs) {
      const cursor = cursorFor(document)
      if (!cursor) continue
      scanCursor = cursor
      lastScannedCursor = cursor
      const event = projectOperatorAuditEvent(document.id, document.data(), document.get('at').toMillis())
      if (event) accepted.push({ event, cursor })
      if (accepted.length >= pageSize + 1) break
    }
  }

  const items = accepted.slice(0, pageSize).map(({ event }) => event)
  const hasMore = accepted.length > pageSize || !queryExhausted
  const boundary = accepted.length >= pageSize
    ? accepted[pageSize - 1]?.cursor ?? lastScannedCursor
    : lastScannedCursor
  return {
    items,
    nextCursor: hasMore && boundary ? encodeOperatorAuditCursor(boundary) : null,
    hasMore,
    asOfMs: Date.now(),
    completeness: scanned >= auditMaximumScannedDocuments && accepted.length <= pageSize && !queryExhausted
      ? 'partial' as const
      : 'complete' as const,
  }
})
