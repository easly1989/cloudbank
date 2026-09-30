import { Button, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  applyAssignments,
  deleteAssignment,
  listAccounts,
  listAssignments,
  listCategories,
  listPayees,
  reorderAssignments,
  type Assignment,
  type Category,
  type Payee,
} from "../api/client";
import { useConfirm } from "../components/confirmContext";
import { PageHeader } from "../components/PageHeader";
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
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

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

  if (!currentWallet) return null;

  const openNew = () => {
    setEditing(null);
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
        onClose={() => setSheetOpen(false)}
        walletId={walletId}
        editing={editing}
        position={editing ? order.findIndex((r) => r.id === editing.id) + 1 : order.length + 1}
        count={order.length}
        lookups={lookups}
        day={day}
        onSaved={invalidate}
        actions={actions}
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
