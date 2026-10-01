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

export function launchFeedbackBody(body: string, enabled: boolean) {
  return enabled && !body.startsWith(FEEDBACK_MARKER) ? `${FEEDBACK_PREFIX}${body}` : body;
}
