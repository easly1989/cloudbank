import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  addCurrency,
  deleteCurrency,
  getCurrencyCatalog,
  listCurrencies,
  refreshRates,
  setBaseCurrency,
  updateCurrency,
  type Currency,
} from "../api/client";
import { useDateFormat } from "../dates";
import { rowFocusProps } from "../rowEdit";
import { useWallet } from "../wallet/WalletProvider";

export function CurrenciesPage() {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [toAdd, setToAdd] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<Set<string>>(new Set());
  const [providerError, setProviderError] = useState<string | null>(null);

  const currenciesQuery = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const catalog = useQuery({ queryKey: ["currency-catalog"], queryFn: getCurrencyCatalog });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["currencies", walletId] });
    void qc.invalidateQueries({ queryKey: ["wallets"] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const add = useMutation({
    mutationFn: (code: string) => addCurrency(walletId, code),
    onSuccess: () => {
      setToAdd(null);
      invalidate();
    },
    onError,
  });
  const makeBase = useMutation({
    mutationFn: (id: number) => setBaseCurrency(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteCurrency(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const refresh = useMutation({
    mutationFn: () => refreshRates(walletId),
    onSuccess: (res) => {
      setUnsupported(new Set(res.unsupported));
      setProviderError(res.providerError ?? null);
      if (!res.providerError) {
        notifications.show({
          color: "teal",
          message: t("currencies.refreshed", { count: res.updated.length }),
        });
      }
      invalidate();
    },
    onError,
  });

  const existing = new Set((currenciesQuery.data ?? []).map((c) => c.isoCode));
  const addOptions = (catalog.data ?? [])
    .filter((c) => !existing.has(c.code))
    .map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }));

  if (!currentWallet) return null;

  return (
    <Stack maw={720}>
      <Title order={2}>{t("currencies.title")}</Title>

      <Card withBorder>
        <Group align="flex-end">
          <Select
            label={t("currencies.add")}
            placeholder={t("currencies.addPlaceholder")}
            searchable
            data={addOptions}
            value={toAdd}
            onChange={setToAdd}
            flex={1}
          />
          <Button
            onClick={() => toAdd && add.mutate(toAdd)}
            loading={add.isPending}
            disabled={!toAdd}
          >
            {t("currencies.add")}
          </Button>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={() => refresh.mutate()}
            loading={refresh.isPending}
          >
            {t("currencies.refresh")}
          </Button>
        </Group>
      </Card>

      {providerError && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
          title={t("currencies.providerDown")}
        >
          {t("currencies.providerDownHint")}
        </Alert>
      )}

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("currencies.code")}</Table.Th>
            <Table.Th>{t("currencies.name")}</Table.Th>
            <Table.Th>{t("currencies.rate")}</Table.Th>
            <Table.Th>{t("currencies.actions")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {currenciesQuery.data?.map((c) => (
            <Table.Tr key={c.id} {...rowFocusProps()}>
              <Table.Td>
                {c.symbol} {c.isoCode}
                {c.isBase && (
                  <Badge ml="xs" color="teal" size="sm">
                    {t("currencies.base")}
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{c.name}</Table.Td>
              <Table.Td>
                {c.isBase ? (
                  "1"
                ) : (
                  <Stack gap={2}>
                    <RateCell
                      walletId={walletId}
                      currency={c}
                      onError={onError}
                      onSaved={invalidate}
                    />
                    <Group gap="xs">
                      {unsupported.has(c.isoCode) && (
                        <Tooltip label={t("currencies.notOnEcbHint")}>
                          <Badge color="gray" size="xs" variant="outline">
                            {t("currencies.notOnEcb")}
                          </Badge>
                        </Tooltip>
                      )}
                      {c.rateUpdatedAt && (
                        <Text size="xs" c="dimmed">
                          {t("currencies.updatedAt", {
                            date: fmtDate(c.rateUpdatedAt),
                          })}
                        </Text>
                      )}
                    </Group>
                  </Stack>
                )}
              </Table.Td>
              <Table.Td>
                <Group gap="xs">
                  {!c.isBase && (
                    <Button size="xs" variant="light" onClick={() => makeBase.mutate(c.id)}>
                      {t("currencies.setBase")}
                    </Button>
                  )}
                  {!c.isBase && (
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      onClick={() => remove.mutate(c.id)}
                    >
                      {t("currencies.delete")}
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function RateCell({
  walletId,
  currency,
  onError,
  onSaved,
}: {
  walletId: number;
  currency: Currency;
  onError: (err: unknown) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [rate, setRate] = useState<number | string>(currency.rate);

  const save = useMutation({
    mutationFn: () => updateCurrency(walletId, currency.id, { rate: Number(rate) }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <Group gap="xs" wrap="nowrap">
      <NumberInput
        size="xs"
        w={120}
        decimalScale={6}
        value={rate}
        onChange={setRate}
        aria-label={t("currencies.rate")}
      />
      <Button size="xs" variant="default" onClick={() => save.mutate()} loading={save.isPending}>
        {t("currencies.save")}
      </Button>
    </Group>
  );
}
