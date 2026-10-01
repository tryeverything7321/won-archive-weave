import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'
import {
  eventPrefillFromProfile,
  memberProfileLimits,
  normalizeMemberProfileInput,
  normalizeStoredMemberProfile,
} from './contracts.js'

function errorCode(run: () => unknown) {
  try {
    run()
    assert.fail('expected profile contract rejection')
  } catch (error) {
    assert.ok(error instanceof HttpsError)
    return error.code
  }
}

test('profile input trims values, lowercases email, and removes empty optional fields', () => {
  assert.deepEqual(normalizeMemberProfileInput({
    bio: '  청년 활동을 기록합니다  ',
    region: ' 서울 ',
    organization: '   ',
    realName: ' 홍길동 ',
    email: ' Member@Example.COM ',
    phone: ' 010-1234-5678 ',
  }), {
    bio: '청년 활동을 기록합니다',
    region: '서울',
    realName: '홍길동',
    email: 'member@example.com',
    phone: '010-1234-5678',
  })
})

test('profile input rejects non-allowlisted public identity and provider fields', () => {
  assert.equal(errorCode(() => normalizeMemberProfileInput({
    realName: '홍길동',
    pseudonym: '공개 별명',
  })), 'invalid-argument')
  assert.equal(errorCode(() => normalizeMemberProfileInput({
    providerProfile: { name: '카카오 이름' },
  })), 'invalid-argument')
  assert.equal(errorCode(() => normalizeMemberProfileInput({
    uid: 'another-member',
  })), 'invalid-argument')
})

test('profile input enforces every text length boundary', () => {
  for (const [field, maximum] of Object.entries(memberProfileLimits)) {
    const validAtMaximum = field === 'email'
      ? `${'a'.repeat(maximum - '@b.co'.length)}@b.co`
      : field === 'phone'
        ? `1${'-'.repeat(maximum - 15)}${'1'.repeat(14)}`
        : '가'.repeat(maximum)
    assert.equal(
      errorCode(() => normalizeMemberProfileInput({ [field]: '가'.repeat(maximum + 1) })),
      'invalid-argument',
      field,
    )
    assert.equal(
      normalizeMemberProfileInput({ [field]: validAtMaximum })[field as keyof typeof memberProfileLimits],
      validAtMaximum,
      field,
    )
  }
})

test('email and phone remain optional but reject malformed values', () => {
  assert.deepEqual(normalizeMemberProfileInput({ email: '', phone: '   ' }), {})
  for (const email of ['member', 'member@', '@example.com', 'member @example.com']) {
    assert.equal(errorCode(() => normalizeMemberProfileInput({ email })), 'invalid-argument')
  }
  for (const phone of ['123', '010-ABCD-5678', '+82()', '010_1234_5678']) {
    assert.equal(errorCode(() => normalizeMemberProfileInput({ phone })), 'invalid-argument')
  }
  assert.equal(normalizeMemberProfileInput({ phone: '+82 10 1234 5678' }).phone, '+82 10 1234 5678')
})

test('event prefill includes only stored participation fields and never bio', () => {
  assert.deepEqual(eventPrefillFromProfile({
    bio: '공개하지 않는 소개',
    region: '서울',
    realName: '홍길동',
    email: '',
  }), {
    realName: '홍길동',
    region: '서울',
  })
})

test('stored profile projection drops unknown and malformed legacy values', () => {
  assert.deepEqual(normalizeStoredMemberProfile({
    bio: ' 소개 ',
    email: 'invalid',
    phone: '010-1234-5678',
    provider: 'kakao',
    pseudonym: '공개 별명',
    providerName: '제공자 실명',
  }), {
    bio: '소개',
    phone: '010-1234-5678',
  })
})
