import { createHash } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { reviewSocialImport, type InstagramConnection, type InstagramRepository, type SocialImport } from './instagram-service.js'

const MAX_IMPORTS_PER_CONNECTION = 400

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function connectionWrite(connection: InstagramConnection): Record<string, unknown> {
  return {
    ...withoutUndefined(connection),
    syncCursor: connection.syncCursor ?? FieldValue.delete(),
    syncCycleSeenProviderIds: connection.syncCycleSeenProviderIds ?? FieldValue.delete(),
    nextSyncAtMs: connection.nextSyncAtMs ?? FieldValue.delete(),
    disconnectedAtMs: connection.disconnectedAtMs ?? FieldValue.delete(),
  }
}

function importWrite(item: SocialImport): Record<string, unknown> {
  return {
    ...withoutUndefined(item),
    reviewedAtMs: item.reviewedAtMs ?? FieldValue.delete(),
    reviewerUid: item.reviewerUid ?? FieldValue.delete(),
  }
}

function importDocumentId(connectionId: string, providerId: string): string {
  return createHash('sha256').update(`${connectionId}\u0000${providerId}`).digest('hex')
}

export class FirestoreInstagramRepository implements InstagramRepository {
  constructor(private readonly firestore: Firestore) {}

  async getConnection(connectionId: string): Promise<InstagramConnection | null> {
    const snapshot = await this.firestore.collection('socialConnections').doc(connectionId).get()
    return snapshot.exists ? snapshot.data() as InstagramConnection : null
  }

  async saveConnection(connection: InstagramConnection): Promise<void> {
    await this.firestore.collection('socialConnections').doc(connection.id).set(connectionWrite(connection), { merge: true })
  }

  async getImports(connectionId: string): Promise<SocialImport[]> {
    const snapshot = await this.firestore.collection('socialImports')
      .where('connectionId', '==', connectionId)
      .limit(MAX_IMPORTS_PER_CONNECTION + 1)
      .get()
    if (snapshot.size > MAX_IMPORTS_PER_CONNECTION) throw new Error('Instagram import safety limit reached')
    return snapshot.docs.map((document) => document.data() as SocialImport)
  }

  async getImport(connectionId: string, providerId: string): Promise<SocialImport | null> {
    const snapshot = await this.firestore.collection('socialImports').doc(importDocumentId(connectionId, providerId)).get()
    return snapshot.exists ? snapshot.data() as SocialImport : null
  }

  async saveImport(item: SocialImport): Promise<void> {
    await this.firestore.collection('socialImports')
      .doc(importDocumentId(item.connectionId, item.providerId))
      .set(importWrite(item), { merge: true })
  }

  async reviewImport(
    connectionId: string,
    providerId: string,
    input: { decision: 'approve' | 'reject' | 'reset'; reviewerUid: string; nowMs: number },
  ): Promise<SocialImport | null> {
    const reference = this.firestore.collection('socialImports').doc(importDocumentId(connectionId, providerId))
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) return null
      const reviewed = reviewSocialImport(snapshot.data() as SocialImport, input)
      transaction.set(reference, importWrite(reviewed), { merge: true })
      return reviewed
    })
  }

  async acquireSyncLease(connectionId: string, nowMs: number, leaseMs: number): Promise<boolean> {
    const reference = this.firestore.collection('socialConnections').doc(connectionId)
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) return false
      const leaseExpiresAtMs = Number(snapshot.get('syncLeaseExpiresAtMs') ?? 0)
      if (leaseExpiresAtMs > nowMs) return false
      transaction.update(reference, { syncLeaseExpiresAtMs: nowMs + leaseMs })
      return true
    })
  }

  async releaseSyncLease(connectionId: string): Promise<void> {
    await this.firestore.collection('socialConnections').doc(connectionId).update({ syncLeaseExpiresAtMs: FieldValue.delete() })
  }

  async saveImports(connectionId: string, imports: SocialImport[]): Promise<void> {
    for (let start = 0; start < imports.length; start += 400) {
      const batch = this.firestore.batch()
      for (const item of imports.slice(start, start + 400)) {
        if (item.connectionId !== connectionId) throw new Error('Instagram import connection mismatch')
        const reference = this.firestore.collection('socialImports').doc(importDocumentId(connectionId, item.providerId))
        batch.set(reference, importWrite(item), { merge: true })
      }
      await batch.commit()
    }
  }

  async audit(type: string, actorUid: string, details: Record<string, unknown> = {}): Promise<void> {
    await this.firestore.collection('auditEvents').add({
      type,
      actorUid,
      ...withoutUndefined(details),
      at: FieldValue.serverTimestamp(),
    })
  }
}
