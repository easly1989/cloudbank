import {
  ActionIcon,
  Anchor,
  Box,
  Group,
  Stack,
  Table,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconArrowUp, IconSparkles } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { AI_SENDS_KEY, askAI, type AIAskAnswer, type AIAskUsed } from "../api/ai";
import { AiBox } from "../components/AiBox";
import { useAskPastLimit } from "../components/aiLimit";
import { formatMinor } from "../money";
import { notifyError } from "../notifyError";
import { sensitive } from "../privacy";
import { useWallet } from "../wallet/WalletProvider";
import { withAmounts } from "./withAmounts";

// Ask your data (#704): a question in the reader's words; the AI picks among
// CloudBank's own read-only queries, CloudBank runs them, the AI answers from
// their results. The answer comes with the numbers it used. Nothing is kept:
// the earlier questions last as long as the page.

const QUESTION_MAX = 300;
const EXAMPLES = ["example1", "example2", "example3"] as const;

interface Asked {
  question: string;
  answer: AIAskAnswer;
  at: Date;
}

const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/** The filters of a query by name: "Food:Restaurants · expenses". */
function filtersOf(u: AIAskUsed, t: TFunction): string {
  const parts = [u.category, u.payee, u.account, u.tag && `#${u.tag}`].filter(Boolean) as string[];
  if (u.type) parts.push(t(`insights.ask.type.${u.type}`));
  return parts.join(" · ") || "—";
}

function periodOf(u: AIAskUsed, lang: string): string {
  const f = new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  if (u.date) return f.format(utc(u.date));
  return u.from && u.to ? f.formatRange(utc(u.from), utc(u.to)) : "";
}

/** What a query returned, one line per month, category, expense or account. */
function resultLines(u: AIAskUsed, cur: AIAskAnswer["currency"], lang: string, t: TFunction) {
  // Expenses read as money spent, as the answer says them.
  const spent = u.type === "expense" || u.tool === "largest";
  const fmt = (n: number) => formatMinor(spent ? Math.abs(n) : n, cur);
  if (u.tool === "total")
    return [`${fmt(u.total)} · ${t("insights.ask.count", { count: u.count })}`];
  const month = new Intl.DateTimeFormat(lang, { month: "short", year: "numeric", timeZone: "UTC" });
  const day = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" });
  if (u.items.length === 0) return ["—"];
  return u.items.map((it) => {
    let label = it.label || t("insights.ask.noPayee");
    if (u.tool === "by_month") label = month.format(utc(`${it.label}-01`));
    if (it.date) label = `${day.format(utc(it.date))} · ${label}`;
    return `${label} ${fmt(it.amount)}`;
  });
}

