import { Anchor, Card, Group, Text, Title } from "@mantine/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { type CurrencyInfo, listGoalContributions, listGoals } from "../../../api/client";
import { formatMinor } from "../../../money";
import { viewOf } from "../../../pages/goals/goalList";
import { useToday } from "../../../useToday";
import { baseFmt } from "../../reports/reportUtils";

/**
 * The goals at a glance (#572), built like the budget widget: what is set
 * aside, this month's share, and a row per goal under way, amber when its
 * pace falls short. Only on the dashboards that add it.
 */
export function GoalsWidget({ walletId, base }: { walletId: number; base?: CurrencyInfo }) {
  const { t } = useTranslation();
  const today = useToday();
  const fmt = baseFmt(base);
  const money = (minor: number) => formatMinor(minor, fmt);

  const goals = useQuery({
    queryKey: ["goals", walletId],
    queryFn: () => listGoals(walletId),
    enabled: walletId > 0,
  });
  const live = (goals.data ?? []).filter((g) => g.closedOn == null);
  const moves = useQueries({
    queries: live.map((g) => ({
      queryKey: ["goalContributions", walletId, g.id],
      queryFn: () => listGoalContributions(walletId, g.id),
      enabled: walletId > 0,
    })),
  });
  const view = viewOf(
    goals.data ?? [],
    new Map(live.map((g, i) => [g.id, moves[i]?.data ?? []])),
    today,
    fmt.fracDigits,
  );

  return (
    <Card withBorder data-testid="goals-widget">
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t("dashboard.goals")}</Title>
        <Anchor component={Link} to="/goals" size="sm">
          {t("dashboard.goalsOpen")}
        </Anchor>
      </Group>
      {view.open.length === 0 ? (
        <Text c="dimmed">{t("dashboard.goalsNone")}</Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Group justify="space-between" gap="xs" fz="sm" wrap="nowrap">
            <span>
              <Text span ff="monospace" fz="sm">
                {money(view.saved)}
              </Text>{" "}
              <Text span c="dimmed" fz="sm">
                {t("dashboard.goalsSetAside", { count: view.count })}
              </Text>
            </span>
            {view.need > 0 && (
              <Text span c="dimmed" fz="sm">
                {t("dashboard.goalsThisMonth", { amount: money(view.need) })}
              </Text>
            )}
          </Group>
          {view.open.slice(0, 4).map((l) => {
            const w = Math.min(100, (Math.max(l.saved, 0) / l.targetAmount) * 100);
            return (
              <div
                key={l.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(60px, 110px) auto",
                  alignItems: "center",
                  gap: 14,
                  fontSize: 13.5,
                }}
              >
                <Text fz="sm" truncate>
                  {l.name}
                </Text>
                <span
                  style={{
                    position: "relative",
                    height: 6,
                    borderRadius: 99,
                    background: "color-mix(in srgb, var(--mantine-color-text) 10%, transparent)",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: `${w}%`,
                      borderRadius: 99,
                      background: l.late
                        ? "var(--cb-attention)"
                        : "var(--mantine-primary-color-filled)",
                    }}
                  />
                </span>
                <Text
                  fz="sm"
                  ta="right"
                  style={{ whiteSpace: "nowrap" }}
                  c={l.late ? "var(--cb-attention)" : "dimmed"}
                >
                  {l.need != null
                    ? t("goals.aMonth", { amount: money(l.need) })
                    : `${money(l.saved)} ${t("goals.ofTarget", { amount: money(l.targetAmount) })}`}
                </Text>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
