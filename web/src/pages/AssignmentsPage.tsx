import { Button, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  applyAssignments,
  deleteAssignment,
  listAccounts,
  listAssignments,
  listCategories,
  listPayees,
  reorderAssignments,
  type Assignment,
  type AssignmentInput,
  type Category,
  type Payee,
  type RuleTest,
} from "../api/client";
import { actOnAIProposal, aiProposalsKey, type AIProposal, type AIProposalRow } from "../api/ai";
import { useConfirm } from "../components/confirmContext";
import { PageHeader } from "../components/PageHeader";
import { useProposal } from "../components/proposalData";
import { RuleProposal } from "../components/RuleProposal";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import { useDayMonth } from "./categories/labels";
import { moveBy, moveTo } from "./rules/ruleList";
import classes from "./rules/rules.module.css";
import { RuleSheet } from "./rules/RuleSheet";
import {
  RulePhoneList,
  RuleTable,
  Sentence,
  type Lookups,
  type RuleActions,
} from "./rules/RuleTable";
import { notifyError } from "../notifyError";

/**
 * Rules (#566): every rule as the sentence it is, in the order they are tried,
 * with how many of the wallet's transactions each one decides — a rule that
 * never fires is one to delete, or one a rule above is shadowing. Add and edit
 * in the sheet beside the page, whose preview is a dry run.
 */
export function AssignmentsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const day = useDayMonth(useToday());

  const query = useQuery({
    queryKey: ["assignments", walletId],
    queryFn: () => listAssignments(walletId),
    enabled: walletId > 0,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
    enabled: walletId > 0,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled: walletId > 0,
  });
  const lookups: Lookups = useMemo(
    () => ({
      accounts: accountsQuery.data ?? [],
      categories: categoriesQuery.data ?? [],
      payees: payeesQuery.data ?? [],
    }),
    [accountsQuery.data, categoriesQuery.data, payeesQuery.data],
  );

  // A local ordered copy so a move feels instant; adopted from the query
  // during render rather than in an effect, so the list never paints one frame
  // of the previous order after a save lands.
  const [order, setOrder] = useState<Assignment[]>(query.data ?? []);
  const [seenRules, setSeenRules] = useState(query.data);
  if (query.data !== seenRules) {
    setSeenRules(query.data);
    setOrder(query.data ?? []);
  }

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["assignments", walletId] });
    void qc.invalidateQueries({ queryKey: ["tags", walletId] });
  };
  const onError = (err: unknown) => notifyError(err);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => deleteAssignment(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => reorderAssignments(walletId, ids),
    onSuccess: invalidate,
    onError,
  });
  const apply = useMutation({
    mutationFn: (assignmentId: number | null) =>
      applyAssignments(walletId, { assignmentId, onlyFillEmpty: true }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["register", walletId] });
      invalidate();
      notifications.show({
        color: "green",
        message: t("assignments.applied", { count: res.changed }),
      });
    },
    onError,
  });

  const reorderTo = (next: Assignment[]) => {
    if (next === order) return;
    setOrder(next);
    reorder.mutate(next.map((r) => r.id));
  };

  const actions: RuleActions = {
    onEdit: (r) => {
      setEditing(r);
      setSheetOpen(true);
    },
    onApply: async (r) => {
      setSheetOpen(false);
      const ok = await confirm({
        title: t("assignments.confirmApplyOneTitle", { count: r.matches ?? 0 }),
        body: t("assignments.confirmApplyBody"),
        confirmLabel: t("assignments.apply"),
      });
      if (ok) apply.mutate(r.id);
    },
    onMove: (r, delta) => reorderTo(moveBy(order, r.id, delta)),
    onDrop: (id, targetId) => reorderTo(moveTo(order, id, targetId)),
    onDelete: async (r) => {
      setSheetOpen(false);
      const ok = await confirm({
        title: t("assignments.confirmDeleteTitle"),
        body: t("assignments.confirmDeleteBody"),
        confirmLabel: t("assignments.menu.delete"),
        danger: true,
      });
      if (ok) remove.mutate(r.id);
    },
  };

  // The AI's rule proposal (#705): Create rule opens a new rule filled in, and
  // the row is done once it is saved; then the transactions already there
  // without a category can be filled in too. ?apply=proposal:payee comes from
  // AI insights.
  const [params, setParams] = useSearchParams();
  const proposal = useProposal(walletId, "rules");
  const [draft, setDraft] = useState<Partial<AssignmentInput>>();
  const [applying, setApplying] = useState<{ proposalId: number; payeeId: number } | null>(null);
  const applyRow = (p: AIProposal, r: AIProposalRow) => {
    setEditing(null);
    setDraft({
      matchField: "payee",
      matchType: "exact",
      pattern: r.name,
      caseSensitive: false,
      setCategoryId: r.categoryId,
      setTags: [],
      applyOnManual: true,
      applyOnImport: true,
    });
    setApplying({ proposalId: p.id, payeeId: r.payeeId ?? 0 });
    setSheetOpen(true);
  };
  const applyLink = params.get("apply");
  const [seenApply, setSeenApply] = useState<string | null>(null);
  if (applyLink && applyLink !== seenApply && proposal) {
    setSeenApply(applyLink);
    const [pid, payeeId] = applyLink.split(":").map(Number);
    const row = proposal.id === pid && proposal.basis.rows.find((r) => r.payeeId === payeeId);
    if (row) applyRow(proposal, row);
  }
  const saved = (rule: Assignment, preview?: RuleTest) => {
    invalidate();
    if (!applying) return;
    const { proposalId, payeeId } = applying;
    setApplying(null);
    void actOnAIProposal(walletId, proposalId, "applied", { payeeId })
      .then(() => qc.invalidateQueries({ queryKey: aiProposalsKey(walletId) }))
      .catch(notifyError);
    if (preview && preview.withoutCategory > 0)
      void actions.onApply({ ...rule, matches: preview.count - preview.taken });
  };
  const closeSheet = () => {
    setSheetOpen(false);
    setApplying(null);
    if (applyLink) {
      const next = new URLSearchParams(params);
      next.delete("apply");
      setParams(next, { replace: true });
    }
  };

  if (!currentWallet) return null;

  const openNew = () => {
    setEditing(null);
    setDraft(undefined);
    setSheetOpen(true);
  };
  const empty = order.length === 0 && query.isSuccess;

  return (
    <Stack className={classes.page} gap="md">
      <PageHeader
        title={t("assignments.title")}
        hint={t("assignments.subtitle")}
        actions={
          order.length > 0 && (
            <>
              <Button
                variant="default"
                onClick={async () => {
                  const ok = await confirm({
                    title: t("assignments.confirmApplyTitle"),
                    body: t("assignments.confirmApplyBody"),
                    confirmLabel: t("assignments.applyToExisting"),
                  });
                  if (ok) apply.mutate(null);
                }}
                loading={apply.isPending}
              >
                {t("assignments.applyToExisting")}
              </Button>
              <Button onClick={openNew}>{t("assignments.add")}</Button>
            </>
          )
        }
      />

      {proposal && <RuleProposal walletId={walletId} proposal={proposal} onApply={applyRow} />}

      {empty && <RulesEmpty onAdd={openNew} />}

      {order.length > 0 && (
        <>
          <span className={classes.line}>
            {phone ? t("assignments.linePhone") : t("assignments.line")}
          </span>
          {phone ? (
            <RulePhoneList rules={order} lookups={lookups} actions={actions} />
          ) : (
            <RuleTable rules={order} lookups={lookups} actions={actions} />
          )}
        </>
      )}

      <RuleSheet
        opened={sheetOpen}
        onClose={closeSheet}
        walletId={walletId}
        editing={editing}
        position={editing ? order.findIndex((r) => r.id === editing.id) + 1 : order.length + 1}
        count={order.length}
        lookups={lookups}
        day={day}
        onSaved={saved}
        actions={actions}
        draft={draft}
      />
    </Stack>
  );
}

