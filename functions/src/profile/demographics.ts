import { HttpsError } from 'firebase-functions/v2/https'

export const religionConsentVersion = '2026-10-01'
export const ageBands = ['under20', '20s', '30s', '40s', '50plus'] as const
export const membershipStatuses = ['joined', 'not_joined', 'unsure'] as const
export type Demographics = { ageBand?: string; wonBuddhismMembership?: string; religionConsentVersion?: string }

export function normalizeDemographics(source: Record<string, unknown>, strict = false): Demographics {
  const result: Demographics = {}
  if (source.ageBand !== undefined && source.ageBand !== null && source.ageBand !== '') {
    if (ageBands.includes(source.ageBand as typeof ageBands[number])) result.ageBand = String(source.ageBand)
    else if (strict) throw new HttpsError('invalid-argument', '연령대를 다시 선택해 주세요')
  }
  if (source.wonBuddhismMembership !== undefined && source.wonBuddhismMembership !== null && source.wonBuddhismMembership !== '') {
    if (!membershipStatuses.includes(source.wonBuddhismMembership as typeof membershipStatuses[number])) {
      if (strict) throw new HttpsError('invalid-argument', '입교 여부를 다시 선택해 주세요')
    } else if (source.religionConsentVersion !== religionConsentVersion) {
      if (strict) throw new HttpsError('invalid-argument', '입교 여부를 저장하려면 별도 수집 동의가 필요해요')
    } else {
      result.wonBuddhismMembership = String(source.wonBuddhismMembership)
      result.religionConsentVersion = religionConsentVersion
    }
  }
  return result
}

export function summarizeDemographics(profiles: Array<Record<string, unknown> | undefined>) {
  const ageBand: Record<string, number> = Object.fromEntries([...ageBands, 'unanswered'].map(key => [key, 0]))
  const membership: Record<string, number> = Object.fromEntries([...membershipStatuses, 'unanswered'].map(key => [key, 0]))
  for (const profile of profiles) {
    const value = normalizeDemographics(profile ?? {})
    ageBand[value.ageBand ?? 'unanswered']++
    membership[value.wonBuddhismMembership ?? 'unanswered']++
  }
  return { ageBand, membership, populationCount: profiles.length, basis: '현재 직접 입력한 선택 정보 · 미응답 포함' }
}
