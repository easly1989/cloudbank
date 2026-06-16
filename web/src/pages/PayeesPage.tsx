import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconDots, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Payee,
  createPayee,
  deletePayee,
  listCategories,
  listPayees,
  mergePayee,
  updatePayee,
} from "../api/client";
import { useWallet } from "../wallet/WalletProvider";
import { MergeModal } from "./CategoriesPage";

export function PayeesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
    enabled: walletId > 0,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled: walletId > 0,
  });
  const categories = categoriesQuery.data ?? [];
  const categoryName = (id?: number | null) => categories.find((c) => c.id === id)?.name ?? "";

  const invalidate = () => qc.invalidateQueries({ queryKey: ["payees", walletId] });
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const [formOpened, form] = useDisclosure(false);
  const [editing, setEditing] = useState<Payee | null>(null);
  const [mergeFrom, setMergeFrom] = useState<Payee | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => deletePayee(walletId, id),
    onSuccess: invalidate,
    onError,
  });

  if (!currentWallet) return null;
  const payees = payeesQuery.data ?? [];

  return (
    <Stack maw={720}>
      <Group justify="space-between">
        <Title order={2}>{t("payees.title")}</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setEditing(null);
            form.open();
          }}
        >
          {t("payees.add")}
        </Button>
      </Group>

      {payees.length === 0 && <Text c="dimmed">{t("payees.empty")}</Text>}

      {payees.length > 0 && (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("payees.name")}</Table.Th>
              <Table.Th>{t("payees.defaultCategory")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {payees.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td>{categoryName(p.defaultCategoryId)}</Table.Td>
                <Table.Td ta="right">
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label={t("payees.actions")}>
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        onClick={() => {
                          setEditing(p);
                          form.open();
                        }}
                      >
                        {t("payees.edit")}
                      </Menu.Item>
                      <Menu.Item onClick={() => setMergeFrom(p)}>{t("payees.merge")}</Menu.Item>
                      <Menu.Item
                        color="red"
                        onClick={() => {
                          if (window.confirm(t("payees.confirmDelete", { name: p.name })))
                            remove.mutate(p.id);
                        }}
                      >
                        {t("payees.delete")}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <PayeeFormModal
        opened={formOpened}
        onClose={form.close}
        walletId={walletId}
        editing={editing}
        categoryOptions={categories.map((c) => ({ value: String(c.id), label: c.name }))}
        onSaved={invalidate}
      />
      <MergeModal
        title={t("payees.mergeTitle")}
        source={mergeFrom}
        options={payees
          .filter((p) => p.id !== mergeFrom?.id)
          .map((p) => ({ value: String(p.id), label: p.name }))}
        onClose={() => setMergeFrom(null)}
        onMerge={(targetId) =>
          mergePayee(walletId, mergeFrom!.id, targetId)
            .then(() => {
              setMergeFrom(null);
              invalidate();
            })
            .catch(onError)
        }
      />
    </Stack>
  );
}

function PayeeFormModal({
  opened,
  onClose,
  walletId,
  editing,
  categoryOptions,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Payee | null;
  categoryOptions: { value: string; label: string }[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [defaultCategory, setDefaultCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setName(editing?.name ?? "");
    setDefaultCategory(editing?.defaultCategoryId ? String(editing.defaultCategoryId) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing?.id]);

  const save = useMutation({
    mutationFn: () =>
      editing
        ? updatePayee(walletId, editing.id, {
            name,
            defaultCategoryId: defaultCategory ? Number(defaultCategory) : null,
          })
        : createPayee(walletId, {
            name,
            defaultCategoryId: defaultCategory ? Number(defaultCategory) : null,
          }),
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

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t("payees.editTitle") : t("payees.addTitle")}
    >
      <Stack>
        <TextInput
          label={t("payees.name")}
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Select
          label={t("payees.defaultCategory")}
          clearable
          searchable
          data={categoryOptions}
          value={defaultCategory}
          onChange={setDefaultCategory}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("payees.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name}>
            {t("payees.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
