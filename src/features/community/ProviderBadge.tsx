import type { CommunityLoginProvider } from "./provider";
import { ProviderMark } from "../auth/ProviderLoginButton";
import { WeaveBadge } from "../../components/WeaveBadge";

export function ProviderBadge({ provider }: { provider?: CommunityLoginProvider }) {
  if (!provider) return null;

  const label = provider === "google" ? "구글" : provider === "kakao" ? "카카오" : "네이버";
  return (
    <WeaveBadge
      family="identity"
      tone={provider === "google" ? "neutral" : provider}
      size="compact"
      icon={<ProviderMark provider={provider} />}
      className={`community-provider-badge community-provider-${provider}`}
      title={`${label} 로그인`}
    >
      {label}
    </WeaveBadge>
  );
}
