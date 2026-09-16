import { ActionIcon, Button, Group, Modal, Stack, Table, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Account,
  type AssetValuation,
  addAssetValuation,
  deleteAssetValuation,
  listAssetValuations,
  updateAssetValuation,
} from "../api/client";
import { type MoneyFormat, formatMinor, minorToInput } from "../money";
import { useAmountParser } from "../useAmountParser";

// AssetValuationsModal manages an asset account's dated valuation history: the
// latest one stands in for the account balance in net worth. Add, edit and
// delete are all supported; changes refresh the accounts list and dashboard.
export function AssetValuationsModal({
  walletId,
  account,
  opened,
  onClose,
}: {
  walletId: number;
  account: Account;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const parseAmount = useAmountParser();
  const fd = account.currencyFracDigits;
  const dc = account.currencyDecimalChar;
  const fmt: MoneyFormat = {
    fracDigits: fd,
    decimalChar: dc,
    groupChar: account.currencyGroupChar,
    symbol: account.currencySymbol,
    symbolPrefix: account.currencySymbolPrefix,
  };
  const today = new Date().toISOString().slice(0, 10);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const reset = () => {
    setEditingId(null);
    setDate(today);
    setValue("");
    setNote("");
  };

  const valuations = useQuery({
    queryKey: ["valuations", walletId, account.id],
    queryFn: () => listAssetValuations(walletId, account.id),
    enabled: opened && walletId > 0,
  });

  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["valuations", walletId, account.id] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { date, value: parseAmount(value, fd, dc) ?? 0, note: note.trim() };
      return editingId
        ? updateAssetValuation(walletId, account.id, editingId, body)
        : addAssetValuation(walletId, account.id, body);
    },
    onSuccess: () => {
      invalidate();
      reset();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteAssetValuation(walletId, account.id, id),
    onSuccess: () => {
      invalidate();
      reset();
    },
    onError,
  });

  const startEdit = (v: AssetValuation) => {
    setEditingId(v.id);
    setDate(v.date);
    setValue(minorToInput(v.value, fd, dc));
    setNote(v.note);
  };

  const canSave = date.trim() !== "" && value.trim() !== "";
  const rows = valuations.data ?? [];

  return (
    <Modal
      opened={opened}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t("valuations.title", { name: account.name })}
      size="lg"
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {t("valuations.hint")}
        </Text>
        <Group align="flex-end" gap="sm" wrap="wrap">
          <TextInput
            type="date"
            label={t("valuations.date")}
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <TextInput
            label={t("valuations.value")}
            placeholder="0"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
          <TextInput
            label={t("valuations.note")}
            style={{ flex: 1, minWidth: 120 }}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
            {editingId ? t("valuations.save") : t("valuations.add")}
          </Button>
          {editingId && (
            <Button variant="default" onClick={reset}>
              {t("valuations.cancel")}
            </Button>
          )}
        </Group>

        {rows.length === 0 ? (
          <Text c="dimmed" size="sm">
            {t("valuations.empty")}
          </Text>
        ) : (
          <Table verticalSpacing="xs">
            <Table.Tbody>
              {rows.map((v) => (
                <Table.Tr key={v.id}>
                  <Table.Td>{v.date}</Table.Td>
                  <Table.Td ta="right">
                    <Text fw={600}>{formatMinor(v.value, fmt)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed" truncate>
                      {v.note}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" w={80}>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        aria-label={t("valuations.editRow")}
                        onClick={() => startEdit(v)}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={t("valuations.deleteRow")}
                        loading={remove.isPending}
                        onClick={() => remove.mutate(v.id)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Modal>
  );
}
