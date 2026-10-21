import { Box, Button, Card, Checkbox, Group, Select, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconHistory, IconSparkles } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AI_SETTINGS_KEY,
  getAISettings,
  proposeCategories,
  type Account,
  type CategoryProposal,
  type ReviewTxn,
  bulkCategorizeTransactions,
  bulkEditTransactions,
} from "../api/client";
import aiClasses from "../components/AiBox.module.css";
import { useAskPastLimit } from "../components/aiLimit";
import { aiFeatureOn } from "../components/proposalData";
import { useDateFormat } from "../dates";
import { formatMinor, type MoneyFormat } from "../money";
import { notifyError } from "../notifyError";
import { sensitive } from "../privacy";

// Review's rows that need a category (#486), and the bulk categorisation of
// #706: "Propose categories" fills a payee and a category in where it can,
// from history first and the AI for the rest; each proposed row has a box,
// stays editable, and nothing is saved until Confirm. A row without a proposal
// saves as soon as it is picked, as it always has.

type Draft = {
  payeeId: number | null;
  categoryId: number | null;
  source: CategoryProposal["source"];
  picked: boolean;
};

type Option = { value: string; label: string };

const ROW_RULE = "1px solid var(--mantine-color-default-border)";

function Mark({ draft }: { draft?: Draft }) {
  const { t } = useTranslation();
  const small = { fz: 11.5, c: "dimmed" } as const;
  if (!draft) return <Text {...small}>{t("review.propose.noPayee")}</Text>;
  if (draft.categoryId === null) return <Text {...small}>{t("review.propose.noCategory")}</Text>;
  if (draft.source === "history")
    return (
      <Group gap={4} wrap="nowrap">
        <IconHistory size={13} color="var(--mantine-color-dimmed)" aria-hidden />
        <Text {...small}>{t("review.propose.fromHistory")}</Text>
      </Group>
    );
  return (
    <Group gap={4} wrap="nowrap">
      <IconSparkles size={13} color="var(--cb-ai-a)" aria-hidden />
      <span className={aiClasses.label} style={{ fontSize: 11.5 }}>
        {t("review.propose.ai")}
      </span>
    </Group>
  );
}

