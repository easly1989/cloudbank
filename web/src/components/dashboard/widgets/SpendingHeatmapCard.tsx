import { ActionIcon, Box, Card, Group, Stack, Text, Title, Tooltip } from "@mantine/core";
import { IconCalendarDot, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTrend } from "../../../api/client";
import { useDateFormat } from "../../../dates";
import { formatMinor } from "../../../money";
import { useToday } from "../../../useToday";

const pad = (n: number) => String(n).padStart(2, "0");
// How many top spending categories to name in a day's tooltip.
const TOP_CATS = 3;

// SpendingHeatmapCard shows a calendar of a month with each day tinted by how
// much was spent that day (a GitHub-style heatmap), from the trend report's
// daily buckets. Built with a CSS grid to avoid pulling ECharts' calendar/heatmap
// modules into the bundle. The month is navigable (prev/next, back-to-current),
// and hovering a day reveals its total plus its top spending categories.
export function SpendingHeatmapCard({ walletId }: { walletId: number }) {
  const { t, i18n } = useTranslation();
  const fmtDate = useDateFormat();
  // `today` makes the "current month" anchor reactive: a dashboard left open past
  // a month boundary rolls over without a manual reload.
  const today = useToday();
  const [offset, setOffset] = useState(0); // months relative to the current one

  const anchor = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + offset, 1);
  }, [today, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  const y = anchor.getFullYear();
  const m = anchor.getMonth(); // 0-based
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const from = `${y}-${pad(m + 1)}-01`;
  const to = `${y}-${pad(m + 1)}-${pad(daysInMonth)}`;

  const q = useQuery({
    queryKey: ["trend", walletId, "day", "none", from, to],
    queryFn: () => getTrend(walletId, "day", "none", { from, to }),
    enabled: walletId > 0,
  });
  // Per-category daily buckets power the hover tooltip's category breakdown.
  const qCat = useQuery({
    queryKey: ["trend", walletId, "day", "category", from, to],
    queryFn: () => getTrend(walletId, "day", "category", { from, to }),
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

  // Top spending categories per day (descending), for the tooltip.
  const dayCats = useMemo(() => {
    const map: Record<string, { label: string; amount: number }[]> = {};
    const buckets = qCat.data?.buckets ?? [];
    const series = qCat.data?.series ?? [];
    buckets.forEach((b, i) => {
      const items: { label: string; amount: number }[] = [];
      for (const s of series) {
        const amount = Math.max(0, -(s.values[i] ?? 0));
        if (amount > 0) items.push({ label: s.label, amount });
      }
      items.sort((a, b2) => b2.amount - a.amount);
      map[b] = items;
    });
    return map;
  }, [qCat.data]);

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

  const monthLabel = anchor.toLocaleDateString(i18n.language, {
    month: "long",
    year: "numeric",
  });

  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Group gap={2} wrap="nowrap" style={{ minWidth: 0 }}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={() => setOffset((o) => o - 1)}
            aria-label={t("dashboard.prevMonth")}
          >
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Title order={4} tt="capitalize" style={{ whiteSpace: "nowrap" }}>
            {monthLabel}
          </Title>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            aria-label={t("dashboard.nextMonth")}
          >
            <IconChevronRight size={16} />
          </ActionIcon>
          {offset !== 0 && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => setOffset(0)}
              aria-label={t("dashboard.currentMonth")}
            >
              <IconCalendarDot size={15} />
            </ActionIcon>
          )}
        </Group>
        {base && total > 0 && (
          <Text size="sm" fw={700} c="red" style={{ whiteSpace: "nowrap" }}>
            {formatMinor(total, base)}
          </Text>
        )}
      </Group>
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
          const cats = dayCats[date] ?? [];
          const cell = (
            <Box
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
          // No tooltip on days with nothing spent — nothing useful to show.
          if (s === 0 || !base) return <Box key={date}>{cell}</Box>;
          return (
            <Tooltip
              key={date}
              withArrow
              multiline
              label={
                <Stack gap={2}>
                  <Text size="xs" fw={700}>
                    {fmtDate(date)} · {formatMinor(s, base)}
                  </Text>
                  {cats.slice(0, TOP_CATS).map((c) => (
                    <Group key={c.label} justify="space-between" gap="md" wrap="nowrap">
                      <Text size="xs" truncate>
                        {c.label}
                      </Text>
                      <Text size="xs" style={{ whiteSpace: "nowrap" }}>
                        {formatMinor(c.amount, base)}
                      </Text>
                    </Group>
                  ))}
                  {cats.length > TOP_CATS && (
                    <Text size="xs" c="dimmed">
                      {t("dashboard.moreCategories", { count: cats.length - TOP_CATS })}
                    </Text>
                  )}
                </Stack>
              }
            >
              {cell}
            </Tooltip>
          );
        })}
      </Box>
      {total === 0 && (
        <Text c="dimmed" size="sm" mt="xs">
          {t("dashboard.noSpending")}
        </Text>
      )}
    </Card>
  );
}
