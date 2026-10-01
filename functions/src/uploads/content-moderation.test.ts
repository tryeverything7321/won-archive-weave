import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  operatorModerationBlocksPublication,
  operatorModerationCommandKey,
  preservedPublishedVisibility,
  projectOperatorModerationNotice,
  validateReasonedContentModeration,
} from './content-moderation.js'

test('legacy correction routes persist author notice, guidance and deterministic retry receipt', async () => {
  for (const [path, start, end] of [
    ['src/uploads/submissions.ts', 'export const resolveSubmissionOperatorException', 'export const getMySubmissionDraft'],
    ['src/calendar/event-management.ts', 'export const reviewManualEvent', 'const attemptId = randomUUID()'],
  ]) {
    const source = await readFile(path, 'utf8')
    const body = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
    assert.match(body, /validateReasonedContentModeration/, path)
    assert.match(body, /operatorModerationCommandKey/, path)
    assert.match(body, /moderationNotice: notice/, path)
    assert.match(body, /moderationGuidance: notice/, path)
    assert.ok(body.indexOf('existingCommand') < body.indexOf("'not-found'"), `${path} retries must be checked before mutable workflow state`)
  }
})

test('event photos are gated by published event state rather than a blanket public rule', async () => {
  const rules = await readFile('../storage.rules', 'utf8')
  assert.match(rules, /function readableEventMedia\(eventId, visibility\)/)
  assert.match(rules, /\.data\.status == 'published'/)
  assert.match(rules, /category != 'calendar-events'/)
  assert.doesNotMatch(rules, /match \/approved\/public\/\{allPaths=\*\*\}/)
  const source = await readFile('src/calendar/event-management.ts', 'utf8')
  assert.match(source, /cacheControl: 'private,no-store,max-age=0'/)
})

test('reasoned content actions require bounded reasons and retry keys', () => {
  assert.deepEqual(validateReasonedContentModeration({
    action: 'request_correction',
    reason: ' 개인정보가 포함된 부분을 고쳐 주세요. ',
    requestId: 'request_12345678',
  }), {
    action: 'request_correction',
    reason: '개인정보가 포함된 부분을 고쳐 주세요.',
    requestId: 'request_12345678',
  })
  assert.throws(() => validateReasonedContentModeration({ action: 'hold', reason: '', requestId: 'request_12345678' }), { code: 'invalid-argument' })
  assert.throws(() => validateReasonedContentModeration({ action: 'remove', reason: '삭제 사유', requestId: '../unsafe' }), { code: 'invalid-argument' })
})

test('only operator hold and remove markers block publication', () => {
  assert.equal(operatorModerationBlocksPublication({ action: 'hold' }), true)
  assert.equal(operatorModerationBlocksPublication({ action: 'remove' }), true)
  assert.equal(operatorModerationBlocksPublication({ action: 'request_correction' }), false)
  assert.equal(operatorModerationBlocksPublication(undefined), false)
})

test('a later moderation action preserves the original bounded visibility', () => {
  assert.equal(preservedPublishedVisibility({ previousActivityVisibility: 'member_only' }, 'hold', 'public'), 'member_only')
  assert.equal(preservedPublishedVisibility(undefined, 'member_only', 'public'), 'member_only')
  assert.equal(preservedPublishedVisibility(undefined, 'hold', 'unknown'), null)
})

test('moderation retry keys are deterministic and notices omit private identifiers', () => {
  assert.equal(
    operatorModerationCommandKey('operator-1', 'request_12345678'),
    operatorModerationCommandKey('operator-1', 'request_12345678'),
  )
  assert.deepEqual(projectOperatorModerationNotice({
    action: 'hold',
    reason: '개인정보 보호를 위해 숨겼어요.',
    operatorUid: 'private-operator',
    ownerUid: 'private-owner',
    createdAt: { toMillis: () => 1234 },
  }), {
    action: 'hold',
    reason: '개인정보 보호를 위해 숨겼어요.',
    createdAtMs: 1234,
  })
})
