import assert from 'node:assert/strict'
import test from 'node:test'
import { currentCommunityRulesVersion, currentTermsVersion, hasCurrentCommunityConsent } from './terms.js'

test('community consent must match both current versions', () => {
  assert.equal(hasCurrentCommunityConsent({ termsVersion: currentTermsVersion, communityRulesVersion: currentCommunityRulesVersion }), true)
  assert.equal(hasCurrentCommunityConsent({ termsVersion: '2026-06', communityRulesVersion: currentCommunityRulesVersion }), false)
  assert.equal(hasCurrentCommunityConsent({ termsVersion: currentTermsVersion }), false)
})
