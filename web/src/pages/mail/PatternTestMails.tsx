import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconCheck, IconChevronDown, IconChevronRight, IconPlus, IconX } from "@tabler/icons-react";
import { useQueries } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { getMailboxMessage, type MailExtracted, type MailPatternTest } from "../../api/client";
import { mailText, type Step, type Stop, whereItStops } from "./patternBuilder";

type TestMail = MailPatternTest["mails"][number];

/** How many unread mails are fetched to say where each one stops. */
const EXPLAINED = 10;
/** How many of the other mails show before "Show all". */
const OTHERS = 5;

/**
 * The mails a draft pattern was tried on (#674): the ones it does not read,
 * each telling where it stops matching, and the ones it reads with the
 * values it takes. A mail that differs only past the start can join the
 * example mails.
 */
export function PatternTestMails({
  walletId,
  mailboxId,
  tried,
  steps,
  fresh,
  examples,
  adding,
  onAdd,
  amount,
  when,
}: {
  walletId: number;
  mailboxId: number;
  tried: MailPatternTest;
  /** The pattern's steps; null when it was written by hand. */
  steps: Step[] | null;
  /** Mails the last change made it read. */
  fresh: Set<number>;
  /** The mails already marked. */
  examples: (number | null)[];
  adding: boolean;
  onAdd: (mailId: number) => void;
  amount: (tx: MailExtracted) => string;
  when: (iso: string) => string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);

  const unread = tried.mails.filter((m) => !m.matched);
  const texts = useQueries({
    queries: unread.slice(0, EXPLAINED).map((m) => ({
      queryKey: ["mailMessage", walletId, mailboxId, m.id],
      queryFn: () => getMailboxMessage(walletId, mailboxId, m.id),
      enabled: !!steps,
      staleTime: Infinity,
    })),
  });
  const explained = new Map<number, { text: string; stop: Stop | null }>();
  // Still loading; a mail that failed to load is just "not read".
  const pending = new Set<number>();
  unread.slice(0, EXPLAINED).forEach((m, i) => {
    if (steps && texts[i]?.isPending) pending.add(m.id);
    const d = texts[i]?.data;
    if (!d || !steps) return;
    const text = mailText(d.subject, d.body);
    explained.set(m.id, { text, stop: whereItStops(steps, text) });
  });

  const newly = tried.mails.filter((m) => m.matched && fresh.has(m.id));
  const read = tried.mails.filter((m) => m.matched && !fresh.has(m.id));
  // Every unread mail shows; of the read ones, a few until "Show all".
  const rest = [...unread, ...(all ? read : read.slice(0, OTHERS))];

  const summary = (m: TestMail) => {
    const e = explained.get(m.id);
    if (!e) return pending.has(m.id) ? "" : t("mail.editor.notRead");
    if (!e.stop) return t("mail.editor.notRead");
    if (e.stop.fromStart) return t("mail.editor.otherKind");
    const field = t(`mail.field.${e.stop.step.field}`);
    if (e.stop.step.kind === "before") return t("mail.editor.stopsBefore", { field });
    if (e.stop.step.kind === "value") return t("mail.editor.stopsAt", { field });
    return t("mail.editor.stopsAfter", { field });
  };

  const row = (m: TestMail, i: number) => {
    const border = i ? "1px solid var(--mantine-color-default-border)" : undefined;
    if (m.matched) {
      const tx = m.transaction;
      return (
        <Group
          key={m.id}
          gap={8}
          wrap="nowrap"
          align="flex-start"
          px="sm"
          py={8}
          style={{ borderTop: border }}
          data-testid="pattern-test-mail"
          data-read="true"
        >
          <IconCheck
            size={16}
            color="var(--mantine-color-teal-6)"
            style={{ marginTop: 2, flexShrink: 0 }}
            aria-hidden
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap={6} wrap="nowrap" justify="space-between">
              <Text size="sm" fw={500} truncate data-cb-sensitive>
                {tx?.payee || tx?.memo || m.subject}
              </Text>
              {tx && (
                <Text
                  size="sm"
                  ff="monospace"
                  c={tx.amount < 0 ? "red" : "teal"}
                  style={{ flexShrink: 0 }}
                  data-cb-sensitive
                >
                  {amount(tx)}
                </Text>
              )}
            </Group>
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">
                {when(m.receivedAt)}
              </Text>
              {fresh.has(m.id) && (
                <Badge size="xs" variant="light" color="blue">
                  {t("mail.editor.isNew")}
                </Badge>
              )}
            </Group>
            {m.error && (
              <Text size="xs" c="red">
                {m.error}
              </Text>
            )}
          </div>
        </Group>
      );
    }
    const expanded = open === m.id;
    const e = explained.get(m.id);
    return (
      <Box
        key={m.id}
        style={{ borderTop: border }}
        data-testid="pattern-test-mail"
        data-read="false"
      >
        <UnstyledButton
          w="100%"
          px="sm"
          py={8}
          aria-expanded={expanded}
          onClick={() => setOpen(expanded ? null : m.id)}
        >
          <Group gap={8} wrap="nowrap" align="flex-start">
            <IconX
              size={16}
              color="var(--mantine-color-orange-6)"
              style={{ marginTop: 2, flexShrink: 0 }}
              aria-hidden
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Group gap={6} wrap="nowrap" justify="space-between">
                <Text size="sm" fw={500} truncate data-cb-sensitive>
                  {m.subject}
                </Text>
                {expanded ? (
                  <IconChevronDown size={16} style={{ flexShrink: 0 }} aria-hidden />
                ) : (
                  <IconChevronRight size={16} style={{ flexShrink: 0 }} aria-hidden />
                )}
              </Group>
              <Group gap={6} wrap="nowrap">
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                  {when(m.receivedAt)}
                </Text>
                <Text size="xs" c="orange.8" truncate>
                  {summary(m)}
                </Text>
              </Group>
            </div>
          </Group>
        </UnstyledButton>
        {expanded && (
          <Box px="sm" pb="sm" pl={36}>
            {pending.has(m.id) ? (
              <Loader size="xs" />
            ) : e?.stop && !e.stop.fromStart ? (
              <WhereItStops
                text={e.text}
                stop={e.stop}
                action={
                  !examples.includes(m.id) && (
                    <Stack gap={4}>
                      <Button
                        size="compact-sm"
                        variant="light"
                        leftSection={<IconPlus size={14} />}
                        loading={adding}
                        onClick={() => onAdd(m.id)}
                        style={{ alignSelf: "flex-start" }}
                      >
                        {t("mail.editor.addSample")}
                      </Button>
                      <Text size="xs" c="dimmed">
                        {t("mail.editor.addSampleHint")}
                      </Text>
                    </Stack>
                  )
                }
              />
            ) : (
              <Text size="xs" c="dimmed">
                {e?.stop?.fromStart ? t("mail.editor.otherKindHint") : t("mail.editor.notReadHint")}
              </Text>
            )}
          </Box>
        )}
      </Box>
    );
  };

  const list = (mails: TestMail[]) => (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      {mails.map(row)}
    </Paper>
  );

  return (
    <Stack gap="xs" data-testid="pattern-test-mails">
      {newly.length > 0 ? (
        <>
          <Text size="sm" fw={500}>
            {t("mail.editor.newlyRead", { count: newly.length })}
          </Text>
          {list(newly)}
          {rest.length > 0 && (
            <Text size="sm" fw={500} mt={4}>
              {t("mail.editor.otherMails")}
            </Text>
          )}
        </>
      ) : (
        unread.length > 0 && (
          <Text size="sm" fw={500}>
            {t("mail.editor.unread", { count: unread.length })}
          </Text>
        )
      )}
      {rest.length > 0 && list(rest)}
      {read.length > OTHERS && (
        <Button
          size="compact-sm"
          variant="subtle"
          onClick={() => setAll((a) => !a)}
          style={{ alignSelf: "flex-start" }}
        >
          {all ? t("mail.showFewer") : t("mail.showAll", { count: read.length })}
        </Button>
      )}
    </Stack>
  );
}

