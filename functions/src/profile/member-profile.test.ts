import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'
import { currentCommunityRulesVersion, currentTermsVersion } from '../auth/terms.js'
import {
  getMemberProfileForActor,
  memberProfileResponse,
  updateMemberProfileForActor,
} from './member-profile.js'

const currentMember = {
  connected: true,
  termsVersion: currentTermsVersion,
  communityRulesVersion: currentCommunityRulesVersion,
}

async function errorCode(run: () => Promise<unknown>) {
  try {
    await run()
    assert.fail('expected profile policy rejection')
  } catch (error) {
    assert.ok(error instanceof HttpsError)
    return error.code
  }
}

test('owner profile read uses the authenticated uid only', async () => {
  const loaded: string[] = []
  const result = await getMemberProfileForActor(
    { uid: 'member-1' },
    {
      async loadUser(uid) {
        loaded.push(`user:${uid}`)
        return currentMember
      },
      async loadProfile(uid) {
        loaded.push(`profile:${uid}`)
        return {
          realName: '홍길동',
          email: 'member@example.com',
          ownerUid: 'another-member',
          providerProfile: { name: '제공자 이름' },
        }
      },
    },
  )

  assert.deepEqual(loaded, ['user:member-1', 'profile:member-1'])
  assert.deepEqual(result, {
    profile: {
      realName: '홍길동',
      email: 'member@example.com',
    },
  })
})

test('profile read rejects unauthenticated, missing, disconnected, and stale-consent actors before loading profile', async () => {
  let profileLoads = 0
  const run = (auth: { uid?: string } | undefined, user: Record<string, unknown> | undefined) => (
    getMemberProfileForActor(auth, {
      async loadUser() {
        return user
      },
      async loadProfile() {
        profileLoads += 1
        return {}
      },
    })
  )

  assert.equal(await errorCode(() => run(undefined, currentMember)), 'unauthenticated')
  assert.equal(await errorCode(() => run({ uid: 'member-1' }, undefined)), 'failed-precondition')
  assert.equal(await errorCode(() => run({ uid: 'member-1' }, { ...currentMember, connected: false })), 'failed-precondition')
  assert.equal(await errorCode(() => run({ uid: 'member-1' }, { ...currentMember, termsVersion: 'old' })), 'failed-precondition')
  assert.equal(await errorCode(() => run({ uid: 'member-1' }, { ...currentMember, communityRulesVersion: 'old' })), 'failed-precondition')
  assert.equal(profileLoads, 0)
})

test('profile update authorizes first and replaces only the owner document', async () => {
  const calls: Array<{ uid: string; profile: unknown }> = []
  const result = await updateMemberProfileForActor(
    { uid: 'member-1' },
    {
      realName: ' 홍길동 ',
      email: ' MEMBER@example.com ',
      phone: '',
      region: ' 서울 ',
      organization: '청년회',
      bio: ' ',
    },
    {
      async loadUser() {
        return currentMember
      },
      async replaceProfile(uid, profile) {
        calls.push({ uid, profile })
        return profile
      },
    },
  )

  assert.deepEqual(calls, [{
    uid: 'member-1',
    profile: {
      region: '서울',
      organization: '청년회',
      realName: '홍길동',
      email: 'member@example.com',
    },
  }])
  assert.deepEqual(result, {
    profile: {
      region: '서울',
      organization: '청년회',
      realName: '홍길동',
      email: 'member@example.com',
    },
  })
})

test('empty update cannot remove required registration information', async () => {
  let writes = 0
  const code = await errorCode(() => updateMemberProfileForActor({ uid: 'member-1' }, {}, {
    async loadUser() { return currentMember },
    async replaceProfile() { writes++; return {} },
  }))
  assert.equal(code, 'invalid-argument')
  assert.equal(writes, 0)
})

test('profile response exposes timestamps as ISO strings without copying arbitrary data', () => {
  const createdAt = new Date('2026-07-24T00:00:00.000Z')
  const updatedAt = { toDate: () => new Date('2026-07-24T01:00:00.000Z') }
  assert.deepEqual(memberProfileResponse({
    region: '서울',
    createdAt,
    updatedAt,
    privateProviderEmail: 'provider@example.com',
  }), {
    profile: {
      region: '서울',
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T01:00:00.000Z',
    },
  })
})
