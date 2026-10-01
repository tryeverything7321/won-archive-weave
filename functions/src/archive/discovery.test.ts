import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveDiscoveryItemMatches, type DiscoveryFilters, type DiscoveryItem } from './discovery.js'

const event: DiscoveryItem = {
  targetType: 'event', id: 'event-2025', title: '2025 청년 정기훈련', href: '/archive-events/event-2025',
  sortMs: 1, heldYear: 2025, uploadYear: null, region: '서울', format: null, formats: [],
  organizerIds: ['organizer-a'], linkedEventIds: ['event-2025'], canLink: false,
}

const bundle: DiscoveryItem = {
  targetType: 'bundle', id: 'bundle-2026', title: '단별 발표 자료', href: '/bundles/bundle-2026',
  sortMs: 2, heldYear: null, uploadYear: 2026, region: '', format: 'PPTX', formats: ['PPTX'],
  organizerIds: [], linkedEventIds: ['event-2025'], canLink: true,
}

test('개최 2025년과 업로드 2026년을 함께 고르면 연결 행사와 자료를 모두 발견한다', () => {
  const filters: DiscoveryFilters = { organizerId: 'organizer-a', heldYear: 2025, uploadYear: 2026, region: '서울', format: 'PPTX' }
  const events = new Map([[event.id, event]])
  assert.equal(archiveDiscoveryItemMatches(event, filters, events, [event, bundle]), true)
  assert.equal(archiveDiscoveryItemMatches(bundle, filters, events, [event, bundle]), true)
})

test('행사와 연결하지 않은 자료에 개최 연도를 추정하지 않는다', () => {
  const independent = { ...bundle, id: 'independent', linkedEventIds: [] }
  const filters: DiscoveryFilters = { organizerId: null, heldYear: 2025, uploadYear: null, region: null, format: null }
  assert.equal(archiveDiscoveryItemMatches(independent, filters, new Map([[event.id, event]]), [event, independent]), false)
})
