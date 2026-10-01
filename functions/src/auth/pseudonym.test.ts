import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePseudonym, validatePseudonym } from './pseudonym.js'

test('normalizes whitespace and case for a pseudonym key', () => {
  assert.equal(normalizePseudonym('  함께  걷기  '), '함께 걷기')
  assert.equal(normalizePseudonym('Youth_One'), 'youth_one')
})

test('rejects unsupported pseudonym characters and invalid length', () => {
  assert.equal(validatePseudonym('a'), '별명은 2자 이상 18자 이하로 정해 주세요')
  assert.equal(validatePseudonym('함께!'), '별명에는 한글, 영문, 숫자, 공백, 밑줄, 하이픈만 사용할 수 있어요')
  assert.equal(validatePseudonym('함께 걷기'), null)
})
