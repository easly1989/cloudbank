import { Anchor, Box, Button, Checkbox, Group, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  cleanUpPayees,
  ApiError,
  getLastPayeeCleanup,
  payeeCleanupKey,
  undoPayeeCleanup,
  type CleanupProposal,
  type Payee,
} from "../../api/client";
import { AiBox } from "../../components/AiBox";
import { notifyError } from "../../notifyError";
import { sensitive } from "../../privacy";

// The payee cleanup (#708): the AI's groups of names, each with its clean name,
// the names it takes and a rule for the next imports, all editable; nothing
// changes until Apply. The last cleanup can be undone from the bar below it.

type Draft = { on: boolean; name: string; off: Set<number>; ruleOn: boolean; rule: string };

const MONO = "var(--mantine-font-family-monospace)";

const dayMonth = (lang: string, d: Date) =>
  new Intl.DateTimeFormat(lang, { day: "numeric", month: "long" }).format(d);

function GroupRow({
  g,
  d,
  payees,
  phone,
  onEdit,
}: {
  g: CleanupProposal;
  d: Draft;
  payees: Payee[];
  phone: boolean;
  onEdit: (patch: Partial<Draft>) => void;
}) {
  const { t } = useTranslation();
  const kept = g.payees.filter((p) => !d.off.has(p.id));
  const total = kept.reduce((n, p) => n + p.transactions, 0);
  const name = d.name.trim().toLowerCase();
  const merges = payees.some(
    (p) => p.name.toLowerCase() === name && !g.payees.some((x) => x.id === p.id),
  );
  const what = merges
    ? t("payees.cleanup.merges")
    : kept.length === 1
      ? t("payees.cleanup.renamed")
      : t("payees.cleanup.become", { count: kept.length });
  const rule = d.rule.trim().toLowerCase();
  const covers = rule ? g.payees.filter((p) => p.name.toLowerCase().includes(rule)).length : 0;
  return (
    <Box
      py={12}
      data-testid="cleanup-group"
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
    >
      <Group gap={10} wrap="nowrap" align="flex-start">
        <Checkbox
          mt={8}
          checked={d.on}
          onChange={() => onEdit({ on: !d.on })}
          aria-label={t("payees.cleanup.include", { name: d.name || g.name })}
        />
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={10} wrap={phone ? "wrap" : "nowrap"}>
            <TextInput
              size="sm"
              value={d.name}
              onChange={(e) => onEdit({ name: e.currentTarget.value })}
              aria-label={t("payees.cleanup.name")}
              w={phone ? "100%" : 220}
              maxLength={100}
              {...sensitive}
            />
            <Text fz="xs" c="dimmed">
              {what} · {t("payees.transactions", { count: total })}
            </Text>
          </Group>
          <Stack gap={2}>
            {g.payees.map((p) => (
              <Checkbox
                key={p.id}
                size="xs"
                checked={!d.off.has(p.id)}
                onChange={() => {
                  const off = new Set(d.off);
                  if (!off.delete(p.id)) off.add(p.id);
                  onEdit({ off });
                }}
                label={
                  <Text span fz={13}>
                    <Text span ff={MONO} fz={12.5} data-cb-sensitive>
                      {p.name}
                    </Text>
                    <Text span c="dimmed" fz={12}>
                      {" "}
                      · {p.transactions}
                    </Text>
                  </Text>
                }
              />
            ))}
          </Stack>
          <Group gap={8} wrap="wrap" mt={2}>
            <Checkbox
              size="xs"
              checked={d.ruleOn}
              onChange={() => onEdit({ ruleOn: !d.ruleOn })}
              label={t("payees.cleanup.rule")}
            />
            <TextInput
              size="xs"
              value={d.rule}
              onChange={(e) => onEdit({ rule: e.currentTarget.value, ruleOn: true })}
              aria-label={t("payees.cleanup.ruleText")}
              w={150}
              maxLength={200}
              styles={{ input: { fontFamily: MONO } }}
              {...sensitive}
            />
            <Text fz="xs" c="dimmed">
              {t("payees.cleanup.covers", { count: covers })}
            </Text>
          </Group>
        </Stack>
      </Group>
    </Box>
  );
}

