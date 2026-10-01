import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import config from './handoff-v2-preview.vite.ts'
import { memberProfileResponse } from '../functions/lib/profile/member-profile.js'
import { communityOwnershipResponse } from '../functions/lib/community/posts.js'

function callableFixture(profile = 'ready') {
  const state = { profile, user: { uid: 'synthetic-a' }, calls: [], profileDelay: 0 }
  const plugin = config.plugins.find((item) => item.name === 'weave-local-synthetic-only')
  const source = plugin.load('\0weave-test:functions')
    .replace(/^export \* from [^;]+; import \{state,sleep\} from 'weave-test:state';/, '')
    .replace('export function httpsCallable', 'function httpsCallable')
  const context = { state, sleep: async () => {} }
  vm.runInNewContext(source, context)
  return (name, input) => context.httpsCallable(null, name)(input)
}

const wire = (value) => JSON.parse(JSON.stringify(value))

test('preview profile read matches the actual producer wire shape', async () => {
  const result = await callableFixture()('getMyMemberProfile')
  const expected = memberProfileResponse({ bio: '합성 프로필 synthetic-a', region: '서울', organization: '검증 모임' })
  assert.deepEqual(wire(result.data), wire(expected))
})

test('preview new profile is genuinely empty, not a fabricated complete profile', async () => {
  const result = await callableFixture('empty')('getMyMemberProfile')
  assert.deepEqual(wire(result.data), wire(memberProfileResponse(undefined)))
})

test('preview save reflects actual optional-field normalization without photo metadata', async () => {
  const input = { bio: '수정한 소개', region: '', organization: '' }
  const result = await callableFixture()('updateMyMemberProfile', input)
  assert.deepEqual(wire(result.data), wire(memberProfileResponse(input)))
})

test('preview ownership keeps the complete hidden-policy wire contract', async () => {
  const result = await callableFixture()('getCommunityPostOwnership', { postIds: [], comments: [] })
  const expected = communityOwnershipResponse({ uid:'synthetic-a',administrator:false,postIds:[],comments:[],ownerUids:[],hiddenOwnerUids:new Set() })
  assert.deepEqual(wire(result.data),wire(expected))
})
