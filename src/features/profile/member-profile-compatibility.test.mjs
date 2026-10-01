import assert from 'node:assert/strict'
import test from 'node:test'
import { memberProfileResponse } from '../../../functions/lib/profile/member-profile.js'
import {
  ProfileLoadFormatError,
  assertMemberProfilePayload,
  classifyProfileLoadError,
} from './profile-load-state.ts'
import { parseMemberProfile } from './member-profile-model.ts'

const emptyProfile = {
  bio: '',
  region: '',
  organization: '',
  realName: '',
  email: '',
  phone: '',
}

test('profile consumer accepts the server producer contract without a photo field', () => {
  const produced = memberProfileResponse({ region: ' 서울 ', email: null }).profile
  assert.deepEqual(
    parseMemberProfile(assertMemberProfilePayload(produced)),
    { ...emptyProfile, region: '서울', hasProfilePhoto: false },
  )
})

test('profile consumer accepts a full valid wire payload without coupling it to photo storage', () => {
  assert.deepEqual(
    parseMemberProfile(assertMemberProfilePayload({
      bio: '기록을 나눕니다',
      region: '서울',
      organization: '청년회',
      realName: '홍길동',
      email: 'member@example.com',
      phone: '010-1234-5678',
    })),
    {
      bio: '기록을 나눕니다',
      region: '서울',
      organization: '청년회',
      realName: '홍길동',
      email: 'member@example.com',
      phone: '010-1234-5678',
      hasProfilePhoto: false,
    },
  )
})

test('profile consumer defaults absent and null legacy text while rejecting malformed present text', () => {
  assert.deepEqual(
    parseMemberProfile(assertMemberProfilePayload({ region: '서울', email: null })),
    {
      ...emptyProfile,
      region: '서울',
      hasProfilePhoto: false,
    },
  )

  for (const malformed of [
    { region: 37 },
    { email: ['member@example.com'] },
    { phone: false },
  ]) {
    assert.throws(() => assertMemberProfilePayload(malformed), ProfileLoadFormatError)
  }
})

test('profile consumer classifies the producer data-loss rejection as a format recovery issue', () => {
  assert.equal(classifyProfileLoadError({ code: 'functions/data-loss' }), 'format')
})
