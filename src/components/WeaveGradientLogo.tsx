import "./WeaveGradientLogo.css";

type WeaveGradientLogoProps = {
  className?: string;
  label?: string;
};

export function WeaveGradientLogo({
  className = "",
  label = "위브",
}: WeaveGradientLogoProps) {
  const classes = ["weave-gradient-logo", className].filter(Boolean).join(" ");

  return (
    <span className={classes} role="img" aria-label={label}>
      <span className="weave-gradient-logo__layer weave-gradient-logo__zero" aria-hidden="true" />
      <span className="weave-gradient-logo__layer weave-gradient-logo__tide" aria-hidden="true" />
      <span className="weave-gradient-logo__layer weave-gradient-logo__beam" aria-hidden="true" />
      <span className="weave-gradient-logo__layer weave-gradient-logo__focus" aria-hidden="true" />
    </span>
  );
}
