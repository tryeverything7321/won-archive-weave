import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ProfileLoadFormatError,
  assertMemberProfilePayload,
  classifyProfileLoad,
  classifyProfileLoadError,
  isCurrentProfileLoad,
} from './profile-load-state.ts'

const syntheticProfile = {
  bio: '',
  region: '',
  organization: '',
  realName: '',
  email: '',
  phone: '',
  hasProfilePhoto: false,
}

test('keeps the core profile ready when optional photo loading fails', () => {
  assert.deepEqual(classifyProfileLoad(
    { status: 'fulfilled', value: syntheticProfile },
    { status: 'rejected', reason: { code: 'storage/retry-limit-exceeded' } },
  ), {
    profileState: 'ready',
    profile: syntheticProfile,
    photoState: 'error',
    photo: null,
    photoIssue: 'network',
  })
})

test('treats a missing optional photo as an empty photo state', () => {
  assert.deepEqual(classifyProfileLoad(
    { status: 'fulfilled', value: syntheticProfile },
    { status: 'fulfilled', value: null },
  ), {
    profileState: 'ready',
    profile: syntheticProfile,
    photoState: 'empty',
    photo: null,
  })
})

test('does not turn a denied core profile request into blank success', () => {
  assert.deepEqual(classifyProfileLoad(
    { status: 'rejected', reason: { code: 'functions/permission-denied' } },
    { status: 'fulfilled', value: null },
  ), {
    profileState: 'error',
    profile: null,
    profileIssue: 'permission',
    photoState: 'empty',
    photo: null,
  })
})

test('classifies network, response-format and service failures without exposing raw errors', () => {
  assert.equal(classifyProfileLoadError({ code: 'functions/unavailable' }), 'network')
  assert.equal(classifyProfileLoadError(new ProfileLoadFormatError()), 'format')
  assert.equal(classifyProfileLoadError(new Error('synthetic internal detail')), 'service')
})

test('accepts only responses from the active account and request generation', () => {
  const request = { uid: 'member-a', generation: 4 }
  assert.equal(isCurrentProfileLoad(request, 'member-a', 4), true)
  assert.equal(isCurrentProfileLoad(request, 'member-b', 4), false)
  assert.equal(isCurrentProfileLoad(request, 'member-a', 5), false)
})

test('rejects an async profile operation after unmount or an A to B to A account cycle', () => {
  const request = { uid: 'member-a', generation: 4 }
  assert.equal(isCurrentProfileLoad(request, 'member-a', 4, { mounted: false }), false)
  assert.equal(isCurrentProfileLoad(request, 'member-a', 6, { mounted: true }), false)
})

test('rejects a superseded profile operation', () => {
  assert.equal(isCurrentProfileLoad(
    { uid: 'member-a', generation: 4, operationRevision: 2 },
    'member-a',
    4,
    { mounted: true, operationRevision: 3 },
  ), false)
})

test('rejects a save result after a newer text edit', () => {
  assert.equal(isCurrentProfileLoad(
    { uid: 'member-a', generation: 4, editRevision: 7 },
    'member-a',
    4,
    { mounted: true, editRevision: 8 },
  ), false)
})

test('rejects a photo result after a newer photo selection', () => {
  assert.equal(isCurrentProfileLoad(
    { uid: 'member-a', generation: 4, photoRevision: 11 },
    'member-a',
    4,
    { mounted: true, photoRevision: 12 },
  ), false)
})

test('accepts a structured empty profile but rejects a malformed success payload', () => {
  assert.deepEqual(assertMemberProfilePayload(syntheticProfile), {
    bio: '',
    region: '',
    organization: '',
    realName: '',
    email: '',
    phone: '',
  })
  assert.deepEqual(assertMemberProfilePayload({}), {
    bio: '',
    region: '',
    organization: '',
    realName: '',
    email: '',
    phone: '',
  })
  assert.throws(() => assertMemberProfilePayload({ ...syntheticProfile, email: 7 }), ProfileLoadFormatError)
})
