import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

async function source(path: string) {
  return readFile(resolve(process.cwd(), '..', path), 'utf8')
}

test('Firestore member and owner reads require the active-member helper', async () => {
  const rules = await source('firestore.rules')
  assert.match(rules, /function isActiveMember\(\)/)
  assert.match(rules, /get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)/)
  assert.match(rules, /resource\.data\.visibility == 'member_only'[\s\S]*isActiveMember\(\)/)
  assert.match(rules, /match \/communityPosts\/\{postId\}[\s\S]*allow read: if isActiveMember\(\)/)
  assert.match(rules, /match \/submissions\/\{submissionId\}[\s\S]*allow read: if \(isActiveMember\(\)/)
})

test('Storage member reads and owner writes require the active-member helper', async () => {
  const rules = await source('storage.rules')
  assert.match(rules, /function isActiveMember\(\)/)
  assert.match(rules, /firestore\.get\(\/databases\/\(default\)\/documents\/users\/\$\(request\.auth\.uid\)\)/)
  assert.match(rules, /match \/quarantined\/\{uid\}[\s\S]*allow create: if isActiveMember\(\)/)
  assert.match(rules, /match \/profile-photos\/\{uid\}[\s\S]*allow create, update: if isActiveMember\(\)/)
  assert.match(rules, /match \/approved\/members\/\{category\}\/\{allPaths=\*\*\}[\s\S]*allow read: if category != 'calendar-events' && isActiveMember\(\)/)
  assert.match(rules, /match \/approved\/members\/calendar-events\/\{eventId\}\/\{fileName\}[\s\S]*allow get: if isActiveMember\(\) && readableEventMedia\(eventId, 'member_only'\)/)
})

test('member-only signed URLs require the callable actor policy', async () => {
  const downloads = await source('functions/src/uploads/downloads.ts')
  assert.match(downloads, /requireActorPolicy\(request\.auth\)/)
  assert.match(downloads, /visibility === 'member_only'/)
})

test('Rules consent versions stay aligned with the Functions policy', async () => {
  const [terms, firestoreRules, storageRules] = await Promise.all([
    source('functions/src/auth/terms.ts'),
    source('firestore.rules'),
    source('storage.rules'),
  ])
  const termsVersion = terms.match(/currentTermsVersion = '([^']+)'/)?.[1]
  const communityVersion = terms.match(/currentCommunityRulesVersion = '([^']+)'/)?.[1]
  assert.ok(termsVersion)
  assert.ok(communityVersion)
  for (const rules of [firestoreRules, storageRules]) {
    assert.match(rules, new RegExp(`termsVersion == '${termsVersion}'`))
    assert.match(rules, new RegExp(`communityRulesVersion == '${communityVersion}'`))
  }
})
