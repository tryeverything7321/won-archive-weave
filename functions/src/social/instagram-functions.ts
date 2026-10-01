import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'
import { FirestoreInstagramRepository } from './instagram-firestore-repository.js'
import { MetaInstagramGraphApi, MetaInstagramTransportError, type MetaInstagramSettings } from './instagram-meta-api.js'
import {
  InstagramPolicyError,
  connectOfficialInstagram,
  disconnectOfficialInstagram,
  syncOfficialInstagram,
  type InstagramConnection,
} from './instagram-service.js'

if (!getApps().length) initializeApp()

const META_INSTAGRAM_APP_ID = defineString('META_INSTAGRAM_APP_ID')
const META_INSTAGRAM_ACCOUNT_ID = defineString('META_INSTAGRAM_ACCOUNT_ID')
const META_INSTAGRAM_API_VERSION = defineString('META_INSTAGRAM_API_VERSION')
const META_INSTAGRAM_APP_SECRET = defineSecret('META_INSTAGRAM_APP_SECRET')
const META_INSTAGRAM_ACCESS_TOKEN = defineSecret('META_INSTAGRAM_ACCESS_TOKEN')
const INSTAGRAM_SECRETS = [META_INSTAGRAM_APP_SECRET, META_INSTAGRAM_ACCESS_TOKEN]
const CONNECTION_ID = 'official-instagram'
const TOKEN_REFERENCE = 'secret://META_INSTAGRAM_ACCESS_TOKEN'
const CONSENT_VERSION = '2026-07-22'

type CallableAuth = { uid: string; token: Record<string, unknown> }

function requireAdministrator(auth: CallableAuth | undefined): CallableAuth {
  if (!auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다')
  if (auth.token.role !== 'administrator') throw new HttpsError('permission-denied', 'Instagram 연결 관리 권한이 필요합니다')
  return auth
}

export function instagramConfigured(input: Partial<MetaInstagramSettings>): boolean {
  return Boolean(
    input.appId?.trim()
    && input.appSecret?.trim()
    && input.accessToken?.trim()
    && input.accountId?.trim()
    && input.apiVersion?.trim(),
  )
}

function runtimeSettings(): MetaInstagramSettings | null {
  try {
    const settings = {
      appId: META_INSTAGRAM_APP_ID.value(),
      appSecret: META_INSTAGRAM_APP_SECRET.value(),
      accessToken: META_INSTAGRAM_ACCESS_TOKEN.value(),
      accountId: META_INSTAGRAM_ACCOUNT_ID.value(),
      apiVersion: META_INSTAGRAM_API_VERSION.value(),
    }
    return instagramConfigured(settings) ? settings : null
  } catch {
    return null
  }
}

function configuredApi(): MetaInstagramGraphApi {
  const settings = runtimeSettings()
  if (!settings) throw new HttpsError('failed-precondition', 'Meta Instagram 연결 설정이 아직 준비되지 않았습니다')
  return new MetaInstagramGraphApi(settings)
}

function publicConnection(connection: InstagramConnection | null) {
  if (!connection) return null
  return {
    accountName: connection.accountName,
    status: connection.status,
    consentVersion: connection.consentVersion,
    consentedAtMs: connection.consentedAtMs,
    ...(connection.lastSyncAttemptAtMs ? { lastSyncAttemptAtMs: connection.lastSyncAttemptAtMs } : {}),
    ...(connection.lastSuccessfulSyncAtMs ? { lastSuccessfulSyncAtMs: connection.lastSuccessfulSyncAtMs } : {}),
    ...(connection.nextSyncAtMs ? { nextSyncAtMs: connection.nextSyncAtMs } : {}),
  }
}

function repository() {
  return new FirestoreInstagramRepository(getFirestore())
}

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error
  if (error instanceof InstagramPolicyError) {
    if (error.code === 'not_owner') throw new HttpsError('permission-denied', '이 연결을 해제할 권한이 없습니다')
    if (error.code === 'inactive_connection' || error.code === 'inactive_source') throw new HttpsError('failed-precondition', '현재 상태에서는 요청을 처리할 수 없습니다')
    throw new HttpsError('invalid-argument', 'Instagram 연결 정보를 확인해 주세요')
  }
  if (error instanceof MetaInstagramTransportError) {
    if (error.code === 'not_configured' || error.code === 'invalid_configuration') {
      throw new HttpsError('failed-precondition', 'Meta Instagram 연결 설정이 아직 준비되지 않았습니다')
    }
    throw new HttpsError('unavailable', 'Instagram과 통신하지 못했습니다. 잠시 뒤 다시 시도해 주세요')
  }
  throw new HttpsError('internal', 'Instagram 요청을 처리하지 못했습니다')
}

