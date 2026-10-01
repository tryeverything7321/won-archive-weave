import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PreviewError, conversionTimeoutMs, maxOutputBytes } from './contracts.js'

const macroSecurityProfile = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
</oor:items>
`

function collectChild(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-16_384)
    }
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.off('data', append)
      child.stderr.off('data', append)
      child.off('error', onError)
      child.off('close', onClose)
      callback()
    }
    const onError = (error) => finish(() => reject(error))
    const onClose = (code) => finish(() => resolve({ code: code ?? 126, output }))
    const timer = setTimeout(() => {
      if (settled) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
      finish(() => reject(new PreviewError('conversion_timeout', 504)))
    }, timeoutMs)
    timer.unref()
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', onError)
    child.on('close', onClose)
  })
}

function spawnChecked(command, args, options, timeoutMs) {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return collectChild(child, timeoutMs)
}

function sandboxEnvironment(workspace) {
  return {
    HOME: workspace,
    LANG: 'C.UTF-8',
    PATH: '/usr/bin:/bin',
    SAL_USE_VCLPLUGIN: 'svp',
    TMPDIR: workspace,
    XDG_CACHE_HOME: join(workspace, 'cache'),
    XDG_CONFIG_HOME: join(workspace, 'config'),
    XDG_DATA_HOME: join(workspace, 'data'),
  }
}

function parseEngineJson(output) {
  try {
    return JSON.parse(output.trim())
  } catch {
    throw new PreviewError('engine_response_invalid', 503)
  }
}

function remainingMs(deadline) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new PreviewError('conversion_timeout', 504)
  return remaining
}

async function runRhwpInspection(inputPath, format, workspace, pythonBinary, rhwpBinary, deadline) {
  const sandbox = join(import.meta.dirname, 'sandbox_exec.py')
  const options = { cwd: workspace, env: sandboxEnvironment(workspace) }
  const scan = await spawnChecked(
    pythonBinary,
    [sandbox, rhwpBinary, 'scan', inputPath, '--probe', '--limit', '1', '--json'],
    options,
    Math.min(10_000, remainingMs(deadline)),
  )
  if (scan.code !== 0) throw new PreviewError('unsafe_document', 422)
  const scanResult = parseEngineJson(scan.output)
  const entry = scanResult.files?.[0]
  const expectedMagic = format === 'hwp' ? 'hwp5' : 'hwpx'
  if (
    scanResult.summary?.total !== 1
    || scanResult.summary?.needsPassword !== 0
    || scanResult.summary?.probeFailed !== 0
    || entry?.magicFormat !== expectedMagic
    || entry?.extMismatch !== false
    || entry?.probe?.parseOk !== true
    || entry?.probe?.needsPassword !== false
  ) {
    throw new PreviewError('unsafe_document', 422)
  }

  const threat = await spawnChecked(
    pythonBinary,
    [sandbox, rhwpBinary, 'threat-scan', inputPath, '--json'],
    options,
    Math.min(10_000, remainingMs(deadline)),
  )
  if (threat.code !== 0 || parseEngineJson(threat.output).clean !== true) {
    throw new PreviewError('unsafe_document', 422)
  }
}

async function defaultPreflight(inputPath, format, workspace, pythonBinary, rhwpBinary, deadline) {
  const result = await spawnChecked(
    pythonBinary,
    [join(import.meta.dirname, 'preflight_ooxml.py'), inputPath, format],
    { cwd: import.meta.dirname },
    Math.min(10_000, remainingMs(deadline)),
  )
  if (result.code !== 0) throw new PreviewError('unsafe_document', 422)
  if (format === 'hwp' || format === 'hwpx') {
    await runRhwpInspection(inputPath, format, workspace, pythonBinary, rhwpBinary, deadline)
  }
}

async function defaultRunner({ format, workspace, inputPath, outputDirectory, outputPath, profileDirectory, pythonBinary, libreOfficeBinary, rhwpBinary, timeoutMs }) {
  const environment = sandboxEnvironment(workspace)
  if (format === 'hwp' || format === 'hwpx') {
    return spawnChecked(
      pythonBinary,
      [
        join(import.meta.dirname, 'sandbox_exec.py'),
        rhwpBinary,
        'export-pdf',
        inputPath,
        '-o',
        outputPath,
        '--profile',
        'fast-preview',
        '--fallback-sans',
        'Noto Sans CJK KR',
        '--fallback-serif',
        'Noto Serif CJK KR',
        '--fallback-mono',
        'Noto Sans Mono CJK KR',
        '--json',
      ],
      { cwd: workspace, env: environment },
      timeoutMs,
    )
  }
  return spawnChecked(
    pythonBinary,
    [
      join(import.meta.dirname, 'sandbox_exec.py'),
      libreOfficeBinary,
      '--headless',
      '--invisible',
      '--nologo',
      '--nodefault',
      '--nolockcheck',
      '--norestore',
      '--nofirststartwizard',
      `-env:UserInstallation=file://${profileDirectory}`,
      '--convert-to',
      'pdf',
      '--outdir',
      outputDirectory,
      inputPath,
    ],
    { cwd: workspace, env: environment },
    timeoutMs,
  )
}

