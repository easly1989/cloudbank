// A small dependency-free SVG donut. Rich charts (ECharts) arrive with the
// reports milestone; the dashboard only needs a simple breakdown.
export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  data,
  size = 180,
  thickness = 26,
}: {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total > 0 ? (
          data.map((d, i) => {
            const frac = d.value / total;
            const dash = frac * c;
            const circle = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return circle;
          })
        ) : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--mantine-color-default-border)"
            strokeWidth={thickness}
          />
        )}
      </g>
    </svg>
  );
}
