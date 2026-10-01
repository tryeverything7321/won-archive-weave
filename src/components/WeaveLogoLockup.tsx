type WeaveLogoLockupProps = {
  className?: string;
  label?: string;
  variant?: "full" | "compact" | "micro" | "reverse" | "mono";
};

const sources = {
  full: "/brand/ot01-open-crest-primary.svg",
  compact: "/brand/ot01-open-crest-primary.svg",
  micro: "/brand/ot01-open-crest-primary.svg",
  reverse: "/brand/ot01-open-crest-reverse.svg",
  mono: "/brand/ot01-open-crest-mono.svg",
} as const;

export function WeaveLogoLockup({
  className = "",
  label = "위브",
  variant = "full",
}: WeaveLogoLockupProps) {
  return (
    <span
      className={["weave-logo-lockup", className].filter(Boolean).join(" ")}
    >
      <img src={sources[variant]} alt={label} />
    </span>
  );
}
