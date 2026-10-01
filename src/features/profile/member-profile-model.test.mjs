import assert from 'node:assert/strict'
import test from 'node:test'
import {
  memberProfileError,
  memberProfilePhotoDirectory,
  memberProfilePhotoPath,
  normalizeMemberProfile,
  parseMemberProfile,
  profilePhotoError,
} from './member-profile-model.ts'
import {
  adjacentProfileSection,
  profileSectionFromSearch,
  profileSectionUrl,
  requireProfilePhotoOwner,
} from './account-model.ts'

const validInput = {
  bio: '  함께 배우고 싶어요  ',
  region: ' 서울 ',
  organization: ' 마음모임 ',
  realName: ' 홍길동 ',
  email: ' USER@EXAMPLE.COM ',
  phone: ' 010-1234-5678 ',
}

test('normalizes optional profile fields without adding provider data', () => {
  assert.deepEqual(normalizeMemberProfile(validInput), {
    bio: '함께 배우고 싶어요',
    region: '서울',
    organization: '마음모임',
    realName: '홍길동',
    email: 'user@example.com',
    phone: '010-1234-5678',
  })
})

test('parses only the member profile allowlist', () => {
  assert.deepEqual(parseMemberProfile({
    ...validInput,
    providerEmail: 'do-not-copy@example.com',
    uid: 'hidden',
    hasProfilePhoto: true,
  }), {
    bio: '함께 배우고 싶어요',
    region: '서울',
    organization: '마음모임',
    realName: '홍길동',
    email: 'USER@EXAMPLE.COM',
    phone: '010-1234-5678',
    hasProfilePhoto: true,
  })
})

test('accepts empty contact fields and rejects malformed contact values', () => {
  const empty = Object.fromEntries(Object.keys(validInput).map((key) => [key, '']))
  assert.equal(memberProfileError(empty), '실명을 입력해 주세요.')
  assert.equal(memberProfileError({ ...empty, realName: '시험', organization: '소속 없음' }), null)
  assert.equal(memberProfileError({ ...validInput, phone: '+82 10 1234 5678' }), null)
  assert.equal(memberProfileError({ ...validInput, email: 'not-an-email' }), '이메일 주소를 다시 확인해 주세요.')
  assert.equal(memberProfileError({ ...validInput, phone: '전화번호 없음' }), '전화번호를 숫자와 하이픈을 사용해 입력해 주세요.')
  assert.equal(memberProfileError({ ...validInput, phone: '010-1234-' }), '전화번호를 숫자와 하이픈을 사용해 입력해 주세요.')
})

test('enforces profile photo MIME, byte and owner path policy', () => {
  assert.equal(profilePhotoError(new File(['ok'], 'avatar.webp', { type: 'image/webp' })), null)
  assert.equal(
    profilePhotoError(new File(['text'], 'avatar.svg', { type: 'image/svg+xml' })),
    '프로필 사진은 JPEG, PNG, WebP 형식만 올릴 수 있어요.',
  )
  assert.equal(
    profilePhotoError(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })),
    '프로필 사진은 5MB 이하로 올려 주세요.',
  )
  assert.equal(memberProfilePhotoPath('member-123'), 'profile-photos/member-123/avatar')
  assert.equal(memberProfilePhotoDirectory('member-123'), 'profile-photos/member-123')
})

test('profile section state restores supported tabs and persists unrelated URL state', () => {
  assert.equal(profileSectionFromSearch('?tab=activity'), 'activity')
  assert.equal(profileSectionFromSearch('?tab=account'), 'account')
  assert.equal(profileSectionFromSearch('?tab=operator'), 'info')
  assert.equal(profileSectionUrl({
    pathname: '/profile',
    search: '?source=notice&tab=activity',
    hash: '#settings',
  }, 'account'), '/profile?source=notice&tab=account#settings')
  assert.equal(profileSectionUrl({
    pathname: '/profile',
    search: '?source=notice&tab=activity',
    hash: '#settings',
  }, 'info'), '/profile?source=notice#settings')
})

test('profile tabs support wrapped arrow movement and first and last shortcuts', () => {
  assert.equal(adjacentProfileSection('info', 'ArrowLeft'), 'account')
  assert.equal(adjacentProfileSection('account', 'ArrowRight'), 'info')
  assert.equal(adjacentProfileSection('activity', 'Home'), 'info')
  assert.equal(adjacentProfileSection('activity', 'End'), 'account')
  assert.equal(adjacentProfileSection('activity', 'Enter'), null)
})

test('profile photo ownership rejects signed-out and cross-account requests', () => {
  assert.doesNotThrow(() => requireProfilePhotoOwner('member-1', 'member-1'))
  assert.throws(() => requireProfilePhotoOwner(null, 'member-1'), /unavailable/)
  assert.throws(() => requireProfilePhotoOwner('member-2', 'member-1'), /unavailable/)
})
