import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Table,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  createUser,
  listUsers,
  resetUserPassword,
  setUserDisabled,
  type User,
} from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";

export function UsersPage() {
  const { t } = useTranslation();
  const { user: current } = useAuth();
  const qc = useQueryClient();
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: listUsers });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const notifyError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const disableMutation = useMutation({
    mutationFn: ({ id, disabled }: { id: number; disabled: boolean }) =>
      setUserDisabled(id, disabled),
    onSuccess: invalidate,
    onError: notifyError,
  });

  const [createOpened, createHandlers] = useDisclosure(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("admin.title")}</Title>
        <Button onClick={createHandlers.open}>{t("admin.create")}</Button>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("admin.username")}</Table.Th>
            <Table.Th>{t("admin.email")}</Table.Th>
            <Table.Th>{t("admin.role")}</Table.Th>
            <Table.Th>{t("admin.status")}</Table.Th>
            <Table.Th>{t("admin.actions")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {usersQuery.data?.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>
                {u.username}
                {current?.id === u.id && (
                  <Badge ml="xs" size="xs" variant="light">
                    {t("admin.you")}
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{u.email}</Table.Td>
              <Table.Td>
                {u.isAdmin ? <Badge color="teal">{t("admin.admin")}</Badge> : "—"}
              </Table.Td>
              <Table.Td>
                {u.disabled ? (
                  <Badge color="red">{t("admin.disabled")}</Badge>
                ) : (
                  <Badge color="green">{t("admin.active")}</Badge>
                )}
              </Table.Td>
              <Table.Td>
                <Group gap="xs">
                  <Button size="xs" variant="default" onClick={() => setResetTarget(u)}>
                    {t("admin.resetPassword")}
                  </Button>
                  {current?.id !== u.id && (
                    <Button
                      size="xs"
                      variant="light"
                      color={u.disabled ? "green" : "red"}
                      onClick={() => disableMutation.mutate({ id: u.id, disabled: !u.disabled })}
                    >
                      {u.disabled ? t("admin.enable") : t("admin.disable")}
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <CreateUserModal
        opened={createOpened}
        onClose={createHandlers.close}
        onCreated={invalidate}
      />
      <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
    </Stack>
  );
}

function CreateUserModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const mutation = useMutation({
    mutationFn: () => createUser({ username, email, password, isAdmin }),
    onSuccess: () => {
      notifications.show({ color: "green", message: t("admin.userCreated") });
      setUsername("");
      setEmail("");
      setPassword("");
      setIsAdmin(false);
      onCreated();
      onClose();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  return (
    <Modal opened={opened} onClose={onClose} title={t("admin.createTitle")}>
      <Stack>
        <TextInput
          label={t("admin.username")}
          required
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
        />
        <TextInput
          label={t("admin.email")}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <PasswordInput
          label={t("admin.password")}
          required
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        <Checkbox
          label={t("admin.makeAdmin")}
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.currentTarget.checked)}
        />
        <Button
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          disabled={!username || password.length < 8}
        >
          {t("admin.create")}
        </Button>
      </Stack>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => resetUserPassword(user!.id, password),
    onSuccess: () => {
      notifications.show({ color: "green", message: t("admin.passwordReset") });
      setPassword("");
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
      opened={user !== null}
      onClose={onClose}
      title={user ? `${t("admin.resetPassword")} — ${user.username}` : ""}
    >
      <Stack>
        <PasswordInput
          label={t("admin.newPassword")}
          required
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        <Button
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          disabled={password.length < 8}
        >
          {t("admin.resetPassword")}
        </Button>
      </Stack>
    </Modal>
  );
}
