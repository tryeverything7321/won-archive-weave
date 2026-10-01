import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SCANNER_ENDPOINT, resolveScannerEndpoint } from './scanner-endpoint.js'

test('blank scanner configuration resolves to the same HTTPS endpoint used by scanning and publication', () => {
  assert.equal(resolveScannerEndpoint('').toString(), DEFAULT_SCANNER_ENDPOINT + '/')
  assert.equal(resolveScannerEndpoint('  ').toString(), DEFAULT_SCANNER_ENDPOINT + '/')
  assert.equal(resolveScannerEndpoint(' https://scanner.internal.example/scan ').toString(), 'https://scanner.internal.example/scan')
})

test('explicit invalid scanner URLs fail closed rather than falling back', () => {
  for (const value of ['http://scanner.internal.example', 'https://', 'not-a-url',
    'https://user:pass@scanner.internal.example', 'https://scanner.internal.example/#fragment']) {
    assert.throws(() => resolveScannerEndpoint(value), /file_scanner_endpoint_must_use_https/)
  }
})
