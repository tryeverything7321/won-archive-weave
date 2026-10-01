export type ProfileLoadIssue = 'permission' | 'network' | 'format' | 'service'

export class ProfileLoadFormatError extends Error {
  readonly code = 'profile/invalid-format'

  constructor() {
    super('The member profile response has an invalid format')
    this.name = 'ProfileLoadFormatError'
  }
}

const profileTextFields = ['bio', 'region', 'organization', 'realName', 'email', 'phone'] as const
const profileTextLimits = {
  bio: 300,
  region: 80,
  organization: 120,
  realName: 80,
  email: 254,
  phone: 32,
} as const

function isValidProfileText(field: (typeof profileTextFields)[number], value: string): boolean {
  const normalized = value.trim()
  if (normalized.length > profileTextLimits[field]) return false
  if (field === 'email' && normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return false
  if (field === 'phone' && normalized) {
    const digitCount = normalized.replace(/\D/g, '').length
    return /^\+?[0-9][0-9().\-\s]*[0-9]$/.test(normalized) && digitCount >= 7 && digitCount <= 15
  }
  return true
}

export function assertMemberProfilePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfileLoadFormatError()
  }
  const source = value as Record<string, unknown>
  const profile: Record<string, unknown> = {}
  for (const field of profileTextFields) {
    const fieldValue = source[field]
    if (
      fieldValue !== undefined
      && fieldValue !== null
      && (typeof fieldValue !== 'string' || !isValidProfileText(field, fieldValue))
    ) {
      throw new ProfileLoadFormatError()
    }
    profile[field] = typeof fieldValue === 'string' ? fieldValue : ''
  }
  return profile
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return typeof error.code === 'string' ? error.code : ''
}

export function classifyProfileLoadError(error: unknown): ProfileLoadIssue {
  if (
    error instanceof ProfileLoadFormatError
    || errorCode(error) === 'profile/invalid-format'
    || errorCode(error) === 'functions/data-loss'
    || errorCode(error) === 'data-loss'
  ) {
    return 'format'
  }

  const code = errorCode(error)
  if (
    code === 'functions/permission-denied'
    || code === 'permission-denied'
    || code === 'functions/unauthenticated'
    || code === 'unauthenticated'
    || code === 'storage/unauthorized'
    || code === 'storage/unauthenticated'
  ) {
    return 'permission'
  }
  if (
    code === 'functions/unavailable'
    || code === 'unavailable'
    || code === 'functions/deadline-exceeded'
    || code === 'deadline-exceeded'
    || code === 'auth/network-request-failed'
    || code === 'storage/retry-limit-exceeded'
  ) {
    return 'network'
  }
  return 'service'
}

export function classifyProfileLoad<TProfile, TPhoto>(
  profileResult: PromiseSettledResult<TProfile>,
  photoResult: PromiseSettledResult<TPhoto | null>,
) {
  const profile = profileResult.status === 'fulfilled'
    ? { profileState: 'ready' as const, profile: profileResult.value }
    : {
        profileState: 'error' as const,
        profile: null,
        profileIssue: classifyProfileLoadError(profileResult.reason),
      }
  const photo = photoResult.status === 'fulfilled'
    ? {
        photoState: photoResult.value === null ? 'empty' as const : 'ready' as const,
        photo: photoResult.value,
      }
    : {
        photoState: 'error' as const,
        photo: null,
        photoIssue: classifyProfileLoadError(photoResult.reason),
      }
  return { ...profile, ...photo }
}

export function isCurrentProfileLoad(
  request: {
    uid: string
    generation: number
    operationRevision?: number
    editRevision?: number
    photoRevision?: number
  },
  currentUid: string,
  currentGeneration: number,
  current: {
    mounted?: boolean
    operationRevision?: number
    editRevision?: number
    photoRevision?: number
  } = {},
): boolean {
  if (current.mounted === false) return false
  if (request.uid !== currentUid || request.generation !== currentGeneration) return false
  if (
    request.operationRevision !== undefined
    && request.operationRevision !== current.operationRevision
  ) return false
  if (request.editRevision !== undefined && request.editRevision !== current.editRevision) return false
  if (request.photoRevision !== undefined && request.photoRevision !== current.photoRevision) return false
  return true
}
