import { ActionIcon, Button, Group, Modal, Stack, Table, TextInput, Textarea } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCar, IconPencil, IconTrash } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../components/confirmContext";

import {
  ApiError,
  type Vehicle,
  createVehicle,
  deleteVehicle,
  listVehicles,
  updateVehicle,
} from "../api/client";
import { rowEditProps, stopRowEdit } from "../rowEdit";
import { useWallet } from "../wallet/WalletProvider";

export function VehiclesPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [opened, modal] = useDisclosure(false);

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", walletId],
    queryFn: () => listVehicles(walletId),
    enabled: walletId > 0,
  });
  const vehicles = vehiclesQuery.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["vehicles", walletId] });

  const remove = useMutation({
    mutationFn: (id: number) => deleteVehicle(walletId, id),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const openCreate = () => {
    setEditing(null);
    modal.open();
  };
  const openEdit = (v: Vehicle) => {
    setEditing(v);
    modal.open();
  };

  if (!currentWallet) return null;

  // One button, shown in the header or in the empty state — never both.
  const addButton = <Button onClick={openCreate}>{t("vehicles.add")}</Button>;

  return (
    <Stack>
      <PageHeader
        title={t("vehicles.title")}
        hint={t("vehicles.hint")}
        actions={vehicles.length > 0 ? addButton : undefined}
      />
      {vehicles.length === 0 ? (
        <EmptyState icon={IconCar} message={t("vehicles.empty")} action={addButton} />
      ) : (
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("vehicles.name")}</Table.Th>
              <Table.Th>{t("vehicles.plate")}</Table.Th>
              <Table.Th>{t("vehicles.notes")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {vehicles.map((v) => (
              <Table.Tr key={v.id} {...rowEditProps(() => openEdit(v))}>
                <Table.Td fw={500}>{v.name}</Table.Td>
                <Table.Td>{v.plate}</Table.Td>
                <Table.Td c="dimmed">{v.notes}</Table.Td>
                <Table.Td ta="right" w={90} {...stopRowEdit}>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      aria-label={t("vehicles.edit")}
                      onClick={() => openEdit(v)}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={t("vehicles.delete")}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t("vehicles.confirmDeleteTitle", { name: v.name }),
                          body: t("vehicles.confirmDeleteBody"),
                          confirmLabel: t("vehicles.delete"),
                          danger: true,
                        });
                        if (ok) remove.mutate(v.id);
                      }}
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
      <VehicleModal
        opened={opened}
        onClose={modal.close}
        walletId={walletId}
        vehicle={editing}
        onSaved={invalidate}
      />
    </Stack>
  );
}

function VehicleModal({
  opened,
  onClose,
  walletId,
  vehicle,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  vehicle: Vehicle | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!opened) return;
    setName(vehicle?.name ?? "");
    setPlate(vehicle?.plate ?? "");
    setNotes(vehicle?.notes ?? "");
  }, [opened, vehicle]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, plate, notes };
      return vehicle ? updateVehicle(walletId, vehicle.id, body) : createVehicle(walletId, body);
    },
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
      title={vehicle ? t("vehicles.editTitle") : t("vehicles.addTitle")}
    >
      <Stack>
        <TextInput
          label={t("vehicles.name")}
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput
          label={t("vehicles.plate")}
          value={plate}
          onChange={(e) => setPlate(e.currentTarget.value)}
        />
        <Textarea
          label={t("vehicles.notes")}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          autosize
          minRows={2}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("vehicles.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            {t("vehicles.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
