import { Button, Group, Select, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { deleteWallet, listCategories, updateWallet, type WalletInput } from "../../api/client";
import { errorColor } from "../../amountTone";
import { useAuth } from "../../auth/AuthProvider";
import { notifyError } from "../../notifyError";
import { useWallet } from "../../wallet/WalletProvider";
import { BackupRows } from "../BackupCard";
import { ImportExport } from "../ImportPage";
import { IntegrityRow } from "../IntegrityCard";
import { AutoField } from "./AutoField";
import { backupAgeDays, backupAgeText, backupStale } from "./backupAge";
import { DefaultAccountRow } from "./PreferenceRows";
import { RelatedSettings, SettingRow, SettingsGroup, SettingState } from "./SettingRow";

const AHEAD = ["0", "1", "2", "3"] as const;
const aheadKey = (v: string) =>
  v === "0" ? "wallet.scheduleAheadOff" : `wallet.scheduleAhead${v}`;

/**
 * Settings › Wallet (#800): everything that acts on the open wallet, in one
 * place. What it is called and whose it is, the account entries start in,
 * what CloudBank records by itself; then getting data in and out; then
 * deleting it. Every field saves when it changes; only the owner changes them.
 */
export function WalletSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { currentWallet: w } = useWallet();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  // The selects show the pick at once; a refusal puts the stored one back.
  const [months, setMonths] = useState(String(w?.schedulePostMonths ?? 0));
  const [bills, setBills] = useState(w?.billsCategoryId ? String(w.billsCategoryId) : "");
  const [seen, setSeen] = useState(w);
  if (w !== seen) {
    setSeen(w);
    setMonths(String(w?.schedulePostMonths ?? 0));
    setBills(w?.billsCategoryId ? String(w.billsCategoryId) : "");
  }

  const categories = useQuery({
    queryKey: ["categories", w?.id ?? 0],
    queryFn: () => listCategories(w!.id),
    enabled: !!w,
  });

  // The server replaces the whole wallet, so a change goes with the rest.
  const save = useMutation({
    mutationFn: (patch: Partial<WalletInput>) =>
      updateWallet(w!.id, {
        title: w!.title,
        ownerName: w!.ownerName,
        schedulePostMonths: w!.schedulePostMonths,
        billsCategoryId: w!.billsCategoryId ?? null,
        ...patch,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallets"] }),
  });
  const pick = (patch: Partial<WalletInput>) =>
    save.mutate(patch, {
      onError: (err) => {
        setMonths(String(w?.schedulePostMonths ?? 0));
        setBills(w?.billsCategoryId ? String(w.billsCategoryId) : "");
        notifyError(err);
      },
    });

  const remove = useMutation({
    mutationFn: () => deleteWallet(w!.id),
    onSuccess: async () => {
      localStorage.removeItem("cb.currentWalletId");
      await qc.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: notifyError,
  });

  if (!w) return null;
  const isOwner = w.role === "owner";
  const days = backupAgeDays(user, w.id);
  const categoryOptions = [
    { value: "", label: t("wallet.billsCategoryNone") },
    ...(categories.data ?? [])
      .filter((c) => !c.isIncome)
      .map((c) => ({ value: String(c.id), label: c.name })),
  ];

  return (
    <>
      <SettingsGroup title={t("wallet.groupWallet")}>
        <SettingRow
          id="wallet-name"
          description={[w.title, w.ownerName].filter(Boolean).join(" · ")}
          open={editing}
          onOpenChange={setEditing}
          control={
            <Button
              variant="default"
              disabled={!isOwner}
              aria-expanded={editing}
              onClick={() => setEditing((o) => !o)}
            >
              {t("settings.edit")}
            </Button>
          }
        >
          <AutoField
            showLabel
            label={t("wallet.title")}
            value={w.title}
            required
            width={360}
            onSave={(title) => save.mutateAsync({ title: title.trim() })}
          />
          <AutoField
            showLabel
            label={t("wallet.ownerName")}
            placeholder={t("wallet.ownerNamePlaceholder")}
            value={w.ownerName}
            width={360}
            onSave={(ownerName) => save.mutateAsync({ ownerName: ownerName.trim() })}
          />
        </SettingRow>
        <DefaultAccountRow />
        <SettingRow
          id="schedules"
          control={
            <SettingState tone={months === "0" ? "off" : "ok"}>{t(aheadKey(months))}</SettingState>
          }
        >
          <Select
            label={t("wallet.scheduleAhead")}
            description={t("wallet.scheduleAheadHint")}
            maw={360}
            data={AHEAD.map((v) => ({ value: v, label: t(aheadKey(v)) }))}
            value={months}
            onChange={(v) => {
              if (!v) return;
              setMonths(v);
              pick({ schedulePostMonths: Number(v) });
            }}
            disabled={!isOwner}
            allowDeselect={false}
          />
          <Select
            label={t("wallet.billsCategory")}
            description={t("wallet.billsCategoryHint")}
            maw={360}
            data={categoryOptions}
            value={bills}
            onChange={(v) => {
              setBills(v ?? "");
              pick({ billsCategoryId: v ? Number(v) : null });
            }}
            disabled={!isOwner}
            searchable
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.dataGroup")}>
        <SettingRow id="import" tour="data-import" />
        <SettingRow id="export" />
        <SettingRow
          id="backup"
          tour="data-backup"
          control={
            <SettingState tone={backupStale(days) ? "warn" : "ok"}>
              {backupAgeText(t, days)}
            </SettingState>
          }
        />
      </SettingsGroup>

      {isOwner && (
        <SettingsGroup title={t("wallet.dangerZone")}>
          <SettingRow
            id="delete-wallet"
            open={deleting}
            onOpenChange={setDeleting}
            control={
              <Button
                variant="default"
                c={errorColor}
                aria-expanded={deleting}
                onClick={() => setDeleting((o) => !o)}
              >
                {t("settings.delete")}
              </Button>
            }
          >
            <Text fz="sm" fw={600} c={errorColor}>
              {t("wallet.deleteConfirmLabel", { title: w.title })}
            </Text>
            <Group gap="xs">
              <TextInput
                w={240}
                aria-label={t("wallet.deleteConfirmLabel", { title: w.title })}
                value={confirm}
                onChange={(e) => setConfirm(e.currentTarget.value)}
              />
              <Button
                color="red"
                onClick={() => remove.mutate()}
                loading={remove.isPending}
                disabled={confirm !== w.title}
              >
                {t("wallet.delete")}
              </Button>
            </Group>
          </SettingRow>
        </SettingsGroup>
      )}

      <RelatedSettings ids={["bank-sync", "mail"]} />
    </>
  );
}

/** Settings › Wallet › Import. */
export function WalletImportSection() {
  return (
    <>
      <ImportExport part="import" />
      <RelatedSettings ids={["export", "bank-sync", "mail"]} />
    </>
  );
}

/** Settings › Wallet › Export. */
export function WalletExportSection() {
  return (
    <>
      <ImportExport part="export" />
      <RelatedSettings ids={["import", "backup"]} />
    </>
  );
}

/** Settings › Wallet › Backup and integrity. */
export function WalletBackupSection() {
  return (
    <>
      <SettingsGroup>
        <IntegrityRow />
        <BackupRows />
      </SettingsGroup>
      <RelatedSettings ids={["database", "export"]} />
    </>
  );
}
