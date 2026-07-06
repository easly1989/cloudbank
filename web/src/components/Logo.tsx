import { useId } from "react";

// Logo is the CloudBank brand mark: a blue gradient cloud with a green-euro
// coin. The mark has fixed brand colours (it no longer follows the theme
// accent — intended for a logo). The same artwork ships as web/public/logo.svg
// (favicon) and docs/img/logo.svg (README). useId keeps the gradient ids unique
// per instance so multiple logos on a page can't clash.
export function Logo({ size = 28 }: { size?: number }) {
  const id = useId();
  const cloud = `${id}-cloud`;
  const coin = `${id}-coin`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="CloudBank"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={cloud} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ecbfd" />
          <stop offset=".55" stopColor="#5aa9f4" />
          <stop offset="1" stopColor="#3d86e0" />
        </linearGradient>
        <radialGradient id={coin} cx=".38" cy=".32" r=".85">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e7eef4" />
        </radialGradient>
      </defs>
      <ellipse cx="30" cy="55.5" rx="20" ry="3.2" fill="#000" opacity=".07" />
      <path
        transform="translate(9 7) scale(1.92)"
        fill={`url(#${cloud})`}
        d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"
      />
      <circle
        cx="23"
        cy="45.5"
        r="13.2"
        fill={`url(#${coin})`}
        stroke="#3aa64a"
        strokeWidth="2.4"
      />
      <g stroke="#3aa64a" strokeLinecap="round" fill="none">
        <path d="M28 40a7 7 0 1 0 0 11" strokeWidth="2.7" />
        <path d="M16.9 43.9h10.4M16.9 47.1h10.4" strokeWidth="2.3" />
      </g>
    </svg>
  );
}
