// New lifecycle states must fail closed; legacy projections retain their existing path/status gates.
export function attachmentAllowsRead(status: unknown): boolean {
  return status === undefined || status === 'clean'
}

type ApprovedStorageObject = { path?: unknown; generation?: unknown }

// New attachment records are published from an exact scanned generation. Never
// fall back to the latest object at the same path, because that could be a later,
// unscanned replacement. Legacy projections have no attachmentStatus and retain
// their existing path-level compatibility behavior.
export function approvedAttachmentGeneration(
  status: unknown,
  path: string,
  objects: unknown,
): string | undefined | null {
  if (status === undefined) return undefined
  if (status !== 'clean' || !Array.isArray(objects)) return null
  const matches = objects.filter((item): item is ApprovedStorageObject => (
    Boolean(item) && typeof item === 'object' && item.path === path
  ))
  if (matches.length !== 1) return null
  const generation = matches[0]?.generation
  return typeof generation === 'string' && /^\d+$/.test(generation) ? generation : null
}

export function ownerPrivateAttachmentAllowsRead(input: {
  actorUid: string
  ownerUid: unknown
  status: unknown
  visibility: unknown
  sourceMode: unknown
  scanStatus: unknown
  verdict: unknown
  scanRecordedBy: unknown
  moderated: boolean
}): boolean {
  return input.ownerUid === input.actorUid
    && input.status === 'review_queued'
    && input.visibility === '보류'
    && input.sourceMode === 'upload'
    && input.scanStatus === 'clean'
    && input.verdict === 'clean'
    && (input.scanRecordedBy === 'event-driven-file-scanner' || input.scanRecordedBy === 'manual-scan-attestor')
    && !input.moderated
}

export function ownerAttachmentPathsMatch(prefix: string, selectedNames: string[], attestedPaths: string[]): boolean {
  const expected = selectedNames.map((name) => `${prefix}${name}`).sort()
  const actual = [...attestedPaths].sort()
  return expected.length === actual.length && expected.every((path, index) => path === actual[index])
}
