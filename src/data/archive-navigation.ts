export function resetArchiveFilters(current: URLSearchParams) {
  const next = new URLSearchParams(current)
  next.delete('topic')
  next.delete('type')
  next.delete('q')
  return next
}

export function resourcesReturnPath(value: unknown) {
  return typeof value === 'string' && /^\/resources(?:\?[^#]*)?$/.test(value)
    ? value
    : '/resources'
}
