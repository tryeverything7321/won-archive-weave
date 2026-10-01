import { useId } from "react";

export function InstagramGlyph({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const gradientId = useId().replaceAll(":", "");

  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <defs>
        <linearGradient id={gradientId} x1="2" x2="22" y1="22" y2="2">
          <stop offset="0" stopColor="#feda75" />
          <stop offset="0.28" stopColor="#fa7e1e" />
          <stop offset="0.5" stopColor="#d62976" />
          <stop offset="0.76" stopColor="#962fbf" />
          <stop offset="1" stopColor="#4f5bd5" />
        </linearGradient>
      </defs>
      <rect
        fill="none"
        height="18"
        rx="5"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.2"
        width="18"
        x="3"
        y="3"
      />
      <circle
        cx="12"
        cy="12"
        fill="none"
        r="4.1"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.2"
      />
      <circle cx="17.45" cy="6.55" fill={`url(#${gradientId})`} r="1.25" />
    </svg>
  );
}
