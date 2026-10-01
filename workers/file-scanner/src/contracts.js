import { timingSafeEqual } from 'node:crypto'

export const maxScanBytes = 20 * 1024 * 1024

export function scannerExitVerdict(exitCode, output, engineVersion) {
  if (exitCode === 0) {
    return {
      verdict: 'clean',
      provider: 'weave-clamav',
      engineVersion,
    }
  }
  if (exitCode === 1) {
    const match = output.match(/:\s*(.+)\s+FOUND\s*$/m)
    return {
      verdict: 'blocked',
      provider: 'weave-clamav',
      engineVersion,
      signature: (match?.[1] ?? 'malware_detected').slice(0, 160),
    }
  }
  throw new Error('scanner_engine_failed')
}

export function scannerTokenMatches(actual, expected) {
  if (!actual || !expected) return false
  const supplied = Buffer.from(actual)
  const configured = Buffer.from(expected)
  if (supplied.length !== configured.length) return false
  return timingSafeEqual(supplied, configured)
}

export function collectScannerChild(child, timeoutMs) {
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
    const onClose = (code) => finish(() => resolve({ code: code ?? 2, output }))
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGKILL')
      finish(() => reject(new Error('scanner_engine_timeout')))
    }, timeoutMs)
    timer.unref()
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', onError)
    child.on('close', onClose)
  })
}
