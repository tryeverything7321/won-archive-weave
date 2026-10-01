import { isIP } from 'node:net'

const MAX_ICS_BYTES = 5 * 1024 * 1024
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/

export type IcsEvent = {
  uid: string
  title: string
  description: string
  location: string
  startAt: Date
  endAt: Date
  allDay: boolean
  timeZone: string
  sourceUrl?: string
  recurrenceRule?: string
  recurrenceId?: string
  status?: 'confirmed' | 'cancelled'
}

export class IcsContractError extends Error {
  constructor(readonly code: 'invalid_url' | 'private_network' | 'invalid_ics' | 'too_large' | 'too_many_events' | 'unsupported_recurrence') {
    super(code)
  }
}

function isPrivateIpv4(value: string) {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
}

export function isPrivateAddress(value: string) {
  if (isIP(value) === 4) return isPrivateIpv4(value)
  if (isIP(value) !== 6) return true
  const normalized = value.toLowerCase().split('%')[0]
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7))
  return false
}

export function validatePublicIcsUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new IcsContractError('invalid_url')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname) {
    throw new IcsContractError('invalid_url')
  }
  const host = url.hostname.toLowerCase()
  const addressHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (isIP(addressHost) !== 0 && isPrivateAddress(addressHost))) {
    throw new IcsContractError('private_network')
  }
  url.hash = ''
  return url.toString()
}

function unescapeText(value: string) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function unfold(value: string) {
  return value.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
}

function parseDate(value: string, params: string[]) {
  const match = value.match(DATE_TIME)
  if (!match) throw new IcsContractError('invalid_ics')
  const [, year, month, day, hour, minute, second] = match
  const allDay = !hour || params.some((param) => param.toUpperCase() === 'VALUE=DATE')
  const timeZone = params.find((param) => param.toUpperCase().startsWith('TZID='))?.slice(5) || 'Asia/Seoul'
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date())
  } catch {
    throw new IcsContractError('invalid_ics')
  }
  const utcValue = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0),
  )
  const zoneOffset = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour), Number(map.minute), Number(map.second),
    ) - date.getTime()
  }
  const iso = allDay
    ? `${year}-${month}-${day}T00:00:00+09:00`
    : `${year}-${month}-${day}T${hour}:${minute}:${second ?? '00'}Z`
  let date = new Date(iso)
  if (!allDay && !value.endsWith('Z')) {
    date = new Date(utcValue - zoneOffset(new Date(utcValue)))
    date = new Date(utcValue - zoneOffset(date))
  }
  if (Number.isNaN(date.getTime())) throw new IcsContractError('invalid_ics')
  return { date, allDay, timeZone }
}

export function parseIcs(value: string, maxEvents: number = icsLimits.maxEventsPerSync): IcsEvent[] {
  if (Buffer.byteLength(value, 'utf8') > MAX_ICS_BYTES) throw new IcsContractError('too_large')
  const lines = unfold(value)
  if (!lines.includes('BEGIN:VCALENDAR')) throw new IcsContractError('invalid_ics')
  const events: IcsEvent[] = []
  let current: Record<string, { value: string; params: string[] }> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (!current) continue
      const uid = current.UID?.value.trim()
      const summary = current.SUMMARY?.value.trim()
      const start = current.DTSTART && parseDate(current.DTSTART.value, current.DTSTART.params)
      if (!uid || !summary || !start) throw new IcsContractError('invalid_ics')
      const parsedEnd = current.DTEND && parseDate(current.DTEND.value, current.DTEND.params)
      const defaultDuration = start.allDay ? 86_400_000 : 3_600_000
      const endAt = parsedEnd?.date ?? new Date(start.date.getTime() + defaultDuration)
      if (endAt <= start.date) throw new IcsContractError('invalid_ics')
      let sourceUrl: string | undefined
      if (current.URL?.value) {
        try {
          sourceUrl = validatePublicIcsUrl(current.URL.value)
        } catch {
          sourceUrl = undefined
        }
      }
      events.push({
        uid,
        title: unescapeText(summary),
        description: unescapeText(current.DESCRIPTION?.value ?? ''),
        location: unescapeText(current.LOCATION?.value ?? ''),
        startAt: start.date,
        endAt,
        allDay: start.allDay,
        timeZone: start.timeZone,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(current.RRULE?.value ? { recurrenceRule: current.RRULE.value } : {}),
        ...(current['RECURRENCE-ID'] ? { recurrenceId: parseDate(current['RECURRENCE-ID'].value, current['RECURRENCE-ID'].params).date.toISOString() } : {}),
        ...(current.STATUS?.value.toUpperCase() === 'CANCELLED' ? { status: 'cancelled' as const } : {}),
      })
      if (events.length > maxEvents) throw new IcsContractError('too_many_events')
      current = null
      continue
    }
    if (!current) continue
    const delimiter = line.indexOf(':')
    if (delimiter <= 0) continue
    const [name, ...params] = line.slice(0, delimiter).split(';')
    current[name.toUpperCase()] = { value: line.slice(delimiter + 1), params }
  }
  return events
}

export const icsLimits = {
  maxBytes: MAX_ICS_BYTES,
  maxRedirects: 3,
  timeoutMs: 10_000,
  maxEventsPerSync: 500,
} as const