export function createDocumentConverter(options = {}) {
  const root = options.tmpRoot ?? process.env.DOCUMENT_PREVIEW_TMP ?? tmpdir()
  const pythonBinary = options.pythonBinary ?? process.env.DOCUMENT_PREVIEW_PYTHON ?? '/usr/bin/python3'
  const libreOfficeBinary = options.libreOfficeBinary ?? process.env.DOCUMENT_PREVIEW_LIBREOFFICE ?? '/usr/bin/libreoffice'
  const rhwpBinary = options.rhwpBinary ?? process.env.DOCUMENT_PREVIEW_RHWP ?? '/usr/local/bin/rhwp'
  const preflight = options.preflight ?? ((path, format, workspace, deadline) => defaultPreflight(path, format, workspace, pythonBinary, rhwpBinary, deadline))
  const runner = options.runner ?? defaultRunner

  return async function convert(bytes, format) {
    const deadline = Date.now() + conversionTimeoutMs
    const workspace = await mkdtemp(join(root, 'weave-preview-'))
    const inputPath = join(workspace, `input.${format}`)
    const outputDirectory = join(workspace, 'output')
    const profileDirectory = join(workspace, 'profile')
    const outputPath = join(outputDirectory, 'input.pdf')
    try {
      await Promise.all([
        mkdir(outputDirectory, { mode: 0o700 }),
        mkdir(profileDirectory, { mode: 0o700 }),
      ])
      await writeFile(join(profileDirectory, 'registrymodifications.xcu'), macroSecurityProfile, { mode: 0o600 })
      await writeFile(inputPath, bytes, { flag: 'wx', mode: 0o600 })
      await preflight(inputPath, format, workspace, deadline)
      const result = await runner({
        format,
        workspace,
        inputPath,
        outputDirectory,
        outputPath,
        profileDirectory,
        pythonBinary,
        libreOfficeBinary,
        rhwpBinary,
        timeoutMs: remainingMs(deadline),
      })
      if (!result || result.code !== 0) {
        const code = result?.code === 125 ? 'sandbox_unavailable' : 'conversion_failed'
        throw new PreviewError(code, code === 'sandbox_unavailable' ? 503 : 422)
      }
      const metadata = await stat(outputPath).catch(() => null)
      if (!metadata?.isFile() || metadata.size < 5) throw new PreviewError('conversion_failed', 422)
      if (metadata.size > maxOutputBytes) throw new PreviewError('output_too_large', 413)
      const pdf = await readFile(outputPath)
      if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new PreviewError('invalid_pdf_output', 422)
      }
      return pdf
    } finally {
      await rm(workspace, { force: true, recursive: true }).catch(() => undefined)
    }
  }
}
