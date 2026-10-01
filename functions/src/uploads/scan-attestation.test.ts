import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'
import {
  assertAttestationMatchesObjects,
  parseScanAttestation,
  requireScanAttestor,
  type QuarantinedObjectFingerprint,
} from './scan-attestation.js'

const objects: QuarantinedObjectFingerprint[] = [{
  path: 'quarantined/member/submission/guide.pdf',
  generation: '1720000000000000',
  size: 2048,
  contentHash: 'md5:YWJjZA==',
}]

const attestation = {
  schemaVersion: 1,
  verdict: 'clean',
  provider: 'trusted-scanner',
  scanId: 'scan-20260722-001',
  engineVersion: 'definitions-2026-07-22',
  scannedAtMs: 10_000,
  objects,
}

test('only a dedicated administrator scan attestor may record results', () => {
  assert.doesNotThrow(() => requireScanAttestor({ role: 'administrator', scanAttestor: true }))
  assert.throws(() => requireScanAttestor({ role: 'administrator' }), (error: HttpsError) => error.code === 'permission-denied')
  assert.throws(() => requireScanAttestor({ role: 'moderator', scanAttestor: true }), (error: HttpsError) => error.code === 'permission-denied')
})

test('a scan attestation requires provider evidence and an exact object manifest', () => {
  const parsed = parseScanAttestation(attestation, 10_000)
  assert.equal(parsed.verdict, 'clean')
  assert.doesNotThrow(() => assertAttestationMatchesObjects(parsed, objects))
  assert.throws(
    () => assertAttestationMatchesObjects(parsed, [{ ...objects[0], generation: '1720000000000001' }]),
    (error: HttpsError) => error.code === 'failed-precondition',
  )
  assert.throws(
    () => parseScanAttestation({ ...attestation, provider: '' }, 10_000),
    (error: HttpsError) => error.code === 'invalid-argument',
  )
})

test('a clean status without trusted attestation evidence is rejected', () => {
  assert.throws(
    () => parseScanAttestation(undefined, 10_000),
    (error: HttpsError) => error.code === 'invalid-argument',
  )
})

test('a future-dated or duplicate-path attestation is rejected', () => {
  assert.throws(
    () => parseScanAttestation({ ...attestation, scannedAtMs: 500_001 }, 10_000),
    (error: HttpsError) => error.code === 'invalid-argument',
  )
  assert.throws(
    () => parseScanAttestation({ ...attestation, objects: [objects[0], { ...objects[0], generation: '2' }] }, 10_000),
    (error: HttpsError) => error.code === 'invalid-argument',
  )
})