/** A mail's text where it stops matching, with what the pattern looked for. */
function WhereItStops({ text, stop, action }: { text: string; stop: Stop; action: ReactNode }) {
  const { t } = useTranslation();
  const [d0, d1] = stop.diff;
  // Up to a short stretch of what was read, from the start of a word.
  let a = Math.max(stop.read?.[0] ?? d0, d0 - 70);
  while (a > (stop.read?.[0] ?? d0) && a < d0 && !/\s/.test(text[a - 1])) a++;
  const lineEnd = text.slice(d1).search(/[\r\n]/);
  const eol = lineEnd < 0 ? text.length : d1 + lineEnd;
  const z = Math.min(eol, d1 + 30);
  const code = {
    fontFamily: "var(--mantine-font-family-monospace)",
    fontSize: 12.5,
    background: "var(--mantine-color-default-hover)",
    borderRadius: 4,
    padding: "1px 5px",
    whiteSpace: "pre" as const,
  };
  // A line's end has no character of its own to show.
  const visible = (s: string) => s.replaceAll("\r", "").replaceAll("\n", "↵");
  return (
    <Stack gap={8} data-testid="pattern-stop">
      <Text size="xs" c="dimmed">
        {t("mail.editor.whereStops")}
      </Text>
      <Box
        p="xs"
        data-cb-sensitive
        style={{
          fontSize: "var(--mantine-font-size-sm)",
          lineHeight: 1.8,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          background: "var(--mantine-color-default-hover)",
          borderRadius: 6,
        }}
      >
        {a > 0 && "…"}
        <span style={{ background: "var(--mantine-color-teal-light)", borderRadius: 3 }}>
          {text.slice(a, d0)}
        </span>
        <span
          style={{
            background: "var(--mantine-color-orange-light)",
            color: "var(--mantine-color-orange-light-color)",
            borderRadius: 3,
            textDecoration: "underline wavy",
            textUnderlineOffset: 3,
          }}
        >
          {text.slice(d0, d1)}
        </span>
        {text.slice(d1, z)}
        {z < eol && "…"}
      </Box>
      <Stack gap={4}>
        <Group gap={8} wrap="nowrap" align="flex-start">
          <Text size="xs" c="dimmed" w={110} style={{ flexShrink: 0 }}>
            {t("mail.editor.expects")}
          </Text>
          <Group gap={4}>
            {stop.step.looksFor.length > 0 ? (
              stop.step.looksFor.map((s) => (
                <span key={s} style={code} data-cb-sensitive>
                  {visible(s)}
                </span>
              ))
            ) : (
              <Text size="xs">{t(`mail.field.${stop.step.field}`)}</Text>
            )}
          </Group>
        </Group>
        <Group gap={8} wrap="nowrap" align="flex-start">
          <Text size="xs" c="dimmed" w={110} style={{ flexShrink: 0 }}>
            {t("mail.editor.mailHas")}
          </Text>
          <span
            style={{ ...code, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            data-cb-sensitive
          >
            {visible(text.slice(d0, d1)) || "—"}
          </span>
        </Group>
      </Stack>
      {action}
    </Stack>
  );
}
