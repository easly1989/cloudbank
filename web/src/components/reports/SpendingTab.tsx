import {
  Anchor,
  Drawer,
  Group,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  type ReportGroupBy,
  type ReportTransaction,
  getStatistics,
  getStatisticsDrilldown,
  listAccounts,
} from "../../api/client";
import { categoryColor, useChartColors } from "../../chartPalette";
import { type MoneyFormat, formatMinor } from "../../money";
import { filtersToParams } from "../../pages/registerFilterModel";
import { Figure, Figures } from "./Figures";
import { type ReportContext, csvAmount, periodName, periodPhrase, shortDay } from "./reportContext";
import { type SpendBy, type SpendType, previousPeriod, reportApiParams } from "./reportState";
import classes from "./reports.module.css";

/** Rows shown before the rest are lumped into "Other (n)". */
const SHOWN = 7;
/** Transactions listed in the drill-down before "Show all". */
const DRILL_ROWS = 8;

interface Row {
  key: string;
  label: string;
  /** Magnitude in base minor units: spending and income are both "how much". */
  amount: number;
  /** The same in the period before; undefined when there is no period before. */
  prev?: number;
  color: string;
}

// Spending (#490): how much went out — or came in — over the period, against
// the period before, and where. A ranked list replaces the pie: every name and
// figure can be read, and the tick on each bar says what the period before was
// without a second chart.
export function SpendingTab({ ctx }: { ctx: ReportContext }) {
  const { t, i18n } = useTranslation();
  const colors = useChartColors();
  const { walletId, state, set, period, current, params, fmt, isPhone, setExport } = ctx;
  const { type, by } = state;
  const groupBy: ReportGroupBy = by;

  const query = useQuery({
    queryKey: ["statistics", walletId, groupBy, type, params],
    queryFn: () => getStatistics(walletId, groupBy, { ...params, type }),
    enabled: walletId > 0,
  });
  const prev = previousPeriod(period);
  const prevParams = useMemo(
    () => (prev ? { ...reportApiParams(state.filters, prev), type } : null),
    // prev is derived from period; its bounds are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prev?.from, prev?.to, state.filters, type],
  );
  const prevQuery = useQuery({
    queryKey: ["statistics", walletId, groupBy, type, prevParams],
    queryFn: () => getStatistics(walletId, groupBy, prevParams!),
    enabled: walletId > 0 && !!prevParams,
  });

  const labelOf = (key: string, label: string) =>
    groupBy === "payee" && key === "0" ? t("reports.spending.noPayee") : label;

  const { rows, total } = useMemo(() => {
    const prevBy = new Map<string, number>();
    for (const g of prevQuery.data?.groups ?? []) prevBy.set(g.key, Math.abs(g.amount));
    const out: Row[] = (query.data?.groups ?? []).map((g, i) => ({
      key: g.key,
      label: g.label,
      amount: Math.abs(g.amount),
      prev: prevQuery.data ? (prevBy.get(g.key) ?? 0) : undefined,
      color: categoryColor(colors, i),
    }));
    return { rows: out, total: Math.abs(query.data?.total ?? 0) };
  }, [query.data, prevQuery.data, colors]);
  const prevTotal = prevQuery.data ? Math.abs(prevQuery.data.total) : undefined;

  const [expanded, setExpanded] = useState(false);
  const lumped = rows.length > SHOWN + 1 && !expanded;
  const shown = lumped ? rows.slice(0, SHOWN) : rows;
  const rest = rows.slice(SHOWN);

  // The row whose transactions are open. On a desktop the largest is open to
  // begin with, so the column beside the list is never empty; on a phone the
  // sheet opens only when asked.
  const [picked, setPicked] = useState<string | null>(null);
  const selected =
    picked && rows.some((r) => r.key === picked) ? picked : isPhone ? null : (rows[0]?.key ?? null);
  const selectedRow = rows.find((r) => r.key === selected);

  const prevName = prev ? periodName(prev, t, i18n.language) : "";

  useEffect(() => {
    setExport({
      name: `spending-${period.from?.slice(0, 7) ?? "all"}`,
      rows: () => [
        [
          t(`reports.spending.by.${by}`),
          t("reports.amount"),
          "%",
          ...(prevTotal !== undefined ? [prevName] : []),
        ],
        ...rows.map((r) => [
          labelOf(r.key, r.label),
          csvAmount(r.amount, fmt.fracDigits),
          total ? ((r.amount / total) * 100).toFixed(1) : "0",
          ...(r.prev !== undefined ? [csvAmount(r.prev, fmt.fracDigits)] : []),
        ]),
      ],
    });
    return () => setExport(null);
    // labelOf only reads t and groupBy, both already here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, total, prevTotal, by, fmt, period.from, prevName, setExport, t]);

  const tone = type === "expense" ? colors.out : colors.in;
  const signed = (v: number) => (type === "expense" ? -v : v);

  return (
    <Stack gap="lg">
      <Figures>
        <Figure
          big
          testId="spending-total"
          label={t(`reports.spending.total.${type}${current ? "SoFar" : ""}`, {
            when: periodPhrase(period, t, i18n.language, "in"),
          })}
          value={formatMinor(signed(total), fmt)}
          color={total ? tone : undefined}
          sub={state.filters.transfers === "none" ? t("reports.spending.noTransfers") : undefined}
        />
        {prev && prevTotal !== undefined && (
          <Figure
            testId="spending-compare"
            label={periodPhrase(prev, t, i18n.language, "vs")}
            value={
              total === prevTotal
                ? t("reports.spending.same")
                : t(total > prevTotal ? "reports.spending.more" : "reports.spending.less", {
                    amount: formatMinor(Math.abs(total - prevTotal), fmt),
                  })
            }
            sub={movers(rows, prevQuery.data?.groups ?? [], t, labelOf)}
          />
        )}
      </Figures>

      <div className={classes.controls}>
        <SegmentedControl
          aria-label={t("reports.spending.type")}
          value={type}
          onChange={(v) => set({ type: v as SpendType })}
          data={[
            { value: "expense", label: t("reports.spending.expense") },
            { value: "income", label: t("reports.spending.income") },
          ]}
        />
        <Group gap={10} wrap="nowrap">
          <Text size="sm" c="dimmed">
            {t("reports.spending.byLabel")}
          </Text>
          <SegmentedControl
            aria-label={t("reports.spending.byLabel")}
            value={by}
            onChange={(v) => {
              setPicked(null);
              set({ by: v as SpendBy });
            }}
            data={(["category", "payee", "tag"] as const).map((b) => ({
              value: b,
              label: t(`reports.spending.by.${b}`),
            }))}
          />
        </Group>
      </div>

      {query.data && rows.length === 0 && <Text c="dimmed">{t("reports.empty")}</Text>}

      {rows.length > 0 && (
        <div className={classes.cols}>
          <div>
            <div className={classes.rank} data-testid="spending-list">
              {shown.map((r) => (
                <RankRow
                  key={r.key}
                  row={{ ...r, label: labelOf(r.key, r.label) }}
                  max={Math.max(...rows.map((x) => Math.max(x.amount, x.prev ?? 0)))}
                  total={total}
                  up={type === "expense" ? colors.attention : undefined}
                  pressed={!isPhone && r.key === selected}
                  fmt={fmt}
                  onClick={() => setPicked(r.key)}
                />
              ))}
              {lumped && (
                <RankRow
                  row={{
                    key: "other",
                    label: t("reports.spending.other", { count: rest.length }),
                    amount: rest.reduce((s, r) => s + r.amount, 0),
                    prev: rest.every((r) => r.prev !== undefined)
                      ? rest.reduce((s, r) => s + (r.prev ?? 0), 0)
                      : undefined,
                    color: colors.other,
                  }}
                  max={Math.max(...rows.map((x) => Math.max(x.amount, x.prev ?? 0)))}
                  total={total}
                  up={type === "expense" ? colors.attention : undefined}
                  pressed={false}
                  fmt={fmt}
                  expands
                  onClick={() => setExpanded(true)}
                />
              )}
            </div>
            {expanded && rows.length > SHOWN + 1 && (
              <Anchor component="button" size="sm" mt="xs" onClick={() => setExpanded(false)}>
                {t("reports.spending.showFewer")}
              </Anchor>
            )}
            {prev && (
              <div className={classes.legend}>
                <span className={classes.legendItem}>
                  <span className={classes.tickSwatch} />
                  {t("reports.spending.tickLegend", { period: prevName })}
                </span>
              </div>
            )}
          </div>
          {!isPhone && selectedRow && (
            <Drill
              ctx={ctx}
              row={{ ...selectedRow, label: labelOf(selectedRow.key, selectedRow.label) }}
            />
          )}
        </div>
      )}

      {isPhone && (
        <Drawer
          opened={!!selectedRow}
          onClose={() => setPicked(null)}
          position="bottom"
          size="auto"
          title={selectedRow ? labelOf(selectedRow.key, selectedRow.label) : undefined}
        >
          {selectedRow && (
            <Drill
              ctx={ctx}
              row={{ ...selectedRow, label: labelOf(selectedRow.key, selectedRow.label) }}
              bare
            />
          )}
        </Drawer>
      )}
    </Stack>
  );
}

function RankRow({
  row,
  max,
  total,
  up,
  pressed,
  fmt,
  expands = false,
  onClick,
}: {
  row: Row;
  max: number;
  total: number;
  /** The colour of "more than the period before", when more is worse. */
  up?: string;
  pressed: boolean;
  fmt: MoneyFormat;
  expands?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const pct = total ? Math.round((row.amount / total) * 100) : 0;
  const pctOf = (v: number) => `${max ? (v / max) * 100 : 0}%`;
  let change: ReactNode = null;
  if (row.prev !== undefined) {
    const d = row.amount - row.prev;
    if (row.prev === 0) change = t("reports.spending.new");
    else if (d === 0) change = t("reports.spending.sameShort");
    else
      change = (
        <span style={{ color: d > 0 ? up : undefined }}>
          {`${d > 0 ? "+" : "−"}${formatMinor(Math.abs(d), fmt)}`}
        </span>
      );
  }
  return (
    <UnstyledButton
      className={classes.row}
      aria-pressed={expands ? undefined : pressed}
      aria-expanded={expands ? false : undefined}
      onClick={onClick}
      data-testid="spending-row"
    >
      <span className={classes.rowName}>
        <span className={classes.dot} style={{ background: row.color }} />
        <span>{row.label}</span>
      </span>
      <span className={classes.rowAmount}>{formatMinor(row.amount, fmt)}</span>
      <span className={classes.track}>
        <span
          className={classes.trackFill}
          style={{ width: pctOf(row.amount), background: row.color }}
        />
        {row.prev !== undefined && row.prev > 0 && (
          <span className={classes.tick} style={{ left: pctOf(row.prev) }} />
        )}
      </span>
      <span className={classes.rowMeta}>
        {pct}%{change !== null && <> · {change}</>}
      </span>
    </UnstyledButton>
  );
}

/** The two biggest movers, in words: "less on leisure, more on food". */
function movers(
  rows: Row[],
  prevGroups: { key: string; label: string; amount: number }[],
  t: (k: string, o?: Record<string, unknown>) => string,
  labelOf: (key: string, label: string) => string,
): string | undefined {
  const now = new Map(rows.map((r) => [r.key, r]));
  const deltas = new Map<string, { label: string; d: number }>();
  for (const r of rows)
    deltas.set(r.key, { label: labelOf(r.key, r.label), d: r.amount - (r.prev ?? 0) });
  for (const g of prevGroups)
    if (!now.has(g.key))
      deltas.set(g.key, { label: labelOf(g.key, g.label), d: -Math.abs(g.amount) });
  let up: { label: string; d: number } | undefined;
  let down: { label: string; d: number } | undefined;
  for (const x of deltas.values()) {
    if (x.d > 0 && (!up || x.d > up.d)) up = x;
    if (x.d < 0 && (!down || x.d < down.d)) down = x;
  }
  if (up && down) return t("reports.spending.movers", { less: down.label, more: up.label });
  if (up) return t("reports.spending.moreOn", { name: up.label });
  if (down) return t("reports.spending.lessOn", { name: down.label });
  return undefined;
}

// A row's transactions, newest first, and the way to the register for the rest.
function Drill({ ctx, row, bare = false }: { ctx: ReportContext; row: Row; bare?: boolean }) {
  const { t, i18n } = useTranslation();
  const { walletId, state, period, params, fmt } = ctx;
  const { type, by } = state;
  const query = useQuery({
    queryKey: ["drilldown", walletId, by, row.key, type, params],
    queryFn: () => getStatisticsDrilldown(walletId, by, row.key, { ...params, type }),
    enabled: walletId > 0,
  });
  const accounts = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const txns: ReportTransaction[] = query.data ?? [];

  // Where the register can show the same rows: one account at a time, so one
  // link per account the transactions are in.
  const perAccount = new Map<number, number>();
  for (const x of txns) perAccount.set(x.accountId, (perAccount.get(x.accountId) ?? 0) + 1);
  const registerLink = (accountId: number) => {
    const f = {
      ...state.filters,
      preset: period.from ? ("custom" as const) : ("all" as const),
      from: period.from ?? "",
      to: period.to ?? "",
      // The register's amounts are signed: this keeps the one side the report shows.
      amountMax: type === "expense" ? -1 : state.filters.amountMax,
      amountMin: type === "income" ? 1 : state.filters.amountMin,
      categoryId: by === "category" ? Number(row.key) : state.filters.categoryId,
      payeeId: by === "payee" ? Number(row.key) : state.filters.payeeId,
      tags: by === "tag" ? [row.label] : state.filters.tags,
    };
    const q = new URLSearchParams({ account: String(accountId), ...filtersToParams(f) });
    return `/transactions?${q.toString()}`;
  };
  // A payee-less row has no register filter to match it.
  const linkable = !(by === "payee" && row.key === "0");
  const accountName = (id: number) => accounts.data?.find((a) => a.id === id)?.name ?? "";

  const body = (
    <>
      {!bare && (
        <Text fw={600} mb={4}>
          {row.label}{" "}
          <Text span c="dimmed" size="sm" fw={400}>
            · {t("reports.spending.count", { count: txns.length })}
          </Text>
        </Text>
      )}
      {bare && (
        <Text c="dimmed" size="sm" mb={4}>
          {t("reports.spending.count", { count: txns.length })}
        </Text>
      )}
      <div data-testid="spending-drill">
        {txns.slice(0, DRILL_ROWS).map((x) => (
          <div key={x.id} className={classes.drillRow}>
            <span className={classes.mono} style={{ color: "var(--mantine-color-dimmed)" }}>
              {shortDay(x.date, i18n.language)}
            </span>
            <span>{x.payeeName || x.memo || x.categoryName}</span>
            <span className={classes.mono}>{formatMinor(x.amount, fmt)}</span>
          </div>
        ))}
      </div>
      {linkable && perAccount.size === 1 && (
        <Anchor
          component={Link}
          to={registerLink([...perAccount.keys()][0])}
          size="sm"
          fw={600}
          mt="xs"
          display="inline-block"
        >
          {t("reports.spending.showAll", { count: txns.length })}
        </Anchor>
      )}
      {linkable && perAccount.size > 1 && (
        <Group gap={6} mt="xs" wrap="wrap">
          <Text size="sm">{t("reports.spending.showIn")}</Text>
          {[...perAccount.entries()].map(([id, n]) => (
            <Anchor key={id} component={Link} to={registerLink(id)} size="sm" fw={600}>
              {accountName(id)} ({n})
            </Anchor>
          ))}
        </Group>
      )}
    </>
  );
  return bare ? body : <div className={classes.drill}>{body}</div>;
}
