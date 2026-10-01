import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { collectScannerChild, maxScanBytes, scannerExitVerdict, scannerTokenMatches } from './contracts.js'

const execFileAsync = promisify(execFile)
const port = Number(process.env.PORT ?? 8080)
const bearerToken = process.env.SCANNER_BEARER_TOKEN ?? ''
const scanTimeoutMs = 60_000

async function clamVersion() {
  const { stdout } = await execFileAsync('clamscan', ['--version'], { timeout: 10_000 })
  const version = stdout.trim()
  if (!version) throw new Error('scanner_version_missing')
  return version.slice(0, 160)
}

async function requestBytes(request) {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (declaredLength > maxScanBytes) throw new Error('file_too_large')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxScanBytes) throw new Error('file_too_large')
    chunks.push(chunk)
  }
  if (!size) throw new Error('empty_file')
  return Buffer.concat(chunks)
}

function runClamScan(path) {
  const child = spawn('clamscan', ['--no-summary', '--stdout', path], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return collectScannerChild(child, scanTimeoutMs)
}

export async function scanRequest(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405).end()
    return
  }
  if (!scannerTokenMatches(request.headers['x-weave-scanner-token'], bearerToken)) {
    response.writeHead(401).end()
    return
  }

  const temporaryPath = `/tmp/weave-scan-${randomUUID()}`
  try {
    const [bytes, engineVersion] = await Promise.all([requestBytes(request), clamVersion()])
    await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 })
    const result = await runClamScan(temporaryPath)
    const verdict = scannerExitVerdict(result.code, result.output, engineVersion)
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(verdict))
  } catch (error) {
    const code = error instanceof Error ? error.message : 'scanner_failed'
    const status = code === 'file_too_large' ? 413 : code === 'empty_file' ? 400 : 503
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ error: code }))
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}

if (!bearerToken) {
  throw new Error('SCANNER_BEARER_TOKEN is required')
}

createServer((request, response) => {
  void scanRequest(request, response)
}).listen(port)
