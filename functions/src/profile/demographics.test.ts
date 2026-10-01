import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDemographics, religionConsentVersion, summarizeDemographics } from './demographics.js'
import { requireRegistrationProfile } from './member-profile.js'
import { eventPrefillFromProfile } from './contracts.js'

test('required registration accepts no affiliation but rejects blank required fields', () => {
  assert.throws(() => requireRegistrationProfile({ organization: '소속 없음' }))
  assert.throws(() => requireRegistrationProfile({ realName: '시험 사용자', organization: ' ' }))
  assert.equal(requireRegistrationProfile({ realName: '시험 사용자', organization: '소속 없음' }).organization, '소속 없음')
})
test('religion needs explicit versioned consent and optional answers may be omitted', () => {
  assert.deepEqual(normalizeDemographics({}, true), {})
  for (const religionConsentVersion of [undefined, 'old', true]) {
    assert.throws(() => normalizeDemographics({ wonBuddhismMembership: 'joined', religionConsentVersion }, true))
  }
  assert.deepEqual(normalizeDemographics({ wonBuddhismMembership: 'joined', religionConsentVersion }, true), { wonBuddhismMembership: 'joined', religionConsentVersion })
  assert.deepEqual(normalizeDemographics({ wonBuddhismMembership: 'joined' }), {})
  assert.throws(() => normalizeDemographics({ ageBand: 'unexpected' }, true))
})
test('demographic totals preserve unanswered and never use answers without consent', () => {
  const result = summarizeDemographics([{ ageBand: '20s', wonBuddhismMembership: 'joined', religionConsentVersion }, undefined, { wonBuddhismMembership: 'joined' }])
  assert.equal(result.populationCount, 3)
  assert.equal(result.ageBand['20s'], 1)
  assert.equal(result.ageBand.unanswered, 2)
  assert.equal(result.membership.joined, 1)
  assert.equal(result.membership.unanswered, 2)
})
test('event prefill does not expose religion or age', () => {
  assert.deepEqual(eventPrefillFromProfile({ realName: '시험', ageBand: '20s', wonBuddhismMembership: 'joined', religionConsentVersion }), { realName: '시험' })
})
