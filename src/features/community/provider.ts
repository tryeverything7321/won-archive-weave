export type CommunityLoginProvider = "kakao" | "naver" | "google";

export function parseCommunityLoginProvider(value: unknown): CommunityLoginProvider | undefined {
  return value === "kakao" || value === "naver" || value === "google" ? value : undefined;
}
