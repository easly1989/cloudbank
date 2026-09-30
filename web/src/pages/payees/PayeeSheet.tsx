import { ActionIcon, Anchor, Button, Menu, Select, TextInput, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconDots } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ApiError, createPayee, updatePayee, type Category, type Payee } from "../../api/client";
import { amountColor } from "../../amountTone";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { sameName } from "../../sameName";
import { PAYMENT_MODES } from "../../transactionEnums";
import { categoryLabel, type PayeeRow } from "./payeeList";
import classes from "./payees.module.css";

/** A suggestion under a field: what the payee usually gets, and a button to take it. */
function Suggestion({ text, label, onUse }: { text: string; label: string; onUse: () => void }) {
  return (
    <div className={classes.suggest}>
      <span>{text}</span>
      <UnstyledButton className={classes.useIt} style={{ visibility: "visible" }} onClick={onUse}>
        <IconCheck size={13} />
        {label}
      </UnstyledButton>
    </div>
  );
}

/**
 * A payee in the sheet beside the page (#554): new, or opened from the list.
 * Its name, the category and the payment mode a new transaction from it starts
 * with — each with what it usually gets, offered and never saved on its own —
 * and what it held over the last twelve months. Merge and Delete wait in the
 * header's menu.
 */
export function PayeeSheet({
  opened,
  onClose,
  walletId,
  editing,
  row,
  categories,
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
  editing: Payee | null;
  /** What the payee held in the period; null for a new one. */
  row: PayeeRow | null;
  categories: Category[];
  /** The other payees' names: a name may not repeat one, whatever its case. */
  others: string[];
  format: (amount: number) => string;
  day: (date: string) => string;
  onSaved: () => void;
  onMerge: (p: Payee) => void;
  onDelete: (p: Payee) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState("0");

  // Seeded on opening, during render, so the sheet never shows a frame of the
  // payee before; the key is null while closed, so reopening starts afresh.
  const openKey = opened ? String(editing?.id ?? "new") : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      setName(editing?.name ?? "");
      setCategoryId(editing?.defaultCategoryId != null ? String(editing.defaultCategoryId) : null);
      setPaymentMode(String(editing?.defaultPaymentMode ?? 0));
    }
  }

  const duplicate = others.find((n) => sameName(n, name));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        defaultCategoryId: categoryId ? Number(categoryId) : null,
        // Always sent: without it the server would clear the one it has.
        defaultPaymentMode: paymentMode === "0" ? null : Number(paymentMode),
      };
      return editing ? updatePayee(walletId, editing.id, body) : createPayee(walletId, body);
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
  const mode = row?.usualPaymentMode ?? null;
  const reportsLink =
    editing && `/reports?pe=${editing.id}&p=year${amount > 0 ? "&ty=income" : ""}`;

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="payee-sheet"
      title={editing ? editing.name : t("payees.addTitle")}
      subtitle={
        editing
          ? last
            ? t("payees.sheet.lastUsed", { date: day(last) })
            : t("payees.neverUsed")
          : undefined
      }
      headerActions={
        editing && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("payees.actionsFor", { name: editing.name })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => onMerge(editing)}>{t("payees.merge")}</Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => onDelete(editing)}>
                {t("payees.delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("payees.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || !!duplicate}
          >
            {t("payees.save")}
          </Button>
        </>
      }
    >
      <TextInput
        label={t("payees.name")}
        required
        value={name}
        error={duplicate ? t("payees.duplicate", { name: duplicate }) : undefined}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <div>
        <Select
          label={t("payees.defaultCategory")}
          description={t("payees.sheet.categoryHint")}
          inputWrapperOrder={["label", "input", "description"]}
          placeholder={t("payees.sheet.none")}
          data={categories.map((c) => ({
            value: String(c.id),
            label: categoryLabel(c, categories),
          }))}
          value={categoryId}
          onChange={setCategoryId}
          clearable
          searchable
        />
        {!categoryId && row?.suggested && (
          <Suggestion
            text={t("payees.sheet.suggestCategory", {
              used: row.suggestedCount,
              count: row.count,
              name: row.suggested.name,
            })}
            label={t("payees.useIt")}
            onUse={() => setCategoryId(String(row.suggested!.id))}
          />
        )}
      </div>
      <div>
        <Select
          label={t("payees.sheet.payment")}
          description={t("payees.sheet.paymentHint")}
          inputWrapperOrder={["label", "input", "description"]}
          data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
          value={paymentMode}
          onChange={(v) => setPaymentMode(v ?? "0")}
          allowDeselect={false}
        />
        {paymentMode === "0" && mode != null && (
          <Suggestion
            text={t("payees.sheet.suggestPayment", { mode: t(`paymentModes.${mode}`) })}
            label={t("payees.sheet.usePayment")}
            onUse={() => setPaymentMode(String(mode))}
          />
        )}
      </div>
      {editing && (
        <div className={classes.use} data-testid="payee-usage">
          <span className={classes.useLabel}>{t("payees.sheet.lastTwelve")}</span>
          <span
            className={`${classes.useValue} ${classes.mono}`}
            style={{ color: amountColor(amount) }}
          >
            {format(amount)}
          </span>
          <span className={classes.useLabel}>
            {count > 0 && last
              ? t("payees.sheet.usage", { count, date: day(last) })
              : last
                ? t("payees.notUsedSince", { date: day(last) })
                : t("payees.neverUsed")}
          </span>
          {reportsLink && (
            <Anchor component={Link} to={reportsLink} className={classes.useLink}>
              {t("payees.sheet.seeReports")}
            </Anchor>
          )}
        </div>
      )}
    </SideSheet>
  );
}
