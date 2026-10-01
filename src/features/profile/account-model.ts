export type AccountProfile = {
  provider?: 'naver' | 'kakao' | 'google'
  pseudonym?: string
  connected: boolean
  termsAccepted: boolean
  communityRulesAccepted: boolean
  wonBuddhismVerification: 'not_available' | 'unverified' | 'verified'
}

export const profileSections = ['info', 'activity', 'account'] as const

export type ProfileSection = (typeof profileSections)[number]

export function profileSectionFromSearch(search: string): ProfileSection {
  const candidate = new URLSearchParams(search).get('tab')
  return profileSections.includes(candidate as ProfileSection)
    ? candidate as ProfileSection
    : 'info'
}

export function profileSectionUrl(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  section: ProfileSection,
): string {
  const search = new URLSearchParams(location.search)
  if (section === 'info') search.delete('tab')
  else search.set('tab', section)
  const query = search.toString()
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`
}

export function adjacentProfileSection(
  section: ProfileSection,
  key: string,
): ProfileSection | null {
  if (key === 'Home') return profileSections[0]
  if (key === 'End') return profileSections[profileSections.length - 1]
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
  const offset = key === 'ArrowRight' ? 1 : -1
  const index = profileSections.indexOf(section)
  return profileSections[(index + offset + profileSections.length) % profileSections.length]
}

export function requireProfilePhotoOwner(
  currentUid: string | null,
  requestedUid: string,
): void {
  if (currentUid !== requestedUid) {
    throw new Error('Profile photo access is unavailable')
  }
}

export function profileCompletion(profile: AccountProfile): number {
  return [profile.connected, profile.termsAccepted, profile.communityRulesAccepted, Boolean(profile.pseudonym)]
    .filter(Boolean).length / 4
}

export function communityAccessMessage(profile: AccountProfile): string {
  if (!profile.connected) return '네이버 또는 카카오 계정을 연결해 주세요'
  if (!profile.termsAccepted || !profile.communityRulesAccepted) return '이용약관과 커뮤니티 규칙에 동의해 주세요'
  if (!profile.pseudonym) return '위브에서 사용할 별명을 정해 주세요'
  return '글과 댓글을 남기면 이 이름으로 표시돼요'
}
