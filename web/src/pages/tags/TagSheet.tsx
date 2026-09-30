import { ActionIcon, Anchor, Button, Menu, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDots } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ApiError, createTag, renameTag, type TagInfo } from "../../api/client";
import { amountColor } from "../../amountTone";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { takenBy, type TagRow } from "./tagList";
import classes from "./tags.module.css";

/**
 * A tag in the sheet beside the page (#556): new, or opened from the list. Its
 * name — renaming it renames it on every transaction — and what it held over
 * the last twelve months, with the categories it was mostly in. Merge and
 * Delete wait in the header's menu.
 */
export function TagSheet({
  opened,
  onClose,
  walletId,
  editing,
  row,
  others,
  format,
  day,
  onSaved,
  onMerge,
  onDelete,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: TagInfo | null;
  /** What the tag held in the period; null for a new one. */
  row: TagRow | null;
  /** The other tags' names: a name may not repeat one. */
  others: string[];
  format: (amount: number) => string;
  day: (date: string) => string;
  onSaved: () => void;
  onMerge: (t: TagInfo) => void;
  onDelete: (t: TagInfo) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");

  // Seeded on opening, during render, so the sheet never shows a frame of the
  // tag before; the key is null while closed, so reopening starts afresh.
  const openKey = opened ? String(editing?.id ?? "new") : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) setName(editing?.name ?? "");
  }

  const duplicate = takenBy(others, name);
  const save = useMutation({
    mutationFn: async () => {
      const next = name.trim();
      if (!editing) await createTag(walletId, next);
      else if (next !== editing.name) await renameTag(walletId, editing.id, next);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const count = row?.count ?? 0;
  const amount = row?.amount ?? 0;
  const last = row?.lastDate ?? null;
  const reportsLink =
    editing &&
    `/reports?tg=${encodeURIComponent(editing.name)}&p=year${amount > 0 ? "&ty=income" : ""}`;

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="tag-sheet"
      title={editing ? editing.name : t("tags.addTitle")}
      subtitle={
        editing
          ? last
            ? t("tags.sheet.lastUsed", { date: day(last) })
            : t("tags.neverUsed")
          : undefined
      }
      headerActions={
        editing && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("tags.actionsFor", { name: editing.name })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => onMerge(editing)}>{t("tags.merge")}</Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => onDelete(editing)}>
                {t("tags.delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("tags.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || !!duplicate}
          >
            {t("tags.save")}
          </Button>
        </>
      }
    >
      <TextInput
        label={t("tags.name")}
        required
        description={editing ? t("tags.sheet.renameHint") : t("tags.sheet.newHint")}
        inputWrapperOrder={["label", "input", "description", "error"]}
        value={name}
        error={duplicate ? t("tags.duplicate", { name: duplicate }) : undefined}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim() && !duplicate) save.mutate();
        }}
        data-autofocus
      />
      {editing && (
        <div className={classes.use} data-testid="tag-usage">
          <span className={classes.useLabel}>{t("tags.sheet.lastTwelve")}</span>
          <span
            className={`${classes.useValue} ${classes.mono}`}
            style={{ color: amountColor(amount) }}
          >
            {format(amount)}
          </span>
          <span className={classes.useLabel}>
            {count > 0 && last
              ? t("tags.sheet.usage", { count, date: day(last) })
              : last
                ? t("tags.notUsedSince", { date: day(last) })
                : t("tags.neverUsed")}
          </span>
          {row && row.categories.length > 0 && (
            <div className={classes.cats} aria-label={t("tags.col.mostlyIn")}>
              {row.categories.map((c) => (
                <div key={c.category.id}>
                  <span>{c.category.name}</span>
                  <span className={`${classes.mono} ${classes.dim}`}>{c.count}</span>
                </div>
              ))}
            </div>
          )}
          {reportsLink && (
            <Anchor component={Link} to={reportsLink} className={classes.useLink}>
              {t("tags.sheet.seeReports")}
            </Anchor>
          )}
        </div>
      )}
    </SideSheet>
  );
}
