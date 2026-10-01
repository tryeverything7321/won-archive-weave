export const LAUNCH_AT = Date.parse('2026-10-01T00:00:00+09:00');
export const FEEDBACK_MARKER = '[위브 피드백]';
export const FEEDBACK_PREFIX = `${FEEDBACK_MARKER}\n\n`;
export const FEEDBACK_HREF = '/community?compose=1&feedback=launch';

export function isLaunchMember(createdAt: string | undefined, now: number) {
  const created = Date.parse(createdAt ?? '');
  return Number.isFinite(created) && created >= LAUNCH_AT && created <= now;
}

export function launchNudgeReady(activeSeconds: number, visitedPages: number, interrupted: boolean) {
  return !interrupted && ((activeSeconds >= 60 && visitedPages >= 2) || activeSeconds >= 180);
}

export const feedbackLabels: Record<string, string> = { problem: '불편해요', idea: '이런 기능 원해요', thanks: '좋았어요' };
export function feedbackPrefix(type?: string | null) {
  const label = type && Object.hasOwn(feedbackLabels, type) ? feedbackLabels[type] : '';
  return label ? `${FEEDBACK_MARKER} ${label}\n\n` : FEEDBACK_PREFIX;
}
export function launchFeedbackBody(body: string, enabled: boolean, type?: string | null) {
  return enabled && !body.startsWith(FEEDBACK_MARKER) ? `${feedbackPrefix(type)}${body}` : body;
}
