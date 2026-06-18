import { Alert, Button, Card, FileInput, List, Stack, Table, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconFileImport, IconUpload } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ApiError, importXHB, type ImportResult } from "../api/client";
import { useWallet } from "../wallet/WalletProvider";

export function ImportPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setCurrentWalletId } = useWallet();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (f: File) => importXHB(f),
    onSuccess: async (res) => {
      setError(null);
      setResult(res);
      await qc.invalidateQueries({ queryKey: ["wallets"] });
      setCurrentWalletId(res.walletId);
    },
    onError: (err: unknown) => {
      setResult(null);
      setError(err instanceof ApiError ? err.message : String(err));
    },
  });

  return (
    <Stack maw={640}>
      <Title order={2}>{t("import.title")}</Title>
      <Text c="dimmed">{t("import.description")}</Text>

      <Card withBorder>
        <Stack>
          <FileInput
            label={t("import.fileLabel")}
            placeholder={t("import.filePlaceholder")}
            accept=".xhb,application/xml,text/xml"
            leftSection={<IconFileImport size={16} />}
            value={file}
            onChange={setFile}
            clearable
          />
          <Button
            leftSection={<IconUpload size={16} />}
            disabled={!file}
            loading={mutation.isPending}
            onClick={() => file && mutation.mutate(file)}
          >
            {t("import.submit")}
          </Button>
        </Stack>
      </Card>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title={t("import.failed")}>
          {error}
        </Alert>
      )}

      {result && (
        <Card withBorder>
          <Stack>
            <Title order={4}>{t("import.success")}</Title>
            <Table>
              <Table.Tbody>
                {Object.entries(result.counts)
                  .filter(([, n]) => n > 0)
                  .map(([key, n]) => (
                    <Table.Tr key={key}>
                      <Table.Td>{t(`import.entities.${key}`, key)}</Table.Td>
                      <Table.Td ta="right">{n}</Table.Td>
                    </Table.Tr>
                  ))}
              </Table.Tbody>
            </Table>

            {result.warnings.length > 0 && (
              <Alert
                color="yellow"
                icon={<IconAlertTriangle size={16} />}
                title={t("import.warnings")}
              >
                <List size="sm">
                  {result.warnings.map((wmsg, i) => (
                    <List.Item key={i}>{wmsg}</List.Item>
                  ))}
                </List>
              </Alert>
            )}

            <Button variant="light" onClick={() => navigate("/")}>
              {t("import.goToDashboard")}
            </Button>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
