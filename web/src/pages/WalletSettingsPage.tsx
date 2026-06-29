import {
  Alert,
  Button,
  Card,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCoin, IconTags, IconUserDollar } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError, deleteWallet, updateWallet } from "../api/client";
import { useWallet } from "../wallet/WalletProvider";
import { BackupCard } from "./BackupCard";
import { ImportExport } from "./ImportPage";
import { IntegrityCard } from "./IntegrityCard";

export function WalletSettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { currentWallet } = useWallet();
  const [title, setTitle] = useState(currentWallet?.title ?? "");
  const [ownerName, setOwnerName] = useState(currentWallet?.ownerName ?? "");
  const [confirm, setConfirm] = useState("");

  const notifyError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const rename = useMutation({
    mutationFn: () => updateWallet(currentWallet!.id, { title, ownerName }),
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

  // Group the wallet's settings behind a section dropdown (deep-linkable via
  // ?section=) so the page doesn't fill up. Import is wallet-scoped, so it lives
  // here rather than in the main nav.
  const sections = [
    { value: "general", label: t("settings.sectionGeneral") },
    { value: "import", label: t("settings.sectionImport") },
    { value: "backup", label: t("settings.sectionBackup") },
    ...(isOwner ? [{ value: "danger", label: t("wallet.dangerZone") }] : []),
  ];
  const requested = params.get("section") ?? "general";
  const section = sections.some((s) => s.value === requested) ? requested : "general";
  const setSection = (s: string) => setParams({ tab: "wallet", section: s }, { replace: true });

  return (
    <Stack>
      <Select
        label={t("settings.section")}
        data={sections}
        value={section}
        onChange={(v) => v && setSection(v)}
        allowDeselect={false}
        maw={260}
      />

      {section === "general" && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card withBorder>
            <Stack>
              <TextInput
                label={t("wallet.title")}
                value={title}
                disabled={!isOwner}
                onChange={(e) => setTitle(e.currentTarget.value)}
              />
              <TextInput
                label={t("wallet.ownerName")}
                value={ownerName}
                disabled={!isOwner}
                onChange={(e) => setOwnerName(e.currentTarget.value)}
              />
              <Group justify="flex-end">
                <Button
                  onClick={() => rename.mutate()}
                  loading={rename.isPending}
                  disabled={!isOwner || !title}
                >
                  {t("wallet.save")}
                </Button>
              </Group>
            </Stack>
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              {t("settings.manage")}
            </Title>
            <Group>
              <Button
                variant="light"
                leftSection={<IconTags size={16} />}
                onClick={() => navigate("/categories")}
              >
                {t("categories.title")}
              </Button>
              <Button
                variant="light"
                leftSection={<IconUserDollar size={16} />}
                onClick={() => navigate("/payees")}
              >
                {t("payees.title")}
              </Button>
              <Button
                variant="light"
                leftSection={<IconCoin size={16} />}
                onClick={() => navigate("/currencies")}
              >
                {t("currencies.title")}
              </Button>
            </Group>
          </Card>
        </SimpleGrid>
      )}

      {section === "import" && <ImportExport />}

      {section === "backup" && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <IntegrityCard />
          <BackupCard />
        </SimpleGrid>
      )}

      {section === "danger" && isOwner && (
        <Card withBorder maw={560}>
          <Stack>
            <div>
              <Title order={4} c="red">
                {t("wallet.dangerZone")}
              </Title>
              <Text size="sm" c="dimmed">
                {t("wallet.deleteWarning")}
              </Text>
            </div>
            <Alert color="red" variant="light">
              {t("wallet.deleteConfirmLabel", { title: currentWallet.title })}
            </Alert>
            <TextInput value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
            <Group justify="flex-end">
              <Button
                color="red"
                onClick={() => remove.mutate()}
                loading={remove.isPending}
                disabled={!canDelete}
              >
                {t("wallet.delete")}
              </Button>
            </Group>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
