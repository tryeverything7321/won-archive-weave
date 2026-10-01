import assert from 'node:assert/strict'
import test from 'node:test'
import { eventDetailPresentation } from './event-detail-presentation.ts'

const event = {
  summary: '청년회에서 준비한 행사입니다.',
  description: '',
  organizerName: '청년회',
  sourceType: 'manual',
  thumbnail: undefined,
}

test('manual event without authored copy or media has a compact factual detail state', () => {
  assert.deepEqual(eventDetailPresentation(event), {
    summary: null,
    description: null,
    hasThumbnail: false,
    showSource: false,
  })
})

test('authored copy, media and imported source remain visible', () => {
  assert.deepEqual(eventDetailPresentation({
    ...event,
    summary: '  함께 공부하는 하루  ',
    description: '  오후에 모입니다.  ',
    thumbnail: { url: 'https://example.com/poster.jpg', alt: '행사 포스터' },
    sourceType: 'ics',
  }), {
    summary: '함께 공부하는 하루',
    description: '오후에 모입니다.',
    hasThumbnail: true,
    showSource: true,
  })
})
