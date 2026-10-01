export function resolveMediaDisplayMode(value: unknown): 'contain' | 'cover' {
  return value === 'cover' ? 'cover' : 'contain';
}
