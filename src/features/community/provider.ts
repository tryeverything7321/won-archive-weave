export type CommunityLoginProvider = "kakao" | "naver";

export function parseCommunityLoginProvider(value: unknown): CommunityLoginProvider | undefined {
  return value === "kakao" || value === "naver" ? value : undefined;
}
