import { Anchor, Button, Card, Group, Select, Stack, Table, Text } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  AI_SENDS_KEY,
  AI_SETTINGS_KEY,
  aiReportsKey,
  aiReportsOn,
  generateAIReport,
  getAISettings,
  listAIReports,
  setAIReportFeedback,
  type AIReport,
  type AIReportFigures,
} from "../api/ai";
import { AiBox, type Feedback } from "../components/AiBox";
import { useAskPastLimit } from "../components/aiLimit";
import { PageHeader } from "../components/PageHeader";
import { asTitle } from "../dates";
import { formatMinor } from "../money";
import { notifyError } from "../notifyError";
import { sensitive } from "../privacy";
import { useWallet } from "../wallet/WalletProvider";
import { paragraphs, splitAmounts } from "./insightsText";

// AI insights (#696): the monthly reports the reader's own AI wrote on the
// wallet's numbers. The latest is shown in full in the AI box, the older ones
// listed under it. Each report is its asker's alone, even in a shared wallet.

/** The last twelve complete months, newest first, as YYYY-MM: in UTC, as the server counts. */
function completeMonths(): string[] {
  const n = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** "September 2026", or with year false "September", in the app's language. */
function monthName(period: string, lang: string, year = true): string {
  const [y, m] = period.split("-").map(Number);
  return asTitle(
    new Intl.DateTimeFormat(lang, {
      month: "long",
      year: year ? "numeric" : undefined,
      timeZone: "UTC",
    }).format(Date.UTC(y, m - 1, 1)),
    lang,
  );
}

const madeOn = (iso: string, lang: string) =>
  new Intl.DateTimeFormat(lang, { day: "numeric", month: "long" }).format(new Date(iso));

/** A paragraph with its amounts in the money face, and hidden in privacy mode. */
function withAmounts(text: string): ReactNode[] {
  return splitAmounts(text).map((part, i) =>
    i % 2 ? (
      <Text
        key={i}
        span
        ff="monospace"
        fz="inherit"
        style={{ whiteSpace: "nowrap" }}
        {...sensitive}
      >
        {part}
      </Text>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** The numbers CloudBank computed and gave the model: "Why?". */
function Why({ report }: { report: AIReport }) {
  const { t, i18n } = useTranslation();
  const b = report.basis;
  const fmt = (n: number) => formatMinor(n, b.currency);
  const prevMonth = (() => {
    const [y, m] = b.month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const short = (p: string) => monthName(p, i18n.language, false);
  const line = (k: keyof AIReportFigures) => [
    t(`insights.why.${k}`),
    b.figures[k],
    b.prev[k],
    b.avg[k],
  ];
  const rows: [string, number, number, number][] = [
    line("income"),
    line("expense"),
    line("net"),
    ...b.categories.map((c) => [c.name, c.amount, c.prev, c.avg]),
  ] as [string, number, number, number][];
  return (
    <Stack gap={6}>
      <Table.ScrollContainer minWidth={360}>
        <Table fz="xs" withRowBorders={false} verticalSpacing={2}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th ta="right">{short(b.month)}</Table.Th>
              <Table.Th ta="right">{short(prevMonth)}</Table.Th>
              <Table.Th ta="right">{t("insights.why.avg")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(([k, ...v], i) => (
              <Table.Tr key={i}>
                <Table.Td c="dimmed">{k}</Table.Td>
                {v.map((x, j) => (
                  <Table.Td key={j} ta="right" ff="monospace" {...sensitive}>
                    {fmt(x)}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text fz="xs" c="dimmed">
        {t("insights.why.note", { model: report.model })}
      </Text>
    </Stack>
  );
}

export function InsightsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const askPastLimit = useAskPastLimit();
  const months = completeMonths();
  const [period, setPeriod] = useState(months[0]);
  const [picked, setPicked] = useState<number | null>(null);

  const settings = useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: getAISettings });
  const on = aiReportsOn(settings.data) && !settings.data?.walletsOff.includes(walletId);
  const reports = useQuery({
    queryKey: aiReportsKey(walletId),
    queryFn: () => listAIReports(walletId),
    enabled: on && walletId > 0,
  });

  const generate = useMutation({
    mutationFn: () => askPastLimit((confirm) => generateAIReport(walletId, period, confirm)),
    onSuccess: (r) => {
      if (!r) return; // the user kept to this month's limit
      setPicked(r.id);
      void qc.invalidateQueries({ queryKey: aiReportsKey(walletId) });
      void qc.invalidateQueries({ queryKey: AI_SENDS_KEY });
    },
    onError: notifyError,
  });

  const feedback = useMutation({
    mutationFn: ({ id, value }: { id: number; value: Feedback }) =>
      setAIReportFeedback(walletId, id, value),
    onMutate: ({ id, value }) =>
      qc.setQueryData<{ reports: AIReport[] }>(aiReportsKey(walletId), (cur) =>
        cur
          ? { reports: cur.reports.map((r) => (r.id === id ? { ...r, feedback: value } : r)) }
          : cur,
      ),
    onError: (err) => {
      notifyError(err);
      void qc.invalidateQueries({ queryKey: aiReportsKey(walletId) });
    },
  });

  const header = (
    <PageHeader
      title={t("insights.title")}
      hint={t("insights.hint")}
      actions={
        on && (
          <>
            <Select
              aria-label={t("insights.month")}
              data={months.map((m) => ({ value: m, label: monthName(m, i18n.language) }))}
              value={period}
              onChange={(v) => v && setPeriod(v)}
              allowDeselect={false}
              w={170}
            />
            <Button
              leftSection={<IconSparkles size={16} />}
              loading={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {t("insights.generate")}
            </Button>
          </>
        )
      }
    />
  );

  if (settings.isPending) return header;
  if (!on) {
    const walletOff = aiReportsOn(settings.data);
    return (
      <Stack gap="lg">
        {header}
        <Card withBorder maw={560}>
          <Stack gap="xs">
            <Text fw={600}>{walletOff ? t("insights.walletOff") : t("insights.off")}</Text>
            <Text fz="sm" c="dimmed">
              {walletOff ? t("insights.walletOffHint") : t("insights.offHint")}
            </Text>
            <Anchor component={Link} to="/settings/ai" fz="sm">
              {t("insights.toSettings")}
            </Anchor>
          </Stack>
        </Card>
      </Stack>
    );
  }

  const list = reports.data?.reports ?? [];
  const shown = list.find((r) => r.id === picked) ?? list[0];
  const others = list.filter((r) => r !== shown);

  return (
    <Stack gap="lg">
      {header}
      <Stack gap="lg" maw={760}>
        {reports.isSuccess && !shown && (
          <Card withBorder>
            <Text fz="sm" c="dimmed">
              {t("insights.none")}
            </Text>
          </Card>
        )}
        {shown && (
          <AiBox
            key={shown.id}
            label={t("insights.label")}
            basis={t("insights.basis", {
              month: monthName(shown.period, i18n.language),
              date: madeOn(shown.createdAt, i18n.language),
            })}
            title={t("insights.reportTitle", {
              month: monthName(shown.period, i18n.language, false),
            })}
            why={<Why report={shown} />}
            feedback={shown.feedback}
            onFeedback={(value) => feedback.mutate({ id: shown.id, value })}
          >
            {paragraphs(shown.body).map((p, i) => (
              <p key={i}>{withAmounts(p)}</p>
            ))}
          </AiBox>
        )}
        {others.length > 0 && (
          <Stack gap="xs">
            <Text fw={650} fz="sm">
              {t("insights.earlier")}
            </Text>
            <Card withBorder p={0}>
              {others.map((r, i) => (
                <Group
                  key={r.id}
                  justify="space-between"
                  wrap="nowrap"
                  p="md"
                  style={i > 0 ? { borderTop: "1px solid var(--cb-ledger-border)" } : undefined}
                >
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text fz="sm" fw={600}>
                      {monthName(r.period, i18n.language)}
                    </Text>
                    <Text fz="sm" c="dimmed" truncate {...sensitive}>
                      {paragraphs(r.body)[0] ?? ""}
                    </Text>
                  </Stack>
                  <Anchor
                    fz="sm"
                    component="button"
                    type="button"
                    aria-label={t("insights.readMonth", {
                      month: monthName(r.period, i18n.language),
                    })}
                    onClick={() => {
                      setPicked(r.id);
                      window.scrollTo({ top: 0 });
                    }}
                  >
                    {t("insights.read")}
                  </Anchor>
                </Group>
              ))}
            </Card>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