/** Empty is an invitation: what a rule does, two examples, and the button. */
function RulesEmpty({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  // The examples are sentences like any rule's, over names of their own.
  const lookups: Lookups = {
    accounts: [],
    categories: [
      { id: -1, name: t("assignments.example.groceries"), isIncome: false } as Category,
      { id: -2, name: t("assignments.example.salary"), isIncome: true } as Category,
    ],
    payees: [{ id: -3, name: t("assignments.example.employer") } as Payee],
  };
  const base = { caseSensitive: false, setTags: [] as string[], matchType: "contains" as const };
  return (
    <div className={classes.empty} data-testid="rules-empty">
      <h3 className={classes.emptyTitle}>{t("assignments.emptyTitle")}</h3>
      <p className={classes.emptyBody}>{t("assignments.emptyBody")}</p>
      <div className={classes.examples}>
        <Sentence
          rule={{
            ...base,
            matchField: "payee",
            pattern: t("assignments.example.supermarket"),
            setCategoryId: -1,
          }}
          lookups={lookups}
        />
        <Sentence
          rule={{
            ...base,
            matchField: "memo",
            pattern: t("assignments.example.salary"),
            setCategoryId: -2,
            setPayeeId: -3,
          }}
          lookups={lookups}
        />
      </div>
      <Button onClick={onAdd}>{t("assignments.add")}</Button>
    </div>
  );
}
