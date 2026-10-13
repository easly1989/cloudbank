import { Alert, Button, Card, Center, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { createWallet, getCurrencyCatalog } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";

// Creates a wallet. Used both as the first-run gate (firstRun) and from the
// in-app "new wallet" route.
export function CreateWalletPage({ firstRun = false }: { firstRun?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [baseCurrency, setBaseCurrency] = useState<string | null>("EUR");

  const catalog = useQuery({ queryKey: ["currency-catalog"], queryFn: getCurrencyCatalog });
  const currencyOptions = (catalog.data ?? []).map((c) => ({
    value: c.code,
    label: `${c.code} — ${c.name}`,
  }));

  const mutation = useMutation({
    mutationFn: () => createWallet({ title, ownerName, baseCurrency: baseCurrency ?? "EUR" }),
    onSuccess: async (wallet) => {
      await qc.invalidateQueries({ queryKey: ["wallets"] });
      localStorage.setItem("cb.currentWalletId", String(wallet.id));
      if (!firstRun) navigate("/");
    },
  });

  return (
    <Center mih={firstRun ? "100vh" : "60vh"}>
      <Card withBorder w={420} p="lg">
        <Stack>
          <div>
            <Title order={3}>{firstRun ? t("wallet.firstTitle") : t("wallet.createTitle")}</Title>
            <Text c="dimmed" size="sm">
              {t("wallet.subtitle")}
            </Text>
          </div>
          {mutation.error && (
            <Alert color="red">
              <ErrorMessage error={mutation.error} />
            </Alert>
          )}
          <TextInput
            label={t("wallet.title")}
            required
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
          <TextInput
            label={t("wallet.ownerName")}
            value={ownerName}
            onChange={(e) => setOwnerName(e.currentTarget.value)}
          />
          <Select
            label={t("wallet.baseCurrency")}
            searchable
            data={currencyOptions}
            value={baseCurrency}
            onChange={setBaseCurrency}
          />
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!title.trim()}
          >
            {t("wallet.create")}
          </Button>
        </Stack>
      </Card>
    </Center>
  );
}