export function ReviewNeedsCategory({
  walletId,
  needs,
  accountById,
  fmtFor,
  categoryOptions,
  payeeOptions,
  onChanged,
}: {
  walletId: number;
  needs: ReviewTxn[];
  accountById: Map<number, Account>;
  fmtFor: (acc?: Account) => MoneyFormat;
  categoryOptions: Option[];
  payeeOptions: Option[];
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const fmtDate = useDateFormat();
  // Side by side on a desktop; on a phone the pickers go underneath.
  const phone = useMediaQuery("(max-width: 47.99em)");
  const settings = useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: getAISettings });
  const aiOn = aiFeatureOn(settings.data, walletId, "suggest");
  const askPastLimit = useAskPastLimit();

  // The proposals by row; null until asked for. Rows gone from the list
  // (filed elsewhere) are simply not shown.
  const [drafts, setDrafts] = useState<Map<number, Draft> | null>(null);
  const [madeOn, setMadeOn] = useState("");
  const [none, setNone] = useState(false);
  const shown = needs.filter((r) => drafts?.has(r.id));
  const picked = shown.filter((r) => drafts?.get(r.id)?.picked && drafts.get(r.id)?.categoryId);
  const proposing = shown.length > 0;

  const edit = (id: number, patch: Partial<Draft>) =>
    setDrafts((m) => {
      const d = m?.get(id);
      if (!m || !d) return m;
      return new Map(m).set(id, { ...d, ...patch });
    });

  const propose = useMutation({
    mutationFn: () => askPastLimit((confirm) => proposeCategories(walletId, confirm)),
    onSuccess: (res) => {
      if (!res) return;
      setNone(res.proposals.length === 0);
      setDrafts(
        new Map(
          res.proposals.map((p) => [
            p.id,
            {
              payeeId: p.payeeId,
              categoryId: p.categoryId ?? null,
              source: p.source,
              picked: p.categoryId !== undefined,
            },
          ]),
        ),
      );
      setMadeOn(
        new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "long" }).format(
          new Date(),
        ),
      );
    },
    onError: notifyError,
  });

  const confirmPicked = useMutation({
    mutationFn: () =>
      bulkCategorizeTransactions(
        walletId,
        picked.map((r) => {
          const d = drafts!.get(r.id)!;
          return { id: r.id, categoryId: d.categoryId!, payeeId: d.payeeId ?? undefined };
        }),
      ),
    onSuccess: (res) => {
      notifications.show({
        color: "green",
        message: t("review.propose.done", { count: res.updated }),
        autoClose: 1600,
      });
      setDrafts((m) => {
        if (!m) return m;
        const n = new Map(m);
        for (const r of picked) n.delete(r.id);
        return n;
      });
      onChanged();
    },
    onError: notifyError,
  });

  // A row without a proposal saves at once, as before #706.
  const save = useMutation({
    mutationFn: (v: { id: number; field: "category" | "payee"; value: number }) =>
      bulkEditTransactions(walletId, [v.id], v.field, v.value),
    onSuccess: onChanged,
    onError: notifyError,
  });

  const counts = { history: 0, ai: 0 };
  for (const r of shown) {
    const d = drafts!.get(r.id)!;
    if (d.categoryId !== null) counts[d.source]++;
  }
  const allPicked = picked.length > 0 && picked.length === counts.history + counts.ai;

  return (
    <Card withBorder data-tour="review-categories">
      <Stack gap="sm">
        <Group justify="space-between" gap="xs">
          <Text fw={600}>{t("review.needsCategory", { count: needs.length })}</Text>
          {proposing ? (
            <Group gap={6} wrap="nowrap">
              <IconSparkles size={14} color="var(--cb-ai-a)" aria-hidden />
              <Text fz="xs" c="dimmed">
                {t("review.propose.summary", { ...counts, date: madeOn })}
              </Text>
            </Group>
          ) : (
            aiOn &&
            needs.length > 0 && (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconSparkles size={14} />}
                loading={propose.isPending}
                onClick={() => propose.mutate()}
              >
                {t("review.propose.button")}
              </Button>
            )
          )}
        </Group>
        {aiOn && needs.length > 0 && !proposing && (
          <Text fz="xs" c="dimmed" mt={-6}>
            {none ? t("review.propose.none") : t("review.propose.hint")}
          </Text>
        )}
        {proposing && (
          <Group justify="space-between" gap="xs">
            <Checkbox
              label={t("review.propose.selectAll", { n: counts.history + counts.ai })}
              checked={allPicked}
              indeterminate={!allPicked && picked.length > 0}
              onChange={() => {
                for (const r of shown) {
                  if (drafts!.get(r.id)!.categoryId !== null) edit(r.id, { picked: !allPicked });
                }
              }}
            />
            <Button
              size="xs"
              disabled={picked.length === 0}
              loading={confirmPicked.isPending}
              onClick={() => confirmPicked.mutate()}
            >
              {t("review.propose.confirm", { n: picked.length })}
            </Button>
          </Group>
        )}
        {needs.length === 0 ? (
          <Text c="dimmed" size="sm">
            {t("review.needsCategoryEmpty")}
          </Text>
        ) : (
          needs.map((tx) => {
            const acc = accountById.get(tx.accountId);
            const d = drafts?.get(tx.id);
            const payee = d ? d.payeeId : (tx.payeeId ?? null);
            const pickers = (
              <>
                <Select
                  placeholder={t("transactions.payee")}
                  aria-label={t("transactions.payee")}
                  data={payeeOptions}
                  value={payee ? String(payee) : null}
                  onChange={(v) => {
                    if (!v) return;
                    if (d) edit(tx.id, { payeeId: Number(v) });
                    else save.mutate({ id: tx.id, field: "payee", value: Number(v) });
                  }}
                  searchable
                  {...sensitive}
                />
                <Select
                  placeholder={t("transactions.category")}
                  aria-label={t("transactions.category")}
                  data={categoryOptions}
                  value={d?.categoryId ? String(d.categoryId) : null}
                  onChange={(v) => {
                    if (!v) return;
                    if (d) edit(tx.id, { categoryId: Number(v), picked: true });
                    else save.mutate({ id: tx.id, field: "category", value: Number(v) });
                  }}
                  searchable
                />
              </>
            );
            return (
              // The bank's description is what the category is chosen from, so it
              // is shown whole (#486).
              <Box
                key={tx.id}
                data-testid="needs-category-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: phone
                    ? proposing
                      ? "24px minmax(0, 1fr)"
                      : "minmax(0, 1fr)"
                    : `${proposing ? "24px " : ""}minmax(0, 1fr) 190px 220px`,
                  gap: "8px 14px",
                  alignItems: "start",
                  paddingTop: 12,
                  borderTop: ROW_RULE,
                }}
              >
                {proposing &&
                  (d && d.categoryId !== null ? (
                    <Checkbox
                      mt={2}
                      aria-label={t("review.propose.include", {
                        memo: tx.memo || fmtDate(tx.date),
                      })}
                      checked={d.picked}
                      onChange={() => edit(tx.id, { picked: !d.picked })}
                    />
                  ) : (
                    <span />
                  ))}
                <div style={{ minWidth: 0 }}>
                  <Text
                    size="sm"
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    data-cb-sensitive={!!tx.memo || undefined}
                  >
                    {tx.memo || t("review.noMemo")}
                  </Text>
                  <Group gap={8} wrap="nowrap">
                    <Text size="xs" c="dimmed">
                      {fmtDate(tx.date)}
                      {acc ? ` · ${acc.name}` : ""} ·{" "}
                      <span data-cb-sensitive>{formatMinor(tx.amount, fmtFor(acc))}</span>
                    </Text>
                    {proposing && !phone && <Mark draft={d} />}
                  </Group>
                </div>
                {phone ? (
                  <Stack gap={6} style={{ gridColumn: proposing ? "2" : "1" }}>
                    {pickers}
                    {proposing && <Mark draft={d} />}
                  </Stack>
                ) : (
                  pickers
                )}
              </Box>
            );
          })
        )}
      </Stack>
    </Card>
  );
}
