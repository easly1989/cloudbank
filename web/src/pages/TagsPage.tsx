import { Button, Stack, TextInput, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconSearch, IconTags } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  deleteTag,
  getTagActivity,
  listCategories,
  listTagsWithCounts,
  mergeTag,
  type TagInfo,
} from "../api/client";
import { useConfirm } from "../components/confirmContext";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { formatMinor, type MoneyFormat } from "../money";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import { MergeModal } from "./categories/CategoryModals";
import { lastTwelveMonths } from "./categories/categoryTree";
import { useDayMonth } from "./categories/labels";
import { arrange, buildRows, DEFAULT_SORT, isUnused, type Sort } from "./tags/tagList";
import classes from "./tags/tags.module.css";
import { TagSheet } from "./tags/TagSheet";
import { TagPhoneList, TagTable } from "./tags/TagTable";

/** Plain two-decimal numbers, for a wallet with no base currency yet. */
const PLAIN: MoneyFormat = {
  fracDigits: 2,
  decimalChar: ".",
  groupChar: ",",
  symbol: "",
  symbolPrefix: false,
};

/**
 * Tags (#556): every tag with what it held over the last twelve months and the
 * categories its transactions were mostly in. A tag opens in the sheet beside
 * the page, where it is renamed; Add makes one before any transaction has it.
 */
export function TagsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const today = useToday();
  const day = useDayMonth(today);
  const { from, to } = useMemo(() => lastTwelveMonths(today), [today]);

  const tagsQuery = useQuery({
    queryKey: ["tagsManage", walletId],
    queryFn: () => listTagsWithCounts(walletId),
    enabled: walletId > 0,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled: walletId > 0,
  });
  const activityQuery = useQuery({
    queryKey: ["tag-activity", walletId, from, to],
    queryFn: () => getTagActivity(walletId, from, to),
    enabled: walletId > 0,
  });
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data]);
  const rows = useMemo(
    () => buildRows(tags, activityQuery.data?.tags ?? [], categoriesQuery.data ?? []),
    [tags, activityQuery.data, categoriesQuery.data],
  );
  const format = useMemo(() => {
    const fmt = activityQuery.data?.currency ?? PLAIN;
    return (amount: number) => formatMinor(amount, fmt);
  }, [activityQuery.data]);

  const [search, setSearch] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const unusedCount = rows.filter(isUnused).length;
  const shown = useMemo(
    () => arrange(rows, { query: search, unusedOnly: unusedOnly && unusedCount > 0 }, sort),
    [rows, search, unusedOnly, unusedCount, sort],
  );

  // "tags" is the entry sheet's list of names to suggest.
  const invalidate = () => {
    for (const key of ["tagsManage", "tags", "tag-activity"])
      void qc.invalidateQueries({ queryKey: [key, walletId] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<TagInfo | null>(null);
  const [mergeFrom, setMergeFrom] = useState<TagInfo | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => deleteTag(walletId, id),
    onSuccess: invalidate,
    onError,
  });

  const actions = {
    onOpen: (tag: TagInfo) => {
      setEditing(tag);
      setSheetOpen(true);
    },
    onMerge: (tag: TagInfo) => {
      setSheetOpen(false);
      setMergeFrom(tag);
    },
    onDelete: (tag: TagInfo) => void askDelete(tag),
  };
  const askDelete = async (tag: TagInfo) => {
    setSheetOpen(false);
    const ok = await confirm({
      title: t("tags.confirmDeleteTitle", { name: tag.name }),
      body: t("tags.confirmDeleteBody"),
      confirmLabel: t("tags.delete"),
      danger: true,
    });
    if (ok) remove.mutate(tag.id);
  };

  if (!currentWallet) return null;

  // One button, shown in the header or in the empty state — never both.
  const addButton = (
    <Button
      onClick={() => {
        setEditing(null);
        setSheetOpen(true);
      }}
    >
      {t("tags.add")}
    </Button>
  );
  const searchBox = (
    <TextInput
      className={classes.search}
      leftSection={<IconSearch size={16} />}
      placeholder={t("tags.find")}
      aria-label={t("tags.find")}
      value={search}
      onChange={(e) => setSearch(e.currentTarget.value)}
    />
  );
  const chip =
    unusedCount > 0 ? (
      <UnstyledButton
        className={classes.chip}
        aria-pressed={unusedOnly}
        onClick={() => setUnusedOnly((v) => !v)}
      >
        {phone ? t("tags.filter.unusedShort") : t("tags.filter.unused")}
        <em>{unusedCount}</em>
      </UnstyledButton>
    ) : null;

  const tableProps = { rows: shown, format, day, actions };
  const editingRow = editing ? (rows.find((r) => r.tag.id === editing.id) ?? null) : null;

  return (
    <Stack className={`${classes.page} ${phone ? classes.phone : ""}`} gap="md">
      <PageHeader
        title={t("tags.title")}
        hint={t("tags.hint")}
        actions={tags.length > 0 ? addButton : undefined}
      />

      {tags.length === 0 && tagsQuery.isSuccess && (
        <EmptyState
          icon={IconTags}
          message={t("tags.empty")}
          hint={t("tags.emptyHint")}
          action={addButton}
        />
      )}

      {tags.length > 0 && (
        <>
          {phone ? (
            <>
              {searchBox}
              {chip && <div className={classes.bar}>{chip}</div>}
            </>
          ) : (
            <div className={classes.bar}>
              {searchBox}
              {chip}
              <span className={classes.period}>{t("tags.period")}</span>
            </div>
          )}
          {shown.length === 0 ? (
            <div className={classes.card}>
              <div className={classes.none}>{t("tags.noMatch")}</div>
            </div>
          ) : phone ? (
            <TagPhoneList {...tableProps} />
          ) : (
            <TagTable {...tableProps} sort={sort} onSort={setSort} />
          )}
        </>
      )}

      <TagSheet
        opened={sheetOpen}
        onClose={() => setSheetOpen(false)}
        walletId={walletId}
        editing={editing}
        row={editingRow}
        others={tags.filter((x) => x.id !== editing?.id).map((x) => x.name)}
        format={format}
        day={day}
        onSaved={invalidate}
        onMerge={actions.onMerge}
        onDelete={actions.onDelete}
      />
      <MergeModal
        key={`merge-${mergeFrom?.id ?? "none"}`}
        title={t("tags.mergeTitle")}
        source={mergeFrom}
        options={tags
          .filter((x) => x.id !== mergeFrom?.id)
          .map((x) => ({ value: String(x.id), label: x.name }))}
        onClose={() => setMergeFrom(null)}
        onMerge={(targetId) =>
          mergeTag(walletId, mergeFrom!.id, targetId)
            .then(() => {
              setMergeFrom(null);
              invalidate();
            })
            .catch(onError)
        }
      />
    </Stack>
  );
}
