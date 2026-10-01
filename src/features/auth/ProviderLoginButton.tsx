import googleMark from "../../assets/providers/google-g.png";
import { readRecentLogin } from './recent-login';
import type { ButtonHTMLAttributes } from "react";
import kakaoLoginAsset from "../../assets/providers/kakao-login-ko-large-narrow.png";
import kakaoSymbolAsset from "../../assets/providers/kakao-symbol.svg";
import naverIconAsset from "../../assets/providers/naver-login-green-icon.svg";
import naverLoginAsset from "../../assets/providers/naver-login-ko-green-narrow.svg";
import type { OAuthProvider } from "./api";

type ProviderLoginButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  provider: OAuthProvider;
};

export function ProviderMark({
  provider,
  className = "",
}: {
  provider: OAuthProvider;
  className?: string;
}) {
  const markClassName = `provider-mark provider-mark-${provider} ${className}`.trim();
  return (
    <img
      alt=""
      aria-hidden="true"
      className={markClassName}
      height={18}
      src={provider === "google" ? googleMark : provider === "kakao" ? kakaoSymbolAsset : naverIconAsset}
      width={18}
    />
  );
}

export function ProviderLoginButton({
  provider,
  className = "",
  type = "button",
  ...buttonProps
}: ProviderLoginButtonProps) {
  let recent = false;
  try { recent = readRecentLogin(window.localStorage) === provider; } catch { /* Storage is optional. */ }
  const label = provider === "google" ? "Google로 로그인" : provider === "kakao" ? "카카오 로그인" : "네이버 로그인";
  const asset = provider === "kakao" ? kakaoLoginAsset : naverLoginAsset;

  return (
    <button
      {...buttonProps}
      aria-label={buttonProps["aria-label"] ?? (recent ? `${label} · 이 브라우저에서 최근 로그인` : label)}
      className={`provider-login provider-login-${provider} ${provider === "google" ? "provider-login-google-button" : "provider-login-official"} ${className}`.trim()}
      type={type}
    >
      {provider === "google" ? <><ProviderMark provider="google" /><span>Google로 로그인</span></> : <img
        alt=""
        aria-hidden="true"
        className="provider-login-official-asset"
        src={asset}
      />}
      <span className="sr-only">{label}</span>
      {recent && <span className="provider-recent-login">최근 로그인</span>}
    </button>
  );
}
