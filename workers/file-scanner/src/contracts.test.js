import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { collectScannerChild, scannerExitVerdict, scannerTokenMatches } from './contracts.js'

test('ClamAV exit zero alone produces clean', () => {
  assert.deepEqual(scannerExitVerdict(0, 'file: OK', 'ClamAV 1.4.3'), {
    verdict: 'clean',
    provider: 'weave-clamav',
    engineVersion: 'ClamAV 1.4.3',
  })
})

test('ClamAV detection is blocked and engine errors never become clean', () => {
  assert.deepEqual(scannerExitVerdict(1, '/tmp/file: Eicar-Signature FOUND\n', 'ClamAV 1.4.3'), {
    verdict: 'blocked',
    provider: 'weave-clamav',
    engineVersion: 'ClamAV 1.4.3',
    signature: 'Eicar-Signature',
  })
  assert.throws(() => scannerExitVerdict(2, 'database error', 'ClamAV 1.4.3'), /scanner_engine_failed/)
})

test('scanner defense-in-depth token check fails closed for missing and mismatched values', () => {
  assert.equal(scannerTokenMatches('scanner-token', 'scanner-token'), true)
  assert.equal(scannerTokenMatches('wrong', 'scanner-token'), false)
  assert.equal(scannerTokenMatches('', 'scanner-token'), false)
  assert.equal(scannerTokenMatches('scanner-token', ''), false)
})

test('scanner child is killed when the engine timeout expires', async () => {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  let signal = ''
  child.kill = (value) => {
    signal = value
    return true
  }

  await assert.rejects(collectScannerChild(child, 5), /scanner_engine_timeout/)
  assert.equal(signal, 'SIGKILL')
})
