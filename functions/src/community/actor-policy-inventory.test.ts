import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

type CallableClass = 'member-write' | 'mixed-write' | 'role-write' | 'member-read' | 'public-read' | 'role-read'

const inventory: Record<string, Record<string, CallableClass>> = {
  'uploads/upload-selection.ts': {
    prepareSubmissionUploads: 'member-write',
    reconcileSubmissionUpload: 'member-read',
  },
  'uploads/material-links.ts': {
    setActivityMaterialLinks: 'mixed-write',
    getActivityMaterialLinks: 'member-read',
    getMaterialLinkImpact: 'member-read',
  },
  'uploads/submissions.ts': {
    createSubmission: 'member-write',
    listMySubmissions: 'member-read',
    getMySubmissionManagement: 'member-read',
    listSubmissionOperatorExceptions: 'role-read',
    migrateSubmissionSortCreatedAt: 'role-write',
    getMySubmissionDraft: 'member-read',
    updateSubmissionDraft: 'member-write',
    submitSubmission: 'member-write',
    withdrawSubmission: 'member-write',
    requestSubmissionChange: 'member-write',
    resolveSubmissionOperatorException: 'role-write',
    moderateSubmissionContent: 'role-write',
    reviewSubmission: 'role-write',
    verifySubmissionSourceLink: 'role-write',
    recordSubmissionScanResult: 'role-write',
    approveSubmission: 'mixed-write',
  },
  'uploads/downloads.ts': {
    createApprovedDownload: 'public-read',
    createApprovedPreview: 'public-read',
    createOwnerSubmissionAttachmentAccess: 'member-read',
  },
  'calendar/external-calendar-functions.ts': {
    submitCalendarSource: 'member-write',
    submitSelectedGoogleCalendarEvents: 'member-write',
    reviewCalendarSource: 'role-write',
    syncCalendarSourcePreview: 'role-write',
    syncGooglePublicCalendarSource: 'role-write',
    reviewCalendarImportCandidate: 'role-write',
    getCalendarImportChange: 'role-read',
    applyCalendarImportChange: 'role-write',
    disconnectCalendarSource: 'mixed-write',
  },
  'calendar/event-management.ts': {
    createManualEvent: 'member-write',
    updateManualEvent: 'member-write',
    cancelOwnedEvent: 'member-write',
    unpublishOwnedEvent: 'member-write',
    restoreOwnedEvent: 'member-write',
    listOwnedEvents: 'member-read',
    setEventOrganizerTrust: 'role-write',
    recordEventMediaScanResult: 'role-write',
    reviewManualEvent: 'role-write',
    moderateManualEventContent: 'role-write',
  },
  'community/posts.ts': {
    createCommunityPost: 'member-write',
    createCommunityComment: 'member-write',
    blockCommunityAuthor: 'member-write',
    unblockCommunityAuthor: 'member-write',
    reportCommunityContent: 'member-write',
    getCommunityOwnership: 'member-read',
    listMyCommunityCases: 'member-read',
    listCommunityPostsForAdmin: 'role-read',
    resolveCommunityCase: 'role-write',
    moderateCommunityPost: 'role-write',
    editCommunityPost: 'mixed-write',
    deleteCommunityPost: 'mixed-write',
    moderateCommunityContent: 'role-write',
    appealCommunityModeration: 'member-write',
    editCommunityComment: 'mixed-write',
    deleteCommunityComment: 'mixed-write',
    moderateCommunityComment: 'role-write',
  },
  'social/instagram-functions.ts': {
    getOfficialInstagramStatus: 'role-read',
    connectOfficialInstagramAccount: 'role-write',
    syncOfficialInstagramAccount: 'role-write',
    reviewOfficialInstagramImport: 'role-write',
    disconnectOfficialInstagramAccount: 'role-write',
  },
}

function callableBodies(source: string) {
  const matches = [...source.matchAll(/export const (\w+) = onCall/g)]
  return new Map(matches.map((match, index) => {
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? source.length
    return [match[1], source.slice(start, end)]
  }))
}

test('every callable in actor-policy owned domains has an explicit classification', async () => {
  for (const [relativePath, expected] of Object.entries(inventory)) {
    const source = await readFile(resolve(process.cwd(), 'src', relativePath), 'utf8')
    const actual = [...callableBodies(source).keys()].sort()
    assert.deepEqual(actual, Object.keys(expected).sort(), `${relativePath} inventory drifted`)
  }
})

test('every normal or mixed user write calls the common actor policy', async () => {
  for (const [relativePath, expected] of Object.entries(inventory)) {
    const source = await readFile(resolve(process.cwd(), 'src', relativePath), 'utf8')
    const bodies = callableBodies(source)
    for (const [name, classification] of Object.entries(expected)) {
      if (classification !== 'member-write' && classification !== 'mixed-write') continue
      assert.match(bodies.get(name) ?? '', /requireActorPolicy\s*\(/, `${relativePath}:${name} has no actor policy`)
    }
  }
})

test('owner attachment access authorizes the member before reading a submission', async () => {
  const source = await readFile(resolve(process.cwd(), 'src/uploads/downloads.ts'), 'utf8')
  const body = callableBodies(source).get('createOwnerSubmissionAttachmentAccess') ?? ''
  const actorPolicyIndex = body.indexOf('requireActorPolicy(request.auth)')
  const submissionReadIndex = body.indexOf("collection('submissions')")
  assert.ok(actorPolicyIndex >= 0, 'owner attachment access has no actor policy')
  assert.ok(submissionReadIndex >= 0, 'owner attachment access has no submission read')
  assert.ok(actorPolicyIndex < submissionReadIndex, 'owner attachment access reads before authorization')
})

test('all classified non-social callables remain exported from the runtime index', async () => {
  const runtimeIndex = await readFile(resolve(process.cwd(), 'src/index.ts'), 'utf8')
  for (const [relativePath, expected] of Object.entries(inventory)) {
    if (relativePath.startsWith('social/')) continue
    for (const name of Object.keys(expected)) {
      assert.match(runtimeIndex, new RegExp(`\\b${name}\\b`), `${name} is not exported from index.ts`)
    }
  }
})
