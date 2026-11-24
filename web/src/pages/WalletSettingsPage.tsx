import { Button, Card, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorColor } from "../amountTone";

import { deleteWallet, listCategories, updateWallet } from "../api/client";
import { useWallet } from "../wallet/WalletProvider";
import { BackupRows } from "./BackupCard";
import { ImportExport } from "./ImportPage";
import { IntegrityRow } from "./IntegrityCard";
import { notifyError } from "../notifyError";
import { SettingsGroup } from "./settings/SettingsLayout";

export function WalletSettingsPage({
  only = "general",
}: {
  only?: "general" | "import" | "backup" | "danger";
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const [title, setTitle] = useState(currentWallet?.title ?? "");
  const [ownerName, setOwnerName] = useState(currentWallet?.ownerName ?? "");
  const [postMonths, setPostMonths] = useState(String(currentWallet?.schedulePostMonths ?? 0));
  const [billsCategory, setBillsCategory] = useState(
    currentWallet?.billsCategoryId ? String(currentWallet.billsCategoryId) : "",
  );
  const [confirm, setConfirm] = useState("");

  const categoriesQuery = useQuery({
    queryKey: ["categories", currentWallet?.id ?? 0],
    queryFn: () => listCategories(currentWallet!.id),
    enabled: !!currentWallet,
  });
  const categoryOptions = [
    { value: "", label: t("wallet.billsCategoryNone") },
    ...(categoriesQuery.data ?? [])
      .filter((c) => !c.isIncome)
      .map((c) => ({ value: String(c.id), label: c.name })),
  ];

  const rename = useMutation({
    mutationFn: () =>
      updateWallet(currentWallet!.id, {
        title,
        ownerName,
        schedulePostMonths: Number(postMonths),
        billsCategoryId: billsCategory ? Number(billsCategory) : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      notifications.show({ color: "green", message: t("wallet.saved") });
    },
    onError: notifyError,
  });

  const remove = useMutation({
    mutationFn: () => deleteWallet(currentWallet!.id),
    onSuccess: async () => {
      localStorage.removeItem("cb.currentWalletId");
      await qc.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: notifyError,
  });

  if (!currentWallet) return null;
  const isOwner = currentWallet.role === "owner";
  const canDelete = confirm === currentWallet.title;

  // Which of the wallet's settings to render. The settings screen owns the
  // navigation now, so this is a prop rather than a dropdown of its own: two
  // levels of section picker on one screen is one too many.
  const section = only;

  return (
    <Stack>
      {section === "general" && (
        <Stack gap="xl">
          <SettingsGroup title={t("wallet.groupWallet")} hint={t("wallet.groupWalletHint")}>
            <Card withBorder p={0} className="cb-settings-fields">
              <TextInput
                className="cb-settings-field"
                label={t("wallet.title")}
                value={title}
                disabled={!isOwner}
                onChange={(e) => setTitle(e.currentTarget.value)}
              />
              <TextInput
                className="cb-settings-field"
                label={t("wallet.ownerName")}
                placeholder={t("wallet.ownerNamePlaceholder")}
                value={ownerName}
                disabled={!isOwner}
                onChange={(e) => setOwnerName(e.currentTarget.value)}
              />
            </Card>
          </SettingsGroup>
          <SettingsGroup title={t("wallet.groupSchedules")} hint={t("wallet.groupSchedulesHint")}>
            <Card withBorder p={0} className="cb-settings-fields">
              <Select
                className="cb-settings-field"
                label={t("wallet.scheduleAhead")}
                description={t("wallet.scheduleAheadHint")}
                data={[
                  { value: "0", label: t("wallet.scheduleAheadOff") },
                  { value: "1", label: t("wallet.scheduleAhead1") },
                  { value: "2", label: t("wallet.scheduleAhead2") },
                  { value: "3", label: t("wallet.scheduleAhead3") },
                ]}
                value={postMonths}
                onChange={(v) => v && setPostMonths(v)}
                disabled={!isOwner}
                allowDeselect={false}
              />
              <Select
                className="cb-settings-field"
                label={t("wallet.billsCategory")}
                description={t("wallet.billsCategoryHint")}
                data={categoryOptions}
                value={billsCategory}
                onChange={(v) => setBillsCategory(v ?? "")}
                disabled={!isOwner}
                searchable
              />
            </Card>
          </SettingsGroup>
          <Group justify="flex-end">
            <Button
              onClick={() => rename.mutate()}
              loading={rename.isPending}
              disabled={!isOwner || !title.trim()}
            >
              {t("wallet.save")}
            </Button>
          </Group>
        </Stack>
      )}

      {section === "import" && <ImportExport />}

      {section === "backup" && (
        <Card withBorder p={0}>
          <IntegrityRow />
          <BackupRows />
        </Card>
      )}

      {section === "danger" && isOwner && (
        <SettingsGroup title={t("wallet.dangerZone")} hint={t("wallet.deleteWarning")}>
          <Card withBorder p={0} style={{ borderColor: "var(--mantine-color-red-outline)" }}>
            <div className="cb-settings-row">
              <Text fz="sm" fw={600} c={errorColor} className="cb-settings-row-text">
                {t("wallet.deleteConfirmLabel", { title: currentWallet.title })}
              </Text>
              <Group gap="xs">
                <TextInput
                  w={220}
                  aria-label={t("wallet.deleteConfirmLabel", { title: currentWallet.title })}
                  value={confirm}
                  onChange={(e) => setConfirm(e.currentTarget.value)}
                />
                <Button
                  color="red"
                  onClick={() => remove.mutate()}
                  loading={remove.isPending}
                  disabled={!canDelete}
                >
                  {t("wallet.delete")}
                </Button>
              </Group>
            </div>
          </Card>
        </SettingsGroup>
      )}
    </Stack>
  );
}
