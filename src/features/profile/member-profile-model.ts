export const memberProfileLimits = {
  bio: 300,
  region: 80,
  organization: 120,
  realName: 80,
  email: 254,
  phone: 32,
} as const

export const profilePhotoPolicy = {
  accept: 'image/jpeg,image/png,image/webp',
  maxBytes: 5 * 1024 * 1024,
  contentTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const

export type MemberProfileField = keyof typeof memberProfileLimits

export const religionConsentVersion = '2026-10-01'
export const ageBandLabels = { under20: '10대 이하', '20s': '20대', '30s': '30대', '40s': '40대', '50plus': '50대 이상' }
export const membershipLabels = { joined: '입교함', not_joined: '입교하지 않음', unsure: '잘 모르겠음' }
export type OptionalMemberInformation = { ageBand?: string; wonBuddhismMembership?: string; religionConsentVersion?: string }
export type MemberProfileValue = Record<MemberProfileField, string> & OptionalMemberInformation & {
  hasProfilePhoto: boolean
}

export type MemberProfileInput = Record<MemberProfileField, string> & OptionalMemberInformation

export const emptyMemberProfile: MemberProfileValue = {
  bio: '',
  region: '',
  organization: '',
  realName: '',
  email: '',
  phone: '',
  hasProfilePhoto: false,
}

function readString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export function parseMemberProfile(value: unknown): MemberProfileValue {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    bio: readString(source.bio, memberProfileLimits.bio),
    region: readString(source.region, memberProfileLimits.region),
    organization: readString(source.organization, memberProfileLimits.organization),
    realName: readString(source.realName, memberProfileLimits.realName),
    email: readString(source.email, memberProfileLimits.email),
    phone: readString(source.phone, memberProfileLimits.phone),
    hasProfilePhoto: source.hasProfilePhoto === true,
    ...(typeof source.ageBand === 'string' && source.ageBand in ageBandLabels ? { ageBand: source.ageBand } : {}),
    ...(typeof source.wonBuddhismMembership === 'string' && source.wonBuddhismMembership in membershipLabels && source.religionConsentVersion === religionConsentVersion ? { wonBuddhismMembership: source.wonBuddhismMembership, religionConsentVersion } : {}),
  }
}

export function normalizeMemberProfile(value: MemberProfileInput): MemberProfileInput {
  return {
    bio: value.bio.trim(),
    region: value.region.trim(),
    organization: value.organization.trim(),
    realName: value.realName.trim(),
    email: value.email.trim().toLowerCase(),
    phone: value.phone.trim(),
    ...(value.ageBand ? { ageBand: value.ageBand } : {}),
    ...(value.wonBuddhismMembership && value.religionConsentVersion === religionConsentVersion ? { wonBuddhismMembership: value.wonBuddhismMembership, religionConsentVersion } : {}),
  }
}

export function memberProfileError(value: MemberProfileInput): string | null {
  if (!value.realName.trim()) return '실명을 입력해 주세요.'
  if (!value.organization.trim()) return '소속을 입력하거나 소속 없음을 선택해 주세요.'
  if (value.ageBand && !(value.ageBand in ageBandLabels)) return '연령대를 다시 선택해 주세요.'
  if (value.wonBuddhismMembership && (value.religionConsentVersion !== religionConsentVersion || !(value.wonBuddhismMembership in membershipLabels))) return '입교 여부의 수집 동의를 확인해 주세요.'
  for (const field of Object.keys(memberProfileLimits) as MemberProfileField[]) {
    if (value[field].trim().length > memberProfileLimits[field]) {
      const labels: Record<MemberProfileField, string> = {
        bio: '짧은 소개',
        region: '지역',
        organization: '소속 교당·모임',
        realName: '실명',
        email: '이메일',
        phone: '전화번호',
      }
      return `${labels[field]}은 ${memberProfileLimits[field]}자 이하로 입력해 주세요.`
    }
  }

  const email = value.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return '이메일 주소를 다시 확인해 주세요.'
  }

  const phone = value.phone.trim()
  const phoneDigitCount = phone.replace(/\D/g, '').length
  if (
    phone
    && (
      !/^\+?[0-9][0-9().\-\s]*[0-9]$/.test(phone)
      || phoneDigitCount < 7
      || phoneDigitCount > 15
    )
  ) {
    return '전화번호를 숫자와 하이픈을 사용해 입력해 주세요.'
  }

  return null
}

export function profilePhotoError(file: File): string | null {
  if (file.size <= 0) return '내용이 없는 사진은 올릴 수 없어요.'
  if (file.size > profilePhotoPolicy.maxBytes) return '프로필 사진은 5MB 이하로 올려 주세요.'
  if (!profilePhotoPolicy.contentTypes.includes(file.type as (typeof profilePhotoPolicy.contentTypes)[number])) {
    return '프로필 사진은 JPEG, PNG, WebP 형식만 올릴 수 있어요.'
  }
  return null
}

export function memberProfilePhotoPath(uid: string): string {
  return `profile-photos/${uid}/avatar`
}

export function memberProfilePhotoDirectory(uid: string): string {
  return `profile-photos/${uid}`
}
