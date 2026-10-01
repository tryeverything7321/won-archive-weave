import type { ContributionKind } from './contribution-entry';

export function contributionActivity<T extends { summary: string }>(kind: ContributionKind, title: string, details: T): T | undefined {
  return kind === '자료' ? undefined : { ...details, summary: details.summary.trim() || title.trim() };
}
