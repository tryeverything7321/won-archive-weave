export function eventMediaNotice(event: {
  status: string;
  contentPublished?: boolean;
  reviewReason?: string;
}): string | null {
  if (!event.reviewReason || ['unpublished', 'canceled', 'published', 'updated'].includes(event.status)) return null;
  const prefix = event.contentPublished ? '행사 내용은 공개 중입니다. ' : '';
  if (event.reviewReason === 'media_scan_blocked') {
    return prefix + '사진이 보안 검사를 통과하지 못해 공개되지 않았어요. 수정 화면에서 해당 사진을 제거하거나 다른 사진으로 바꿔 주세요.';
  }
  if (event.reviewReason === 'automatic_media_scan_failed') {
    return prefix + '사진 검사를 완료하지 못했어요. 잠시 뒤 새로고침으로 상태를 확인해 주세요.';
  }
  if (event.reviewReason === 'automatic_publication_failed') {
    return prefix + '사진 공개를 완료하지 못했어요. 잠시 뒤 새로고침으로 상태를 확인해 주세요.';
  }
  if (event.reviewReason === 'media_scan_pending') {
    return prefix + '사진을 검사하고 있어요. 보안 검사를 통과하면 사진이 추가됩니다.';
  }
  return prefix + '사진 처리 상태를 확인하고 있어요.';
}

export function eventMediaItemNotice(event: { status?: string; reviewReason?: string }): string {
  if (event.reviewReason === 'media_scan_blocked') return '안전 검사 차단';
  if (event.reviewReason === 'automatic_media_scan_failed') return '검사 일시 실패';
  if (event.reviewReason === 'automatic_publication_failed') return '공개 준비 실패';
  if (event.status === 'review_queued' || event.reviewReason === 'media_scan_pending') return '검사 중';
  if (event.status === 'published' || event.status === 'updated') return '공개됨';
  return '저장됨';
}
