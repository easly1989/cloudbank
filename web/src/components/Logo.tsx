// Logo is the CloudBank brand mark: a cloud (the accent colour, following the
// theme via currentColor) with a euro sign cut out of it. Sized by `size`.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="CloudBank"
      style={{ color: "var(--mantine-primary-color-filled)", display: "block" }}
    >
      <g fill="currentColor">
        <circle cx="10" cy="19" r="6" />
        <circle cx="16" cy="13" r="8" />
        <circle cx="22" cy="19" r="6" />
        <rect x="7" y="18" width="18" height="7" rx="3.5" />
      </g>
      <text
        x="16"
        y="22.5"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
        fill="var(--mantine-color-body)"
      >
        €
      </text>
    </svg>
  );
}
