import { Button, SegmentedControl, Stack, TextInput, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCategory, IconLayoutColumns, IconLayoutList, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  deleteCategory,
  getCategoryActivity,
  listCategories,
  mergeCategory,
  type Category,
} from "../api/client";
import { savePreferences } from "../api/preferences";
import { useAuth } from "../auth/AuthProvider";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { formatMinor, type MoneyFormat } from "../money";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import classes from "./categories/categories.module.css";
import { DeleteCategoryModal, MergeModal } from "./categories/CategoryModals";
import { CategorySheet } from "./categories/CategorySheet";
import {
  buildSections,
  countUnused,
  filterSections,
  lastTwelveMonths,
  type CategoryNode,
  type KindFilter,
} from "./categories/categoryTree";
import { CategoryIndex, CategoryPhoneList, CategoryRows } from "./categories/CategoryViews";
import { useSince } from "./categories/labels";

type View = "rows" | "index";

/** Plain two-decimal numbers, for a wallet with no base currency yet. */
const PLAIN: MoneyFormat = {
  fracDigits: 2,
  decimalChar: ".",
  groupChar: ",",
  symbol: "",
  symbolPrefix: false,
};

/**
 * Categories (#552): every category with what it held over the last twelve
 * months, in two sections, spending and income. On a desktop they show as rows
 * in the register's card, or as an index of the groups in columns; the reader's
 * choice is kept with their preferences. A category opens in the sheet beside
 * the page.
 */