const callableOptions = { region: 'asia-northeast3', secrets: INSTAGRAM_SECRETS }

export const getOfficialInstagramStatus = onCall(callableOptions, async (request) => {
  requireAdministrator(request.auth as CallableAuth | undefined)
  const settings = runtimeSettings()
  const connection = await repository().getConnection(CONNECTION_ID)
  return { configured: Boolean(settings), connection: publicConnection(connection) }
})

export const connectOfficialInstagramAccount = onCall(callableOptions, async (request) => {
  const auth = requireAdministrator(request.auth as CallableAuth | undefined)
  if (request.data?.consentAccepted !== true || request.data?.consentVersion !== CONSENT_VERSION) {
    throw new HttpsError('failed-precondition', '현재 Instagram 연결 동의 내용을 확인해 주세요')
  }
  try {
    const api = configuredApi()
    const identity = await api.identify()
    const connection = connectOfficialInstagram({
      id: CONNECTION_ID,
      ownerUid: auth.uid,
      accountId: identity.accountId,
      accountName: identity.accountName,
      tokenReference: TOKEN_REFERENCE,
      consentVersion: CONSENT_VERSION,
      consentedAtMs: Date.now(),
    })
    const store = repository()
    await store.saveConnection(connection)
    await store.audit('instagram.connected', auth.uid, { connectionId: CONNECTION_ID })
    return { configured: true, connection: publicConnection(connection) }
  } catch (error) {
    return mapError(error)
  }
})

export const syncOfficialInstagramAccount = onCall({ ...callableOptions, timeoutSeconds: 120 }, async (request) => {
  const auth = requireAdministrator(request.auth as CallableAuth | undefined)
  const store = repository()
  const connection = await store.getConnection(CONNECTION_ID)
  if (!connection) throw new HttpsError('failed-precondition', '먼저 공식 Instagram 계정을 연결해 주세요')
  const leaseAcquired = await store.acquireSyncLease(CONNECTION_ID, Date.now(), 2 * 60 * 1_000)
  if (!leaseAcquired) throw new HttpsError('failed-precondition', '다른 Instagram 동기화가 진행 중입니다')
  try {
    const result = await syncOfficialInstagram(connection, { api: configuredApi(), repository: store, now: Date.now })
    await store.audit('instagram.synced', auth.uid, { connectionId: CONNECTION_ID, imported: result.imported, updated: result.updated, hidden: result.hidden })
    return { connection: publicConnection(result.connection), imported: result.imported, updated: result.updated, hidden: result.hidden }
  } catch (error) {
    return mapError(error)
  } finally {
    await store.releaseSyncLease(CONNECTION_ID).catch(() => undefined)
  }
})

export const reviewOfficialInstagramImport = onCall(callableOptions, async (request) => {
  const auth = requireAdministrator(request.auth as CallableAuth | undefined)
  const providerId = typeof request.data?.providerId === 'string' ? request.data.providerId.trim() : ''
  const decision = request.data?.decision
  if (!/^\d{5,60}$/.test(providerId) || (decision !== 'approve' && decision !== 'reject' && decision !== 'reset')) {
    throw new HttpsError('invalid-argument', '검토할 게시물과 결정을 확인해 주세요')
  }
  try {
    const store = repository()
    const reviewed = await store.reviewImport(CONNECTION_ID, providerId, { decision, reviewerUid: auth.uid, nowMs: Date.now() })
    if (!reviewed) throw new HttpsError('not-found', '검토할 Instagram 게시물을 찾지 못했습니다')
    await store.audit('instagram.import_reviewed', auth.uid, { connectionId: CONNECTION_ID, providerId, decision })
    return { providerId, reviewStatus: reviewed.reviewStatus, sourceStatus: reviewed.sourceStatus, visible: reviewed.visible }
  } catch (error) {
    return mapError(error)
  }
})

export const disconnectOfficialInstagramAccount = onCall(callableOptions, async (request) => {
  const auth = requireAdministrator(request.auth as CallableAuth | undefined)
  try {
    const store = repository()
    const connection = await store.getConnection(CONNECTION_ID)
    if (!connection) throw new HttpsError('not-found', '연결된 공식 Instagram 계정이 없습니다')
    const disconnected = await disconnectOfficialInstagram(connection, auth.uid, { api: configuredApi(), repository: store, now: Date.now })
    await store.audit('instagram.disconnected', auth.uid, { connectionId: CONNECTION_ID })
    return { connection: publicConnection(disconnected) }
  } catch (error) {
    return mapError(error)
  }
})
