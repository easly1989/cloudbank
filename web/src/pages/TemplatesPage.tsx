import { Button, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconFileText } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  deleteTemplate,
  getTemplateUsage,
  listCategories,
  listPayees,
  listSchedules,
  listTags,
  listTemplates,
  type Template,
} from "../api/client";
import { useConfirm } from "../components/confirmContext";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import { lastTwelveMonths } from "./categories/categoryTree";
import { useDayMonth } from "./categories/labels";
import { useAccountMoney } from "./schedules/money";
import { buildGroups, usedKey, type TemplateRow } from "./templates/templateList";
import classes from "./templates/templates.module.css";
import { TemplateSheet } from "./templates/TemplateSheet";
import { TemplatePhoneList, TemplateTable } from "./templates/TemplateTable";

/**
 * Templates (#560): the ones kept for quick entry, with how often each was
 * used over the last twelve months, and the ones a schedule posts, which open
 * in Schedules. A quick one opens in the sheet beside the page.
 */
export function TemplatesPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const today = useToday();
  const day = useDayMonth(today);
  const { from, to } = useMemo(() => lastTwelveMonths(today), [today]);
  const money = useAccountMoney(walletId);

  const enabled = walletId > 0;
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled,
  });
  const schedulesQuery = useQuery({
    queryKey: ["schedules", walletId],
    queryFn: () => listSchedules(walletId),
    enabled,
  });
  const usageQuery = useQuery({
    queryKey: ["template-usage", walletId, from, to],
    queryFn: () => getTemplateUsage(walletId, from, to),
    enabled,
  });
  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
    enabled,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled,
  });
  const tagsQuery = useQuery({
    queryKey: ["tags", walletId],
    queryFn: () => listTags(walletId),
    enabled,
  });

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const groups = useMemo(
    () => buildGroups(templates, schedulesQuery.data ?? [], usageQuery.data ?? []),
    [templates, schedulesQuery.data, usageQuery.data],
  );
  const payees = useMemo(() => payeesQuery.data ?? [], [payeesQuery.data]);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const names = useMemo(() => {
    const payee = new Map(payees.map((p) => [p.id, p.name]));
    const category = new Map(categories.map((c) => [c.id, c.name]));
    return {
      account: (id?: number | null) => (id != null ? (money.byId.get(id)?.name ?? "") : ""),
      payee: (id?: number | null) => (id != null ? (payee.get(id) ?? "") : ""),
      category: (id?: number | null) => (id != null ? (category.get(id) ?? "") : ""),
    };
  }, [payees, categories, money.byId]);
  const format = (amount: number, accountId?: number | null) =>
    money.format(amount, accountId ?? undefined);

  const invalidate = () => {
    for (const key of ["templates", "template-usage"])
      void qc.invalidateQueries({ queryKey: [key, walletId] });
  };
  const remove = useMutation({
    mutationFn: (id: number) => deleteTemplate(walletId, id),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  const actions = {
    onOpen: (tpl: Template) => {
      setEditing(tpl);
      setSheetOpen(true);
    },
    onOpenSchedule: (r: TemplateRow) => navigate(`/schedules?view=list&schedule=${r.schedule!.id}`),
    onDelete: (tpl: Template) => void askDelete(tpl),
  };
  const askDelete = async (tpl: Template) => {
    setSheetOpen(false);
    const ok = await confirm({
      title: t("templates.confirmDeleteTitle", { name: tpl.name }),
      body: t("templates.confirmDeleteBody"),
      confirmLabel: t("templates.delete"),
      danger: true,
    });
    if (ok) remove.mutate(tpl.id);
  };

  if (!currentWallet) return null;

  const editingRow = editing ? groups.quick.find((r) => r.template.id === editing.id) : undefined;
  const usedText = (r?: TemplateRow) => {
    if (!r) return "";
    const u = usedKey(r);
    return t(`templates.sheet.${u.key}`, {
      count: u.count,
      date: u.lastDate ? day(u.lastDate) : "",
    });
  };

  // One button, shown in the header or in the empty state — never both.
  const addButton = (
    <Button
      onClick={() => {
        setEditing(null);
        setSheetOpen(true);
      }}
    >
      {t("templates.add")}
    </Button>
  );
  const tableProps = { groups, names, format, day, actions };

  return (
    <Stack className={classes.page} gap="md">
      <PageHeader
        title={t("templates.title")}
        hint={t("templates.hint")}
        actions={templates.length > 0 ? addButton : undefined}
      />

      {templates.length === 0 && templatesQuery.isSuccess && (
        <EmptyState
          icon={IconFileText}
          message={t("templates.empty")}
          hint={t("templates.emptyHint")}
          action={addButton}
        />
      )}

      {templates.length > 0 && (
        <>
          <span className={classes.line}>
            {t(groups.scheduled.length > 0 ? "templates.lineScheduled" : "templates.line")}
          </span>
          {phone ? <TemplatePhoneList {...tableProps} /> : <TemplateTable {...tableProps} />}
        </>
      )}

      <TemplateSheet
        opened={sheetOpen}
        onClose={() => setSheetOpen(false)}
        walletId={walletId}
        editing={editing}
        used={usedText(editingRow)}
        accounts={[...money.byId.values()]}
        payees={payees}
        categories={categories}
        tags={tagsQuery.data ?? []}
        onSaved={invalidate}
        onDelete={actions.onDelete}
      />
    </Stack>
  );
}
