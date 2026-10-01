import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request } from 'node:http'
import test from 'node:test'
import { maxInputBytes, PreviewError } from './contracts.js'
import { startServer } from './server.js'

async function withServer(convert, callback) {
  const server = startServer({ port: 0, convert })
  await once(server, 'listening')
  try {
    await callback(server.address().port)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

function call(port, { method = 'POST', path = '/convert?format=docx', body, headers = {} } = {}) {
  const requestBody = body ?? (method === 'POST' ? Buffer.from('document') : Buffer.alloc(0))
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end(requestBody)
  })
}

test('only POST and the exact document allowlist are accepted', async () => {
  await withServer(async () => Buffer.from('%PDF-test'), async (port) => {
    assert.equal((await call(port, { method: 'GET' })).status, 405)
    assert.equal((await call(port, { path: '/convert?format=hwpx' })).status, 200)
    assert.equal((await call(port, { path: '/convert?format=docm' })).status, 415)
    assert.equal((await call(port, { path: '/other?format=docx' })).status, 415)
  })
})

test('oversized declared input is rejected before conversion', async () => {
  let calls = 0
  await withServer(async () => {
    calls += 1
    return Buffer.from('%PDF-test')
  }, async (port) => {
    const result = await call(port, { body: Buffer.alloc(maxInputBytes + 1) })
    assert.equal(result.status, 413)
    assert.deepEqual(JSON.parse(result.body), { error: 'input_too_large' })
    assert.equal(calls, 0)
  })
})

test('conversion errors remain bounded JSON responses', async () => {
  await withServer(async () => {
    throw new PreviewError('unsafe_document', 422)
  }, async (port) => {
    const result = await call(port)
    assert.equal(result.status, 422)
    assert.deepEqual(JSON.parse(result.body), { error: 'unsafe_document' })
    assert.equal(result.headers['cache-control'], 'no-store')
  })
})

test('a second request is rejected while one conversion is active', async () => {
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  await withServer(async () => {
    await blocked
    return Buffer.from('%PDF-test')
  }, async (port) => {
    const first = call(port)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = await call(port, { path: '/convert?format=xlsx' })
    assert.equal(second.status, 429)
    release()
    assert.equal((await first).status, 200)
  })
})
