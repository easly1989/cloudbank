import {
  ActionIcon,
  Anchor,
  Button,
  Checkbox,
  CopyButton,
  Group,
  Menu,
  Select,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy, IconDots } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  createAccount,
  updateAccount,
  type Account,
  type AccountInput,
  type AccountType,
  type Currency,
} from "../../api/client";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { formatMinor, minorToInput } from "../../money";
import { PAYMENT_MODES } from "../../transactionEnums";
import { sensitive } from "../../privacy";
import { useAmountParser } from "../../useAmountParser";
import { accountFormat, ACCOUNT_TYPES, hasValuations } from "./accountList";
import type { AccountActions } from "./AccountTable";
import classes from "./accounts.module.css";
import { compactCode, groupIban, isBankType, looksLikeIban, validBic, validIban } from "./iban";
import { notifyError } from "../../notifyError";

/**
 * An account in the sheet beside the page (#564): new, or opened from its ⋯.
 * Every field the account keeps — what leaves it out of the totals, the budget
 * and the reports, and its notes too, which the old dialog neither showed nor
 * sent, so a save wiped them. Its three balances and a way to its register at
 * the foot; Valuations and Delete in the header's menu.
 */
export function AccountSheet({
  opened,
  onClose,
  walletId,
  editing,
  currencies,
  day,
  onSaved,
  actions,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Account | null;
  currencies: Currency[];
  day: (date: string) => string;
  onSaved: () => void;
  actions: Pick<AccountActions, "onValuations" | "onDelete">;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const base = currencies.find((c) => c.isBase);

  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("bank");
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const [initial, setInitial] = useState("");
  const [minimum, setMinimum] = useState("");
  const [institution, setInstitution] = useState("");
  const [number, setNumber] = useState("");
  const [bic, setBic] = useState("");
  const [defaultPaymentMode, setDefaultPaymentMode] = useState("0");
  const [noSummary, setNoSummary] = useState(false);
  const [noBudget, setNoBudget] = useState(false);
  const [noReport, setNoReport] = useState(false);
  const [notes, setNotes] = useState("");
  const [closed, setClosed] = useState(false);

  // Seeded on opening, during render, so the sheet never shows a frame of the
  // account before; the key is null while closed, so reopening starts afresh.
  const openKey = opened ? String(editing?.id ?? "new") : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      const a = editing;
      const cur = currencies.find((c) => c.id === (a?.currencyId ?? base?.id));
      const field = (minor?: number) =>
        a && minor != null
          ? minorToInput(minor, cur?.fracDigits ?? 2, cur?.decimalChar ?? ".")
          : "";
      setName(a?.name ?? "");
      setType(a?.type ?? "bank");
      setCurrencyId(cur ? String(cur.id) : null);
      setInitial(field(a?.initialBalance));
      setMinimum(field(a?.minimumBalance));
      setInstitution(a?.institution ?? "");
      // A bank account's IBAN reads in groups of four; the server keeps it compact.
      const n = a?.number ?? "";
      setNumber(a && isBankType(a.type) && validIban(n) ? groupIban(n) : n);
      setBic(a?.bic ?? "");
      setDefaultPaymentMode(String(a?.defaultPaymentMode ?? 0));
      setNoSummary(a?.noSummary ?? false);
      setNoBudget(a?.noBudget ?? false);
      setNoReport(a?.noReport ?? false);
      setNotes(a?.notes ?? "");
      setClosed(a?.closed ?? false);
    }
  }
  // The currencies can land after the sheet opened: a new account takes the base.
  if (opened && currencyId === null && base) setCurrencyId(String(base.id));

  const selected = currencies.find((c) => String(c.id) === currencyId);
  const fd = selected?.fracDigits ?? 2;
  const dc = selected?.decimalChar ?? ".";

  // A bank account keeps its IBAN in the number, and a BIC (#775). Both are
  // optional; one that starts like an IBAN has to be one.
  const bank = isBankType(type);
  const ibanBad = bank && looksLikeIban(number) && !validIban(number);
  const bicBad = bank && !validBic(bic);

  const save = useMutation({
    mutationFn: () => {
      // A save replaces the whole account, so every field is sent — the group
      // and the website too, which the page does not edit (#564).
      const body: AccountInput = {
        name: name.trim(),
        type,
        currencyId: currencyId ? Number(currencyId) : undefined,
        institution,
        number,
        bic: bank ? bic : "",
        initialBalance: parseAmount(initial, fd, dc) ?? 0,
        minimumBalance: parseAmount(minimum, fd, dc) ?? 0,
        closed,
        noSummary,
        noBudget,
        noReport,
        groupName: editing?.groupName ?? "",
        notes,
        website: editing?.website ?? "",
        defaultPaymentMode: Number(defaultPaymentMode),
      };
      return editing ? updateAccount(walletId, editing.id, body) : createAccount(walletId, body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) => notifyError(err),
  });

  const fmt = editing ? accountFormat(editing) : null;
  const subtitle = editing
    ? [
        t(`accounts.types.${editing.type}`),
        editing.institution,
        editing.lastReconciled
          ? t("accounts.reconciledOn", { date: day(editing.lastReconciled) })
          : t("accounts.neverReconciled"),
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="account-sheet"
      title={editing ? editing.name : t("accounts.addTitle")}
      subtitle={subtitle}
      headerActions={
        editing && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("accounts.actions", { name: editing.name })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {hasValuations(editing) && (
                <Menu.Item onClick={() => actions.onValuations(editing)}>
                  {t("valuations.manage")}
                </Menu.Item>
              )}
              {hasValuations(editing) && <Menu.Divider />}
              <Menu.Item color="red" onClick={() => actions.onDelete(editing)}>
                {t("accounts.confirmDeleteAction")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("accounts.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || ibanBad || bicBad}
          >
            {t("accounts.save")}
          </Button>
        </>
      }
    >
      <TextInput
        label={t("accounts.name")}
        required
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <Group grow gap={ENTRY_SHEET.pairGap} align="flex-start" wrap="nowrap">
        <Select
          label={t("accounts.type")}
          data={ACCOUNT_TYPES.map((ty) => ({ value: ty, label: t(`accounts.types.${ty}`) }))}
          value={type}
          allowDeselect={false}
          onChange={(v) => v && setType(v as AccountType)}
        />
        <Select
          label={t("accounts.currency")}
          data={currencies.map((c) => ({ value: String(c.id), label: `${c.isoCode} — ${c.name}` }))}
          value={currencyId}
          allowDeselect={false}
          onChange={setCurrencyId}
        />
      </Group>
      <Group grow gap={ENTRY_SHEET.pairGap} align="flex-start" wrap="nowrap">
        <TextInput
          label={t("accounts.initialBalance")}
          value={initial}
          onChange={(e) => setInitial(e.currentTarget.value)}
          inputMode="decimal"
        />
        <TextInput
          label={t("accounts.minimumBalance")}
          value={minimum}
          onChange={(e) => setMinimum(e.currentTarget.value)}
          inputMode="decimal"
        />
      </Group>
      <Group grow gap={ENTRY_SHEET.pairGap} align="flex-start" wrap="nowrap">
        <TextInput
          label={t("accounts.institution")}
          value={institution}
          onChange={(e) => setInstitution(e.currentTarget.value)}
        />
        {bank ? (
          <TextInput
            label={t("accounts.bic")}
            value={bic}
            onChange={(e) => setBic(e.currentTarget.value)}
            onBlur={() => setBic((v) => compactCode(v))}
            error={bicBad ? t("accounts.bicInvalid") : undefined}
            autoComplete="off"
            {...sensitive}
          />
        ) : (
          <TextInput
            label={t("accounts.number")}
            value={number}
            onChange={(e) => setNumber(e.currentTarget.value)}
            {...sensitive}
          />
        )}
      </Group>
      {bank && (
        <TextInput
          label={t("accounts.iban")}
          value={number}
          onChange={(e) => setNumber(e.currentTarget.value)}
          // Printed in groups of four once it is a real IBAN; saved without spaces.
          onBlur={() => validIban(number) && setNumber(groupIban(number))}
          error={ibanBad ? t("accounts.ibanInvalid") : undefined}
          description={number.trim() === "" ? t("accounts.ibanMissing") : undefined}
          autoComplete="off"
          {...sensitive}
          rightSection={
            number.trim() !== "" && !ibanBad ? (
              <CopyButton value={compactCode(number)}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? t("accounts.copied") : t("accounts.copy")} withinPortal>
                    <ActionIcon
                      variant="subtle"
                      color={copied ? "teal" : "gray"}
                      onClick={copy}
                      aria-label={t("accounts.copy")}
                    >
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            ) : undefined
          }
        />
      )}
      <Select
        label={t("accounts.defaultPaymentMode")}
        data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
        value={defaultPaymentMode}
        allowDeselect={false}
        onChange={(v) => v && setDefaultPaymentMode(v)}
      />
      <span className={classes.section}>{t("accounts.leaveOut")}</span>
      <Checkbox
        label={t("accounts.leaveOutTotals")}
        checked={noSummary}
        onChange={(e) => setNoSummary(e.currentTarget.checked)}
      />
      <Checkbox
        label={t("accounts.leaveOutBudget")}
        checked={noBudget}
        onChange={(e) => setNoBudget(e.currentTarget.checked)}
      />
      <Checkbox
        label={t("accounts.leaveOutReports")}
        checked={noReport}
        onChange={(e) => setNoReport(e.currentTarget.checked)}
      />
      <TextInput
        label={t("accounts.notes")}
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
      />
      <Checkbox
        label={t("accounts.closedHint")}
        checked={closed}
        onChange={(e) => setClosed(e.currentTarget.checked)}
      />
      {editing && fmt && (
        <>
          <div className={classes.figs} data-testid="account-figures">
            <div>
              <span>{t("accounts.col.reconciled")}</span>
              <b className={classes.mono}>{formatMinor(editing.reconciledBalance, fmt)}</b>
            </div>
            <div>
              <span>{t("accounts.col.today")}</span>
              <b className={classes.mono}>{formatMinor(editing.balance, fmt)}</b>
            </div>
            <div>
              <span>{t("accounts.col.future")}</span>
              <b className={classes.mono}>{formatMinor(editing.futureBalance, fmt)}</b>
            </div>
          </div>
          <Anchor
            component={Link}
            to={`/transactions?account=${editing.id}`}
            className={classes.link}
          >
            {t("accounts.openRegister")}
          </Anchor>
        </>
      )}
    </SideSheet>
  );
}
