import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "../../lib/firebase/client";

export type MemberProvider = "naver" | "kakao" | "google" | "unknown";
export type MembershipCompletion = "complete" | "incomplete" | "unknown";
export type MemberActivityKind = "account" | "post" | "comment" | "submission" | "event";

export type MemberActivityCounts = {
  post: number | null;
  comment: number | null;
  submission: number | null;
  event: number | null;
};

export type AdminMember = {
  memberId: string;
  pseudonym: string | null;
  accountCreatedAt: string | null;
  provider: MemberProvider;
  completion: MembershipCompletion;
  steps: {
    requiredProfile?: boolean | null;
    connected: boolean | null;
    currentTerms: boolean | null;
    currentCommunityRules: boolean | null;
    pseudonymSet: boolean | null;
  };
  lastRecordedActivityAt: string | null;
  activityCounts: MemberActivityCounts;
  activityCountsComplete: boolean;
};

export type MemberListFilters = {
  search?: string;
  createdFrom?: string;
  createdTo?: string;
  provider?: MemberProvider | "all";
  completion?: MembershipCompletion | "all";
  activity?: "any" | "present" | "none";
};

export type MemberSummary = {
  demographics?: { ageBand: Record<string, number>; membership: Record<string, number>; populationCount: number; basis: string } | null;
  populationCount: number;
  createdToday: number;
  completed: number;
  membersWithRecordedActivity: number | null;
  activityCounts: Omit<MemberActivityCounts, never> | null;
  complete: boolean;
  timeZone: "Asia/Seoul";
  period: { from: string | null; to: string | null };
  refreshedAt: string;
  basis: string;
};

export type MemberActivityItem = {
  id: string;
  kind: MemberActivityKind;
  occurredAtMs: number;
  occurredAt: string;
  title: string;
  status: string;
  href: string | null;
};

export type MemberPrivateDetails = {
  ageBand?: string;
  wonBuddhismMembership?: string;
  realName: string | null;
  organization: string | null;
  email: string | null;
  phone: string | null;
  verification: "member_supplied_unverified";
};

function functions() {
  const services = getFirebaseServices();
  if (!services) throw new Error("Firebase is not configured");
  return services.functions;
}

export async function listAdminMembers(input: MemberListFilters & { cursor?: string; limit?: number }) {
  const callable = httpsCallable<typeof input, {
    items: AdminMember[];
    nextCursor: string | null;
    summary: MemberSummary;
  }>(functions(), "listAdminMembers");
  return (await callable(input)).data;
}

export async function getAdminMemberOverview(input: { memberId: string; reason: string }) {
  const callable = httpsCallable<typeof input, { member: AdminMember }>(functions(), "getAdminMemberOverview");
  return (await callable(input)).data;
}

export async function listAdminMemberActivity(input: {
  memberId: string;
  reason: string;
  cursor?: string;
  limit?: number;
}) {
  const callable = httpsCallable<typeof input, {
    items: MemberActivityItem[];
    nextCursor: string | null;
    collectionScope: string;
    notCollected: string[];
  }>(functions(), "listAdminMemberActivity");
  return (await callable(input)).data;
}

export async function getAdminMemberPrivateDetails(input: { memberId: string; reason: string }) {
  const callable = httpsCallable<typeof input, { details: MemberPrivateDetails }>(functions(), "getAdminMemberPrivateDetails");
  return (await callable(input)).data;
}
