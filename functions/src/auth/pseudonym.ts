export function normalizePseudonym(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

export function validatePseudonym(value: string): string | null {
  const normalized = normalizePseudonym(value)

  if (normalized.length < 2 || normalized.length > 18) {
    return '별명은 2자 이상 18자 이하로 정해 주세요'
  }

  if (!/^[\p{L}\p{N} _-]+$/u.test(normalized)) {
    return '별명에는 한글, 영문, 숫자, 공백, 밑줄, 하이픈만 사용할 수 있어요'
  }

  return null
}
