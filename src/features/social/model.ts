export type SocialConnectionView = {
  accountName: string
  status: 'active' | 'expired' | 'private' | 'rate_limited' | 'disconnected'
  lastSyncedAt?: Date
  nextSyncAt?: Date
}

export function socialConnectionMessage(connection: SocialConnectionView): string {
  switch (connection.status) {
    case 'active': return `Instagram @${connection.accountName}의 기록을 가져오고 있어요`
    case 'expired': return 'Instagram 연결이 만료되어 다시 연결해야 해요'
    case 'private': return '원본 계정이 비공개로 바뀌어 연결한 기록을 숨겼어요'
    case 'rate_limited': return 'Instagram 요청 한도에 도달해 다음 동기화를 기다리고 있어요'
    case 'disconnected': return 'Instagram 연결을 해제했어요. 앞으로 동기화하지 않아요'
  }
}