function NumbersUsed({ answer }: { answer: AIAskAnswer }) {
  const { t, i18n } = useTranslation();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const rows = answer.used.map((u) => ({
    tool: t(`insights.ask.tool.${u.tool}`),
    filters: filtersOf(u, t),
    period: periodOf(u, i18n.language),
    result: resultLines(u, answer.currency, i18n.language, t),
  }));
  const lines = (r: string[]) =>
    r.map((l, i) => (
      <div key={i} {...sensitive}>
        {l}
      </div>
    ));
  return (
    <Box p={10} style={{ background: "var(--mantine-color-default-hover)", borderRadius: 8 }}>
      <Text fz={12} fw={600} c="dimmed" mb={4}>
        {t("insights.ask.used")}
      </Text>
      {phone ? (
        <Stack gap={8}>
          {rows.map((r, i) => (
            <Box key={i}>
              <Text fz={13} fw={500}>
                {r.tool} · {r.filters}
              </Text>
              <Text fz={12.5} c="dimmed">
                {r.period}
              </Text>
              <Text fz={13} ff="monospace" component="div">
                {lines(r.result)}
              </Text>
            </Box>
          ))}
        </Stack>
      ) : (
        <Table fz={13} verticalSpacing={4} horizontalSpacing={8}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("insights.ask.head.tool")}</Table.Th>
              <Table.Th>{t("insights.ask.head.filters")}</Table.Th>
              <Table.Th>{t("insights.ask.head.period")}</Table.Th>
              <Table.Th ta="right">{t("insights.ask.head.result")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={i} style={{ verticalAlign: "top" }}>
                <Table.Td>{r.tool}</Table.Td>
                <Table.Td>{r.filters}</Table.Td>
                <Table.Td>{r.period}</Table.Td>
                <Table.Td ta="right" ff="monospace">
                  {lines(r.result)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Box>
  );
}

export function InsightsAsk({ walletId }: { walletId: number }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const askPastLimit = useAskPastLimit();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<Asked[]>([]);
  // null is the latest question.
  const [shown, setShown] = useState<number | null>(null);

  const ask = useMutation({
    mutationFn: (q: string) => askPastLimit((confirm) => askAI(walletId, q, confirm)),
    onSuccess: (answer, q) => {
      void qc.invalidateQueries({ queryKey: AI_SENDS_KEY });
      if (!answer) return; // the user kept to this month's limit
      setAsked((cur) => [...cur, { question: q, answer, at: new Date() }]);
      setShown(null);
      setQuestion("");
    },
    onError: notifyError,
  });

  const send = (q: string) => {
    const text = q.trim();
    if (text && !ask.isPending) ask.mutate(text);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(question);
  };

  const at = shown ?? asked.length - 1;
  const current = asked[at];
  const earlier = asked.map((a, i) => ({ a, i })).filter(({ i }) => i !== at);

  return (
    <Stack gap="sm" maw={760}>
      <form onSubmit={submit}>
        <TextInput
          size="md"
          radius="md"
          placeholder={t("insights.ask.placeholder")}
          aria-label={t("insights.ask.field")}
          value={question}
          maxLength={QUESTION_MAX}
          disabled={ask.isPending}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          leftSection={<IconSparkles size={17} color="var(--cb-ai-a)" aria-hidden />}
          rightSection={
            <ActionIcon
              type="submit"
              size={30}
              radius="md"
              aria-label={t("insights.ask.send")}
              loading={ask.isPending}
              disabled={!question.trim()}
            >
              <IconArrowUp size={17} />
            </ActionIcon>
          }
          rightSectionWidth={44}
        />
      </form>
      {!current ? (
        <>
          <Group gap={6}>
            {EXAMPLES.map((k) => (
              <UnstyledButton
                key={k}
                px={10}
                py={5}
                fz={13}
                disabled={ask.isPending}
                onClick={() => {
                  setQuestion(t(`insights.ask.${k}`));
                  send(t(`insights.ask.${k}`));
                }}
                style={{
                  border: "1px solid var(--mantine-color-default-border)",
                  borderRadius: 999,
                  color: "var(--mantine-color-text)",
                }}
              >
                {t(`insights.ask.${k}`)}
              </UnstyledButton>
            ))}
          </Group>
          <Text fz="xs" c="dimmed">
            {t("insights.ask.note")}
          </Text>
        </>
      ) : (
        <AiBox
          key={at}
          label={t("insights.ask.label")}
          basis={t("insights.ask.basis", {
            wallet: currentWallet?.title ?? "",
            date: new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "long" }).format(
              current.at,
            ),
          })}
        >
          <Stack gap={10}>
            <Text fz={13} c="dimmed">
              {t("insights.ask.asked")}{" "}
              <Text span c="var(--mantine-color-text)" fz={13} fw={500}>
                {current.question}
              </Text>
            </Text>
            <Text fz={14.5} component="div">
              {current.answer.answer ? withAmounts(current.answer.answer) : t("insights.ask.none")}
            </Text>
            {current.answer.used.length > 0 && <NumbersUsed answer={current.answer} />}
          </Stack>
        </AiBox>
      )}
      {earlier.length > 0 && (
        <Group gap={6} fz={13} c="dimmed">
          <Text fz={13} c="dimmed">
            {t("insights.ask.earlier")}
          </Text>
          {earlier.map(({ a, i }) => (
            <Anchor key={i} component="button" type="button" fz={13} onClick={() => setShown(i)}>
              {a.question}
            </Anchor>
          ))}
        </Group>
      )}
    </Stack>
  );
}