export function CategoriesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const today = useToday();
  const since = useSince(today);
  const { from, to } = useMemo(() => lastTwelveMonths(today), [today]);

  const query = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled: walletId > 0,
  });
  const activityQuery = useQuery({
    queryKey: ["category-activity", walletId, from, to],
    queryFn: () => getCategoryActivity(walletId, from, to),
    enabled: walletId > 0,
  });
  const categories = useMemo(() => query.data ?? [], [query.data]);
  const sections = useMemo(
    () => buildSections(categories, activityQuery.data?.categories ?? []),
    [categories, activityQuery.data],
  );
  const format = useMemo(() => {
    const fmt = activityQuery.data?.currency ?? PLAIN;
    return (amount: number) => formatMinor(amount, fmt);
  }, [activityQuery.data]);

  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const unusedCount = countUnused([sections.expense, sections.income]);
  const shown = useMemo(
    () =>
      filterSections(sections, {
        kind,
        query: search,
        unusedOnly: unusedOnly && unusedCount > 0,
      }),
    [sections, kind, search, unusedOnly, unusedCount],
  );
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // The view is the reader's, kept with their preferences; it shows at once and
  // is saved behind. A phone always has the rows.
  const [viewChoice, setViewChoice] = useState<View | null>(null);
  const view: View = phone ? "rows" : (viewChoice ?? user?.preferences?.categoriesView ?? "rows");
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const setView = (v: View) => {
    setViewChoice(v);
    savePreferences(qc, { categoriesView: v }).catch(onError);
  };

  const invalidate = () => {
    for (const key of ["categories", "category-activity"])
      void qc.invalidateQueries({ queryKey: [key, walletId] });
  };

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [presetParent, setPresetParent] = useState<Category | null>(null);
  const [mergeFrom, setMergeFrom] = useState<Category | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const remove = useMutation({
    mutationFn: ({ id, reassignTo }: { id: number; reassignTo?: number }) =>
      deleteCategory(walletId, id, reassignTo),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
    onError,
  });

  const nodeOf = (id: number): CategoryNode | null => {
    for (const sec of [sections.expense, sections.income])
      for (const g of sec.groups) {
        if (g.category.id === id) return g;
        const s = g.subs.find((x) => x.category.id === id);
        if (s) return s;
      }
    return null;
  };
  const actions = {
    onOpen: (c: Category) => {
      setEditing(c);
      setPresetParent(null);
      setSheetOpen(true);
    },
    onAddSub: (g: Category) => {
      setEditing(null);
      setPresetParent(g);
      setSheetOpen(true);
    },
    onMerge: (c: Category) => {
      setSheetOpen(false);
      setMergeFrom(c);
    },
    onDelete: (c: Category) => {
      setSheetOpen(false);
      setDeleteTarget(c);
    },
  };
  const openAdd = () => {
    setEditing(null);
    setPresetParent(null);
    setSheetOpen(true);
  };

  if (!currentWallet) return null;

  const tops = categories.filter((c) => !c.parentId);
  // One button, shown in the header or in the empty state — never both.
  const addButton = <Button onClick={openAdd}>{t("categories.add")}</Button>;

  const count = (n: number) => <span className={classes.segCount}>{n}</span>;
  const kinds = (
    <SegmentedControl
      value={kind}
      onChange={(v) => setKind(v as KindFilter)}
      aria-label={t("categories.filter.label")}
      data={[
        { value: "all", label: t("categories.filter.all") },
        {
          value: "expense",
          label: (
            <>
              {t("categories.section.expense")}
              {!phone && count(sections.expense.groups.length)}
            </>
          ),
        },
        {
          value: "income",
          label: (
            <>
              {t("categories.section.income")}
              {!phone && count(sections.income.groups.length)}
            </>
          ),
        },
      ]}
    />
  );
  const unusedChip = unusedCount > 0 && (
    <UnstyledButton
      className={classes.chip}
      aria-pressed={unusedOnly}
      onClick={() => setUnusedOnly((v) => !v)}
    >
      {phone ? t("categories.filter.unusedShort") : t("categories.filter.unused")}
      <em>{unusedCount}</em>
    </UnstyledButton>
  );
  const searchBox = (
    <TextInput
      className={classes.search}
      leftSection={<IconSearch size={16} />}
      placeholder={t("categories.find")}
      aria-label={t("categories.find")}
      value={search}
      onChange={(e) => setSearch(e.currentTarget.value)}
    />
  );
  const views = (
    <SegmentedControl
      value={view}
      onChange={(v) => setView(v as View)}
      aria-label={t("categories.view.label")}
      data={[
        {
          value: "rows",
          label: (
            <span className={classes.viewLabel}>
              <IconLayoutList size={15} aria-hidden />
              {t("categories.view.rows")}
            </span>
          ),
        },
        {
          value: "index",
          label: (
            <span className={classes.viewLabel}>
              <IconLayoutColumns size={15} aria-hidden />
              {t("categories.view.index")}
            </span>
          ),
        },
      ]}
    />
  );

  const viewProps = { sections: shown, format, since, actions };
  const list =
    shown.length === 0 ? (
      <div className={classes.card}>
        <div className={classes.none}>{t("categories.noMatch")}</div>
      </div>
    ) : phone ? (
      <CategoryPhoneList {...viewProps} />
    ) : view === "index" ? (
      <CategoryIndex {...viewProps} />
    ) : (
      <CategoryRows
        {...viewProps}
        // A search shows every match, whatever was folded.
        collapsed={search.trim() ? new Set() : collapsed}
        onToggle={toggle}
      />
    );

  return (
    <Stack className={`${classes.page} ${phone ? classes.phone : ""}`} gap="md">
      <PageHeader
        title={t("categories.title")}
        hint={t("categories.hint")}
        actions={categories.length > 0 ? addButton : undefined}
      />

      {categories.length === 0 && query.isSuccess && (
        <EmptyState
          icon={IconCategory}
          message={t("categories.empty")}
          hint={t("categories.emptyHint")}
          action={addButton}
        />
      )}

      {categories.length > 0 && (
        <>
          {phone ? (
            <>
              {searchBox}
              <div className={classes.bar}>
                {kinds}
                {unusedChip}
              </div>
            </>
          ) : (
            <div className={classes.bar}>
              {searchBox}
              {kinds}
              {unusedChip}
              <span className={classes.period}>{t("categories.period")}</span>
              {views}
            </div>
          )}
          {list}
        </>
      )}

      <CategorySheet
        opened={sheetOpen}
        onClose={() => setSheetOpen(false)}
        walletId={walletId}
        editing={editing}
        presetParent={presetParent}
        categories={categories}
        node={editing ? nodeOf(editing.id) : null}
        today={today}
        format={format}
        onSaved={invalidate}
        onAddSub={actions.onAddSub}
        onMerge={actions.onMerge}
        onDelete={actions.onDelete}
      />
      <MergeModal
        key={`merge-${mergeFrom?.id ?? "none"}`}
        title={t("categories.mergeTitle")}
        source={mergeFrom}
        options={categories
          .filter((c) => c.id !== mergeFrom?.id)
          .map((c) => ({ value: String(c.id), label: c.name }))}
        onClose={() => setMergeFrom(null)}
        onMerge={(targetId) =>
          mergeCategory(walletId, mergeFrom!.id, targetId)
            .then(() => {
              setMergeFrom(null);
              invalidate();
            })
            .catch(onError)
        }
      />
      <DeleteCategoryModal
        key={`delete-${deleteTarget?.id ?? "none"}`}
        category={deleteTarget}
        hasChildren={deleteTarget ? categories.some((c) => c.parentId === deleteTarget.id) : false}
        topLevelTargets={tops
          .filter((c) => c.id !== deleteTarget?.id)
          .map((c) => ({ value: String(c.id), label: c.name }))}
        onClose={() => setDeleteTarget(null)}
        onDelete={(reassignTo) => remove.mutate({ id: deleteTarget!.id, reassignTo })}
        pending={remove.isPending}
      />
    </Stack>
  );
}
