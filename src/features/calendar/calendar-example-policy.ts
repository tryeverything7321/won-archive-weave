export function includeCalendarExample(search: URLSearchParams): boolean {
  return search.get('examples') === '1';
}

export function calendarSearchWithExamples(search: string, enabled: boolean): string {
  const value = new URLSearchParams(search);
  if (enabled) value.set('examples', '1');
  else value.delete('examples');
  return `?${value.toString()}`;
}
