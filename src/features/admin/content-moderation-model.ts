export type ContentAction = 'warn' | 'request_correction' | 'hold' | 'remove' | 'restore';
export function moderationCommand(kind: 'submission' | 'event', id: string, action: ContentAction, reason: string, requestId: string) {
  const explanation = reason.trim();
  if (explanation.length < 2 || explanation.length > 300) throw new Error('사유를 2~300자로 적어 주세요.');
  return {
    callable: kind === 'submission' ? 'moderateSubmissionContent' : 'moderateManualEventContent',
    data: { [kind === 'submission' ? 'submissionId' : 'eventId']: id, action, reason: explanation, requestId },
  };
}
