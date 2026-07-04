import { Box, Card, Group, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getTrend } from "../../../api/client";
import { formatMinor } from "../../../money";

const pad = (n: number) => String(n).padStart(2, "0");

// SpendingHeatmapCard shows a calendar of the current month with each day tinted
// by how much was spent that day (a GitHub-style heatmap), from the trend
// report's daily buckets. Built with a CSS grid to avoid pulling ECharts'
// calendar/heatmap modules into the bundle.
export function SpendingHeatmapCard({ walletId }: { walletId: number }) {
  const { t, i18n } = useTranslation();
  const now = useMemo(() => new Date(), []);
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const from = `${y}-${pad(m + 1)}-01`;
  const to = `${y}-${pad(m + 1)}-${pad(daysInMonth)}`;

  const q = useQuery({
    queryKey: ["trend", walletId, "day", "none", from, to],
    queryFn: () => getTrend(walletId, "day", "none", { from, to }),
    enabled: walletId > 0,
  });
  const base = q.data?.currency ?? undefined;

  // Spending per day = the magnitude of a net-negative day (income nets it out).
  const spend = useMemo(() => {
    const map: Record<string, number> = {};
    const buckets = q.data?.buckets ?? [];
    const values = q.data?.series?.[0]?.values ?? [];
    buckets.forEach((b, i) => {
      map[b] = Math.max(0, -(values[i] ?? 0));
    });
    return map;
  }, [q.data]);
  const maxSpend = Math.max(0, ...Object.values(spend));
  const total = Object.values(spend).reduce((s, v) => s + v, 0);

  // Weekday header (Mon-first) and lead-in blanks for the 1st of the month.
  const weekdays = useMemo(() => {
    // 2024-01-01 is a Monday; render narrow weekday names in the app's language.
    return Array.from({ length: 7 }, (_, i) =>
      new Date(2024, 0, 1 + i).toLocaleDateString(i18n.language, { weekday: "narrow" }),
    );
  }, [i18n.language]);
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0 … Sun=6
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const monthLabel = new Date(y, m, 1).toLocaleDateString(i18n.language, {
    month: "long",
    year: "numeric",
  });

  return (
    <Card withBorder h="100%">
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Title order={4} tt="capitalize">
          {monthLabel}
        </Title>
        {base && total > 0 && (
          <Text size="sm" fw={700} c="red">
            {formatMinor(total, base)}
          </Text>
        )}
      </Group>
      {total === 0 ? (
        <Text c="dimmed" size="sm">
          {t("dashboard.noSpending")}
        </Text>
      ) : (
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 4,
          }}
        >
          {weekdays.map((w, i) => (
            <Text key={`h-${i}`} size="xs" c="dimmed" ta="center" fw={600}>
              {w}
            </Text>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`b-${i}`} />;
            const date = `${y}-${pad(m + 1)}-${pad(d)}`;
            const s = spend[date] ?? 0;
            const intensity = maxSpend > 0 ? s / maxSpend : 0;
            const bg = s > 0 ? `rgba(240, 62, 62, ${0.12 + intensity * 0.78})` : "transparent";
            return (
              <Box
                key={date}
                title={base ? `${date}: ${formatMinor(s, base)}` : date}
                style={{
                  aspectRatio: "1 / 1",
                  borderRadius: 4,
                  background: bg,
                  border: "1px solid var(--mantine-color-default-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: intensity > 0.55 ? "#fff" : "var(--mantine-color-dimmed)",
                }}
              >
                {d}
              </Box>
            );
          })}
        </Box>
      )}
    </Card>
  );
}
