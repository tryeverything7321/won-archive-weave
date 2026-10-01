export type CalendarImportChange = {
  field: string
  label: string
  currentValue: string | boolean | null
  sourceValue: string | boolean | null
}

export type CalendarImportComparison = {
  candidateId: string
  sourceStatus: string
  sourceRevision: string
  eventRevision: string
  changes: CalendarImportChange[]
}

const fields = new Set([
  'title', 'summary', 'description', 'locationName', 'startAt', 'endAt', 'allDay',
  'timeZone', 'sourceUrl', 'organizerName', 'region', 'topic', 'visibility', 'eventState',
])

export function readCalendarImportComparison(value: unknown): CalendarImportComparison {
  const data = value as Partial<CalendarImportComparison> | null
  if (!data || typeof data.candidateId !== 'string' || typeof data.sourceRevision !== 'string'
    || typeof data.eventRevision !== 'string' || !['active', 'disconnected'].includes(data.sourceStatus ?? '')
    || !Array.isArray(data.changes) || data.changes.length > fields.size) throw Error('invalid comparison')
  const seen = new Set<string>()
  for (const change of data.changes) {
    if (!change || !fields.has(change.field) || seen.has(change.field) || typeof change.label !== 'string'
      || ![change.currentValue, change.sourceValue].every(item => item === null || typeof item === 'string' || typeof item === 'boolean')) throw Error('invalid comparison')
    seen.add(change.field)
  }
  return data as CalendarImportComparison
}
