import type { CalendarEvent } from './calendar-model'

export function eventDetailPresentation(event: CalendarEvent) {
  const summary = event.summary.trim()
  const generatedSummary = `${event.organizerName}에서 준비한 행사입니다.`
  const description = event.description.trim()

  return {
    summary: summary && summary !== generatedSummary ? summary : null,
    description: description || null,
    hasThumbnail: Boolean(event.thumbnail),
    showSource: event.sourceType !== 'manual',
  }
}
