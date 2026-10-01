export type GoogleAuthOutcomeKind =
  | 'popup_closed'
  | 'popup_failed_to_open'
  | 'access_denied'
  | 'authorization_expired'
  | 'network'
  | 'configuration'
  | 'unknown'

export type GoogleAuthOutcome = {
  kind: GoogleAuthOutcomeKind
  state: 'cancelled' | 'error'
  retryable: true
  message: string
}

export type GoogleAuthSignal = {
  source: 'sdk_error_callback' | 'oauth_callback' | 'api_response' | 'network' | 'configuration' | 'unknown'
  type?: unknown
  error?: unknown
  error_description?: unknown
  status?: unknown
}

const outcomes: Record<GoogleAuthOutcomeKind, GoogleAuthOutcome> = {
  popup_closed: {
    kind: 'popup_closed',
    state: 'cancelled',
    retryable: true,
    message: 'Google 연결을 취소했어요. 준비되면 다시 연결할 수 있어요.',
  },
  popup_failed_to_open: {
    kind: 'popup_failed_to_open',
    state: 'error',
    retryable: true,
    message: 'Google 연결 창이 열리지 않았어요. 브라우저의 팝업 차단을 해제한 뒤 다시 시도해 주세요.',
  },
  access_denied: {
    kind: 'access_denied',
    state: 'error',
    retryable: true,
    message: 'Google Calendar 읽기 권한이 허용되지 않았어요. 일정을 확인하려면 읽기 권한을 허용한 뒤 다시 연결해 주세요.',
  },
  authorization_expired: {
    kind: 'authorization_expired',
    state: 'error',
    retryable: true,
    message: 'Google Calendar 연결이 만료되었어요. 다시 연결해 주세요.',
  },
  network: {
    kind: 'network',
    state: 'error',
    retryable: true,
    message: '네트워크 연결이 원활하지 않아 Google Calendar에 연결하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.',
  },
  configuration: {
    kind: 'configuration',
    state: 'error',
    retryable: true,
    message: 'Google Calendar 연결 설정에 문제가 있어요. 운영자에게 오류 ID G-CALENDAR-CONFIG를 알려 주세요.',
  },
  unknown: {
    kind: 'unknown',
    state: 'error',
    retryable: true,
    message: 'Google Calendar 연결 중 알 수 없는 문제가 생겼어요. 다시 시도해 주세요. 계속되면 운영자에게 오류 ID G-CALENDAR-UNKNOWN을 알려 주세요.',
  },
}

const configurationErrors = new Set([
  'invalid_client',
  'deleted_client',
  'origin_mismatch',
  'org_internal',
  'admin_policy_enforced',
])

export function classifyGoogleAuthOutcome(signal: GoogleAuthSignal): GoogleAuthOutcome {
  if (signal.source === 'sdk_error_callback') {
    if (signal.type === 'popup_closed') return outcomes.popup_closed
    if (signal.type === 'popup_failed_to_open') return outcomes.popup_failed_to_open
    return outcomes.unknown
  }

  if (signal.source === 'oauth_callback') {
    if (signal.error === 'access_denied') return outcomes.access_denied
    if (signal.error === 'invalid_grant') return outcomes.authorization_expired
    if (typeof signal.error === 'string' && configurationErrors.has(signal.error)) return outcomes.configuration
    return outcomes.unknown
  }

  if (signal.source === 'api_response' && signal.status === 401) return outcomes.authorization_expired
  if (signal.source === 'network') return outcomes.network
  if (signal.source === 'configuration') return outcomes.configuration
  return outcomes.unknown
}

export function reconcileGoogleCalendarSource(
  previousCalendarId: string,
  readableCalendars: ReadonlyArray<{ id: string; primary?: boolean }>,
) {
  const previous = readableCalendars.find((calendar) => calendar.id === previousCalendarId)
  const fallback = readableCalendars.find((calendar) => calendar.primary) ?? readableCalendars[0]

  return {
    calendarId: previous?.id ?? fallback?.id ?? '',
    clearDependentSelection: Boolean(previousCalendarId && !previous),
  }
}
