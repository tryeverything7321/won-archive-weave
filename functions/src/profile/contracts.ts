import { normalizeDemographics, type Demographics } from './demographics.js'
import { HttpsError } from 'firebase-functions/v2/https'

export const memberProfileLimits = {
  bio: 300,
  region: 80,
  organization: 120,
  realName: 80,
  email: 254,
  phone: 32,
} as const

export const memberProfileInputFields = [
  'bio',
  'region',
  'organization',
  'realName',
  'email',
  'phone',
] as const

export const eventPrefillFields = [
  'realName',
  'email',
  'phone',
  'region',
  'organization',
] as const

export type MemberProfileTextField = keyof typeof memberProfileLimits
export type EventPrefillField = (typeof eventPrefillFields)[number]

export type MemberProfileInput = Partial<Record<MemberProfileTextField, string>> & Demographics

export type MemberProfile = MemberProfileInput & {
  createdAt?: string
  updatedAt?: string
}

export type EventPrefillProjection = Partial<Record<EventPrefillField, string>>

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const phoneCharactersPattern = /^\+?[0-9][0-9().\-\s]*[0-9]$/u

function invalid(message: string): never {
  throw new HttpsError('invalid-argument', message)
}

function assertPlainObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('내 정보 입력 내용을 확인해 주세요')
  }
}

function normalizeText(value: unknown, field: MemberProfileTextField): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') invalid('내 정보 입력 내용을 확인해 주세요')

  const normalized = value.trim()
  if (!normalized) return undefined
  if (normalized.length > memberProfileLimits[field]) {
    const labels: Record<MemberProfileTextField, string> = {
      bio: '짧은 소개',
      region: '지역',
      organization: '소속 교당·모임',
      realName: '실명',
      email: '이메일',
      phone: '전화번호',
    }
    invalid(`${labels[field]}은 ${memberProfileLimits[field]}자 이하로 입력해 주세요`)
  }
  return field === 'email' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function validateEmail(value: string | undefined) {
  if (value && !emailPattern.test(value)) invalid('이메일 형식을 확인해 주세요')
}

function validatePhone(value: string | undefined) {
  if (!value) return
  const digitCount = value.replace(/\D/gu, '').length
  if (
    !phoneCharactersPattern.test(value)
    || digitCount < 7
    || digitCount > 15
  ) {
    invalid('전화번호 형식을 확인해 주세요')
  }
}

export function normalizeMemberProfileInput(value: unknown): MemberProfileInput {
  assertPlainObject(value)
  const allowed = new Set<string>([...memberProfileInputFields, 'ageBand', 'wonBuddhismMembership', 'religionConsentVersion'])
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalid('저장할 수 없는 내 정보 항목이 포함되어 있어요')
  }

  const profile: MemberProfileInput = {}
  for (const field of Object.keys(memberProfileLimits) as MemberProfileTextField[]) {
    const normalized = normalizeText(value[field], field)
    if (normalized !== undefined) profile[field] = normalized
  }

  validateEmail(profile.email)
  validatePhone(profile.phone)

  return Object.assign(profile, normalizeDemographics(value as Record<string, unknown>, true))
}

export function normalizeStoredMemberProfile(value: unknown): MemberProfileInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const profile: MemberProfileInput = {}

  for (const field of Object.keys(memberProfileLimits) as MemberProfileTextField[]) {
    try {
      const normalized = normalizeText(source[field], field)
      if (normalized !== undefined) profile[field] = normalized
    } catch {
      // An invalid legacy value must not break the owner view or enter event prefill.
    }
  }
  try {
    validateEmail(profile.email)
  } catch {
    delete profile.email
  }
  try {
    validatePhone(profile.phone)
  } catch {
    delete profile.phone
  }
  return Object.assign(profile, normalizeDemographics(source))
}

function storedProfileDataLoss(): never {
  throw new HttpsError('data-loss', '저장된 내 정보의 형식을 확인할 수 없어요')
}

export function normalizeStoredMemberProfileForOwner(value: unknown): MemberProfileInput {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    storedProfileDataLoss()
  }
  const source = (value ?? {}) as Record<string, unknown>
  const profile: MemberProfileInput = {}

  for (const field of memberProfileInputFields) {
    const stored = source[field]
    if (stored === undefined || stored === null) {
      continue
    }
    try {
      const normalized = normalizeText(stored, field)
      if (normalized !== undefined) profile[field] = normalized
    } catch {
      storedProfileDataLoss()
    }
  }
  try {
    validateEmail(profile.email)
    validatePhone(profile.phone)
  } catch {
    storedProfileDataLoss()
  }
  return Object.assign(profile, normalizeDemographics(source))
}

export function eventPrefillFromProfile(profile: MemberProfileInput): EventPrefillProjection {
  const projection: EventPrefillProjection = {}
  for (const field of eventPrefillFields) {
    const value = profile[field]
    if (value) projection[field] = value
  }
  return projection
}
