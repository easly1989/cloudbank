import { Button, Card, Group, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, downloadExport, listAccounts } from "../api/client";
import { useWallet } from "../wallet/WalletProvider";

export function ExportPanel() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [accountId, setAccountId] = useState<string | null>(null);
  const [format, setFormat] = useState<"csv" | "qif">("csv");

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = accountsQuery.data ?? [];

  const download = useMutation({
    mutationFn: () => {
      const acc = accounts.find((a) => String(a.id) === accountId);
      const name = (acc?.name ?? "account").replace(/[^\w.-]+/g, "_");
      return downloadExport(walletId, Number(accountId), format, `${name}.${format}`);
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  return (
    <Card withBorder maw={520}>
      <Stack>
        <Text c="dimmed">{t("exportCsv.description")}</Text>
        <SegmentedControl
          value={format}
          onChange={(v) => setFormat(v as "csv" | "qif")}
          data={[
            { label: t("exportCsv.formats.csv"), value: "csv" },
            { label: t("exportCsv.formats.qif"), value: "qif" },
          ]}
        />
        <Select
          label={t("exportCsv.account")}
          placeholder={t("exportCsv.accountPlaceholder")}
          data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
          value={accountId}
          onChange={setAccountId}
          searchable
        />
        <Group justify="flex-end">
          <Button
            leftSection={<IconDownload size={16} />}
            disabled={!accountId}
            loading={download.isPending}
            onClick={() => download.mutate()}
          >
            {t("exportCsv.download")}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
