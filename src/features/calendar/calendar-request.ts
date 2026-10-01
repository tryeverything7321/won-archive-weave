export function calendarRequestIsCurrent(requestEpoch: number, currentEpoch: number, requestUid: string | undefined, currentUid: string | undefined) {
  return Boolean(requestUid) && requestUid === currentUid && requestEpoch === currentEpoch
}
