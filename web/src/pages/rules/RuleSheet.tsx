import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Menu,
  SegmentedControl,
  Select,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconDots } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  createAssignment,
  listTags,
  testAssignment,
  updateAssignment,
  type Assignment,
  type AssignmentInput,
  type MatchField,
  type MatchType,
} from "../../api/client";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { PAYMENT_MODES } from "../../transactionEnums";
import { categoryLabel } from "../payees/payeeList";
import type { Lookups, RuleActions } from "./RuleTable";
import classes from "./rules.module.css";

const FIELDS: MatchField[] = ["memo", "payee", "both", "tag"];
const TYPES: MatchType[] = ["contains", "exact", "regex"];

/**
 * A rule in the sheet beside the page (#566): what it looks for, what it sets
 * and when it runs, then a live preview of what it would match. The preview is
 * a dry run: nothing changes until the rule is saved, and a saved rule fills
 * in what is already there only when it is applied.
 */
export function RuleSheet({
  opened,
  onClose,
  walletId,
  editing,
  position,
  count,
  lookups,
  day,
  onSaved,
  actions,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Assignment | null;
  /** The rule's place in the order, from 1. */
  position: number;
  count: number;
  lookups: Lookups;
  day: (date: string) => string;
  onSaved: () => void;
  actions: Pick<RuleActions, "onApply" | "onDelete">;
}) {
  const { t } = useTranslation();
  const { accounts, categories, payees } = lookups;

  const [matchField, setMatchField] = useState<MatchField>("memo");
  const [matchType, setMatchType] = useState<MatchType>("contains");
  const [pattern, setPattern] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchAccountId, setMatchAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [onManual, setOnManual] = useState(true);
  const [onImport, setOnImport] = useState(true);

  // Seeded on opening, during render, so the sheet never shows a frame of the
  // rule before; the key is null while closed, so reopening starts afresh.
  const openKey = opened ? String(editing?.id ?? "new") : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      const r = editing;
      const id = (v?: number | null) => (v != null ? String(v) : null);
      setMatchField(r?.matchField ?? "memo");
      setMatchType(r?.matchType ?? "contains");
      setPattern(r?.pattern ?? "");
      setCaseSensitive(r?.caseSensitive ?? false);
      setMatchAccountId(id(r?.matchAccountId));
      setCategoryId(id(r?.setCategoryId));
      setPayeeId(id(r?.setPayeeId));
      setPaymentMode(id(r?.setPaymentMode));
      setInfo(r?.setInfo ?? "");
      setTags(r?.setTags ?? []);
      setOnManual(r?.applyOnManual ?? true);
      setOnImport(r?.applyOnImport ?? true);
    }
  }

  const tagsQuery = useQuery({
    queryKey: ["tags", walletId],
    queryFn: () => listTags(walletId),
    enabled: opened && walletId > 0,
  });

  // Every field, always: a save replaces the whole rule.
  const body: AssignmentInput = {
    matchField,
    matchType,
    pattern,
    caseSensitive,
    matchAccountId: matchAccountId ? Number(matchAccountId) : null,
    setPayeeId: payeeId ? Number(payeeId) : null,
    setCategoryId: categoryId ? Number(categoryId) : null,
    setPaymentMode: paymentMode != null ? Number(paymentMode) : null,
    setInfo: info.trim() ? info.trim() : null,
    setTags: tags,
    applyOnManual: onManual,
    applyOnImport: onImport,
  };

  // The preview follows the fields as they are typed, a moment behind. The
  // text is what is debounced: a fresh object every render would restart it.
  const [probe] = useDebouncedValue(JSON.stringify({ ...body, id: editing?.id }), 300);
  const preview = useQuery({
    queryKey: ["assignment-test", walletId, probe],
    queryFn: () => testAssignment(walletId, JSON.parse(probe) as AssignmentInput & { id?: number }),
    enabled: opened && pattern.trim() !== "",
    retry: false,
    placeholderData: keepPreviousData,
  });

  const save = useMutation({
    mutationFn: () =>
      editing ? updateAssignment(walletId, editing.id, body) : createAssignment(walletId, body),
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

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: String(c.id), label: categoryLabel(c, categories) })),
    [categories],
  );
  const catName = (id?: number | null) => {
    const c = categories.find((x) => x.id === id);
    return c ? categoryLabel(c, categories) : null;
  };

  const res = preview.isError ? undefined : preview.data;
  const badRegex = preview.error instanceof ApiError && preview.error.code === "invalid_regex";

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="rule-sheet"
      title={editing ? t("assignments.editTitle") : t("assignments.addTitle")}
      subtitle={
        editing
          ? position === 1
            ? t("assignments.positionFirst", { count })
            : t("assignments.position", { n: position, count })
          : undefined
      }
      headerActions={
        editing && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("assignments.actions", { n: position })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item disabled={!editing.matches} onClick={() => actions.onApply(editing)}>
                {t("assignments.menu.apply")}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => actions.onDelete(editing)}>
                {t("assignments.menu.delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("assignments.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!pattern.trim()}>
            {t("assignments.save")}
          </Button>
        </>
      }
    >
      <span className={classes.section}>{t("assignments.sectionWhen")}</span>
      <div>
        <Text size="sm" fw={500} mb={5} component="label" id="rule-look-in">
          {t("assignments.lookIn")}
        </Text>
        <SegmentedControl
          fullWidth
          aria-labelledby="rule-look-in"
          value={matchField}
          onChange={(v) => setMatchField(v as MatchField)}
          data={FIELDS.map((f) => ({ value: f, label: t(`assignments.lookInOpt.${f}`) }))}
        />
      </div>
      <div className={classes.pair} style={{ gap: ENTRY_SHEET.pairGap }}>
        <Select
          label={t("assignments.matchType")}
          data={TYPES.map((ty) => ({ value: ty, label: t(`assignments.typeOpt.${ty}`) }))}
          value={matchType}
          allowDeselect={false}
          onChange={(v) => v && setMatchType(v as MatchType)}
        />
        <TextInput
          label={matchField === "tag" ? t("assignments.tagText") : t("assignments.pattern")}
          value={pattern}
          onChange={(e) => setPattern(e.currentTarget.value)}
          error={badRegex ? t("assignments.badRegex") : undefined}
          data-autofocus
        />
      </div>
      <Checkbox
        label={t("assignments.caseSensitive")}
        checked={caseSensitive}
        onChange={(e) => setCaseSensitive(e.currentTarget.checked)}
      />
      <Select
        label={t("assignments.matchAccount")}
        placeholder={t("assignments.anyAccount")}
        data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
        value={matchAccountId}
        onChange={setMatchAccountId}
        clearable
        searchable
      />

      <span className={classes.section}>{t("assignments.sectionThen")}</span>
      <Select
        label={t("assignments.setCategory")}
        placeholder={t("assignments.leaveAsIs")}
        data={categoryOptions}
        value={categoryId}
        onChange={setCategoryId}
        clearable
        searchable
      />
      <Select
        label={t("assignments.setPayee")}
        placeholder={t("assignments.leaveAsIs")}
        data={payees.map((p) => ({ value: String(p.id), label: p.name }))}
        value={payeeId}
        onChange={setPayeeId}
        clearable
        searchable
      />
      <Group grow gap={ENTRY_SHEET.pairGap} align="flex-start" wrap="nowrap">
        <Select
          label={t("assignments.setPaymentMode")}
          placeholder={t("assignments.leaveAsIs")}
          data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
          value={paymentMode}
          onChange={setPaymentMode}
          clearable
        />
        <TextInput
          label={t("assignments.setInfo")}
          placeholder={t("assignments.setInfoPlaceholder")}
          value={info}
          onChange={(e) => setInfo(e.currentTarget.value)}
        />
      </Group>
      <TagsInput
        label={t("assignments.setTags")}
        description={t("assignments.setTagsHint")}
        data={tagsQuery.data ?? []}
        value={tags}
        onChange={setTags}
      />

      <span className={classes.section}>{t("assignments.sectionUse")}</span>
      <Checkbox
        label={t("assignments.onManual")}
        checked={onManual}
        onChange={(e) => setOnManual(e.currentTarget.checked)}
      />
      <Checkbox
        label={t("assignments.onImport")}
        checked={onImport}
        onChange={(e) => setOnImport(e.currentTarget.checked)}
      />

      <div className={classes.preview} data-testid="rule-preview">
        {!pattern.trim() || !res ? (
          <>
            <span className={`${classes.previewCount} ${classes.dim}`}>
              {t("assignments.previewEmpty")}
            </span>
            <span className={classes.previewNote}>{t("assignments.previewEmptyHint")}</span>
          </>
        ) : (
          <>
            <span className={classes.previewCount}>
              {res.count === 0
                ? t("assignments.previewNone")
                : t("assignments.previewCount", { count: res.count })}
            </span>
            <span className={classes.previewNote}>
              {res.taken > 0 && (
                <span className={classes.attention}>
                  {t("assignments.previewTaken", { count: res.taken })}{" "}
                </span>
              )}
              {res.withoutCategory > 0 && (
                <span className={classes.attention}>
                  {t("assignments.previewNoCategory", { count: res.withoutCategory })}{" "}
                </span>
              )}
              {t("assignments.previewNote")}
            </span>
            {res.latest.map((m) => (
              <div key={m.id} className={classes.hit}>
                <span className={classes.dim}>{day(m.date)}</span>
                <span>
                  {m.payeeName || m.memo}
                  {m.payeeName && m.memo && <span className={classes.dim}> · {m.memo}</span>}
                </span>
                <span className={m.categoryId ? classes.dim : classes.attention}>
                  {catName(m.categoryId) ?? t("assignments.noCategory")}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </SideSheet>
  );
}
