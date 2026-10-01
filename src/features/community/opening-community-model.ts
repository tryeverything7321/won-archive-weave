export const OPENING_HREF = '/community?tab=opening';
export const OPENING_MARKER = '[오픈 응원]';
export const OPENING_PREFIX = `${OPENING_MARKER}\n\n`;
export function openingPostBody(body: string) {
  return body.startsWith(OPENING_MARKER) ? body : `${OPENING_PREFIX}${body}`;
}
export function isOpeningPost(body: string) { return body.startsWith(OPENING_MARKER); }