export function PayeeCleanupBox({
  walletId,
  groups,
  madeOn,
  payees,
  phone,
  onDone,
  onCancel,
}: {
  walletId: number;
  groups: CleanupProposal[];
  madeOn: string;
  payees: Payee[];
  phone: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    groups.map((g) => ({
      on: true,
      name: g.name,
      off: new Set(),
      ruleOn: g.rule !== "",
      rule: g.rule,
    })),
  );
  const ready = groups
    .map((g, i) => ({ g, d: drafts[i] }))
    .filter(({ g, d }) => d.on && d.name.trim() && g.payees.some((p) => !d.off.has(p.id)));
  const names = groups.reduce((n, g) => n + g.payees.length, 0);

  const apply = useMutation({
    mutationFn: () =>
      cleanUpPayees(
        walletId,
        ready.map(({ g, d }) => ({
          name: d.name.trim(),
          payeeIds: g.payees.filter((p) => !d.off.has(p.id)).map((p) => p.id),
          rule: d.ruleOn ? d.rule.trim() : "",
        })),
      ),
    onSuccess: (res) => {
      notifications.show({
        color: "green",
        message: t("payees.cleanup.done", { count: res.names }),
        autoClose: 1600,
      });
      onDone();
    },
    onError: notifyError,
  });

  return (
    <AiBox
      label={t("payees.cleanup.label")}
      basis={t("payees.cleanup.basis", { date: madeOn })}
      title={t("payees.cleanup.title", {
        names: t("payees.cleanup.payees", { count: names }),
        groups: t("payees.cleanup.groups", { count: groups.length }),
      })}
      actions={
        <>
          <Button
            size="xs"
            disabled={ready.length === 0}
            loading={apply.isPending}
            onClick={() => apply.mutate()}
          >
            {t("payees.cleanup.apply", { n: ready.length })}
          </Button>
          <Button size="xs" variant="subtle" color="gray" onClick={onCancel}>
            {t("payees.cancel")}
          </Button>
        </>
      }
    >
      <Text fz="xs" c="dimmed">
        {t("payees.cleanup.note")}
      </Text>
      <Box mt={6}>
        {groups.map((g, i) => (
          <GroupRow
            key={g.payees[0].id}
            g={g}
            d={drafts[i]}
            payees={payees}
            phone={phone}
            onEdit={(patch) =>
              setDrafts((all) => all.map((d, j) => (j === i ? { ...d, ...patch } : d)))
            }
          />
        ))}
      </Box>
    </AiBox>
  );
}

/** The last cleanup, with its undo; nothing when there is none. */
export function PayeeCleanupBar({
  walletId,
  onUndone,
}: {
  walletId: number;
  onUndone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const last = useQuery({
    queryKey: payeeCleanupKey(walletId),
    queryFn: () => getLastPayeeCleanup(walletId),
    enabled: walletId > 0,
  });
  const undo = useMutation({
    mutationFn: () => undoPayeeCleanup(walletId),
    onSuccess: () => {
      notifications.show({ color: "green", message: t("payees.cleanup.undone"), autoClose: 1600 });
      onUndone();
    },
    onError: (err) =>
      err instanceof ApiError && err.code === "undo_conflict"
        ? notifications.show({ color: "red", message: t("payees.cleanup.undoConflict") })
        : notifyError(err),
  });
  const c = last.data?.cleanup;
  if (!c) return null;
  return (
    <Group
      justify="space-between"
      gap="xs"
      px={14}
      py={10}
      data-testid="cleanup-bar"
      style={{ border: "1px solid var(--cb-shell-card-border)", borderRadius: 10 }}
    >
      <Text fz={14}>
        {t("payees.cleanup.last", {
          date: dayMonth(i18n.language, new Date(c.createdAt)),
          payees: t("payees.cleanup.payees", { count: c.payees }),
          names: t("payees.cleanup.names", { count: c.names }),
          rules: t("payees.cleanup.rules", { count: c.rules }),
        })}
      </Text>
      <Anchor
        component="button"
        type="button"
        fz={14}
        disabled={undo.isPending}
        onClick={() => undo.mutate()}
      >
        {t("payees.cleanup.undo")}
      </Anchor>
    </Group>
  );
}
