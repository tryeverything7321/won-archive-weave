type WeaveSymbolProps = {
  className?: string;
  decorative?: boolean;
  label?: string;
};

export function WeaveSymbol({
  className = "",
  decorative = false,
  label = "위브 Signature W",
}: WeaveSymbolProps) {
  const classes = ["weave-symbol", className].filter(Boolean).join(" ");

  if (decorative) {
    return <span aria-hidden="true" className={classes} />;
  }

  return <span aria-label={label} className={classes} role="img" />;
}
