import {
  ActionIcon,
  Anchor,
  Button,
  Input,
  Menu,
  SegmentedControl,
  Select,
  Switch,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDots } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  ApiError,
  createCategory,
  updateCategory,
  type Category,
  type CategoryInput,
} from "../../api/client";
import { amountColor } from "../../amountTone";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { sameName } from "../../sameName";
import classes from "./categories.module.css";
import type { CategoryNode } from "./categoryTree";
import { useDayMonth, useSince } from "./labels";

const NONE = "none";

/**
 * A category in the sheet beside the page (#552): new, or opened from the list.
 * Its name, the group it sits in — which a subcategory can change, for one
 * filed in the wrong place — whether it counts in the budget and the reports,
 * and what it held over the last twelve months. Merge and Delete wait in the
 * header's menu: they end the category, so they are not a click away.
 */
export function CategorySheet({
  opened,
  onClose,
  walletId,
  editing,
  presetParent,
  categories,
  node,
  today,
  format,
  onSaved,
  onAddSub,
  onMerge,
  onDelete,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Category | null;
  /** A new subcategory's group. */
  presetParent: Category | null;
  categories: Category[];
  /** What the category held in the period; null for a new one. */
  node: CategoryNode | null;
  today: string;
  format: (amount: number) => string;
  onSaved: () => void;
  onAddSub: (group: Category) => void;
  onMerge: (c: Category) => void;
  onDelete: (c: Category) => void;
}) {
  const { t } = useTranslation();
  const day = useDayMonth(today);
  const since = useSince(today);

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(NONE);
  const [isIncome, setIsIncome] = useState(false);
  const [budget, setBudget] = useState(true);
  const [reports, setReports] = useState(true);

  // Seeded on opening, during render rather than in an effect, so the sheet
  // never shows a frame of the category before. The key is null while closed,
  // which is what makes reopening the same category start from it again.
  const openKey = opened ? `${editing?.id ?? "new"}:${presetParent?.id ?? ""}` : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      const parent = editing ? (editing.parentId ?? null) : (presetParent?.id ?? null);
      setName(editing?.name ?? "");
      setParentId(parent != null ? String(parent) : NONE);
      setIsIncome(editing?.isIncome ?? presetParent?.isIncome ?? false);
      setBudget(!(editing?.noBudget ?? false));
      setReports(!(editing?.noReport ?? false));
    }
  }

  const tops = categories.filter((c) => !c.parentId && c.id !== editing?.id);
  const hasSubs = !!editing && categories.some((c) => c.parentId === editing.id);
  const parent = parentId === NONE ? null : (tops.find((c) => String(c.id) === parentId) ?? null);
  const kindIncome = parent ? parent.isIncome : isIncome;
  const duplicate = categories.find(
    (c) =>
      c.id !== editing?.id &&
      (c.parentId ?? null) === (parent?.id ?? null) &&
      sameName(c.name, name),
  );

  const save = useMutation({
    mutationFn: () => {
      const body: CategoryInput = {
        name,
        isIncome: kindIncome,
        noBudget: !budget,
        noReport: !reports,
      };
      // An edit moves the category only when its group changed: without
      // parentId the server leaves it where it is.
      if (!editing || (editing.parentId ?? null) !== (parent?.id ?? null))
        body.parentId = parent?.id ?? null;
      return editing ? updateCategory(walletId, editing.id, body) : createCategory(walletId, body);
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

  const kindLabel = (income: boolean) =>
    income ? t("categories.section.income") : t("categories.section.expense");
  const groupOf = (c: Category) => categories.find((p) => p.id === c.parentId);
  const title = editing
    ? editing.name
    : presetParent
      ? t("categories.sheet.newSub")
      : t("categories.addTitle");
  const subtitle = editing
    ? editing.parentId
      ? t("categories.sheet.inGroup", {
          kind: kindLabel(editing.isIncome),
          group: groupOf(editing)?.name ?? "",
        })
      : t(editing.isIncome ? "categories.sheet.incomeGroup" : "categories.sheet.expenseGroup")
    : presetParent
      ? t("categories.sheet.inGroup", {
          kind: kindLabel(presetParent.isIncome),
          group: presetParent.name,
        })
      : undefined;

  // What it held: a group's figures include its subcategories', as on the list.
  const isGroup = !!editing && !editing.parentId;
  const count = node ? (isGroup ? node.totalCount : node.count) : 0;
  const amount = node ? (isGroup ? node.total : node.amount) : 0;
  const last = node ? (isGroup ? node.lastAny : node.lastDate) : null;
  const reportsLink =
    editing && `/reports?cat=${editing.id}&p=year${editing.isIncome ? "&ty=income" : ""}`;

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="category-sheet"
      title={title}
      subtitle={subtitle}
      headerActions={
        editing && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("categories.actionsFor", { name: editing.name })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {!editing.parentId && (
                <Menu.Item onClick={() => onAddSub(editing)}>{t("categories.addSub")}</Menu.Item>
              )}
              <Menu.Item onClick={() => onMerge(editing)}>{t("categories.merge")}</Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => onDelete(editing)}>
                {t("categories.delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("categories.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || !!duplicate}
          >
            {t("categories.save")}
          </Button>
        </>
      }
    >
      <TextInput
        label={t("categories.name")}
        required
        value={name}
        error={duplicate ? t("categories.duplicate", { name: duplicate.name }) : undefined}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <Select
        label={t("categories.sheet.group")}
        description={hasSubs ? t("categories.sheet.hasSubs") : t("categories.sheet.groupHint")}
        data={[
          { value: NONE, label: t("categories.sheet.noGroup") },
          ...tops.map((c) => ({ value: String(c.id), label: c.name })),
        ]}
        value={parentId}
        onChange={(v) => setParentId(v ?? NONE)}
        disabled={hasSubs}
        inputWrapperOrder={["label", "input", "description"]}
        allowDeselect={false}
        searchable
        comboboxProps={{ withinPortal: true }}
      />
      {!parent && (
        <Input.Wrapper
          label={t("categories.sheet.kind")}
          description={hasSubs ? t("categories.sheet.kindCascades") : undefined}
          inputWrapperOrder={["label", "input", "description"]}
        >
          <SegmentedControl
            fullWidth
            mt={4}
            value={isIncome ? "income" : "expense"}
            onChange={(v) => setIsIncome(v === "income")}
            data={[
              { value: "expense", label: t("categories.section.expense") },
              { value: "income", label: t("categories.section.income") },
            ]}
          />
        </Input.Wrapper>
      )}
      <Switch
        label={t("categories.sheet.budget")}
        description={t("categories.sheet.budgetHint")}
        checked={budget}
        onChange={(e) => setBudget(e.currentTarget.checked)}
      />
      <Switch
        label={t("categories.sheet.reports")}
        description={t("categories.sheet.reportsHint")}
        checked={reports}
        onChange={(e) => setReports(e.currentTarget.checked)}
      />
      {editing && (
        <div className={classes.use} data-testid="category-usage">
          <span className={classes.useLabel}>{t("categories.sheet.lastTwelve")}</span>
          <span
            className={`${classes.useValue} ${classes.mono}`}
            style={{ color: amountColor(amount) }}
          >
            {format(amount)}
          </span>
          <span className={classes.useLabel}>
            {count > 0 && last
              ? t(isGroup ? "categories.sheet.usageGroup" : "categories.sheet.usage", {
                  count,
                  date: day(last),
                })
              : since(last)}
          </span>
          {!editing.noReport && reportsLink && (
            <Anchor component={Link} to={reportsLink} className={classes.useLink}>
              {t("categories.sheet.seeReports")}
            </Anchor>
          )}
        </div>
      )}
    </SideSheet>
  );
}
