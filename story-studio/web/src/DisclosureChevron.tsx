type DisclosureChevronProps = {
  expanded?: boolean;
  className?: string;
};

export function DisclosureChevron({ expanded = false, className = "" }: DisclosureChevronProps) {
  const classes = ["disclosure-chevron", expanded ? "is-expanded" : "", className].filter(Boolean).join(" ");
  return (
    <svg
      className={classes}
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="m5.5 7.75 4.5 4.5 4.5-4.5" />
    </svg>
  );
}
