export type RecentLoginProvider = 'kakao' | 'naver' | 'google'
const key = 'weave.lastSuccessfulLoginProvider'

export function readRecentLogin(storage: Pick<Storage, 'getItem'> | undefined): RecentLoginProvider | null {
  try {
    const value = storage?.getItem(key)
    return value === 'kakao' || value === 'naver' || value === 'google' ? value : null
  } catch { return null }
}

export function rememberSuccessfulLogin(provider: RecentLoginProvider, storage: Pick<Storage, 'setItem'> | undefined): void {
  try { storage?.setItem(key, provider) } catch { /* Login works even when browser storage is unavailable. */ }
}
