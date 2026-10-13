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
  createUser,
  listUsers,
  resetUserPassword,
  setUserDisabled,
  type User,
} from "../../api/client";
import { useAuth, useAuthConfig } from "../../auth/AuthProvider";
import { notifyError } from "../../notifyError";

export function UsersPage() {
  const { t } = useTranslation();
  const { user: current } = useAuth();
  // Signing in through SSO only (#620): no passwords to set or reset.
  const ssoOnly = useAuthConfig().data?.passwordLogin === false;
  const qc = useQueryClient();
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: listUsers });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

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
                  {!ssoOnly && (
                    <Button size="xs" variant="default" onClick={() => setResetTarget(u)}>
                      {t("admin.resetPassword")}
                    </Button>
                  )}
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
        ssoOnly={ssoOnly}
        opened={createOpened}
        onClose={createHandlers.close}
        onCreated={invalidate}
      />
      <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
    </Stack>
  );
}

function CreateUserModal({
  ssoOnly,
  opened,
  onClose,
  onCreated,
}: {
  ssoOnly: boolean;
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const provider = useAuthConfig().data?.oidc.name ?? "SSO";
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const ready = ssoOnly ? !!username && email.includes("@") : !!username && password.length >= 8;

  const mutation = useMutation({
    mutationFn: () =>
      createUser(ssoOnly ? { username, email, isAdmin } : { username, email, password, isAdmin }),
    onSuccess: () => {
      notifications.show({ color: "green", message: t("admin.userCreated") });
      setUsername("");
      setEmail("");
      setPassword("");
      setIsAdmin(false);
      onCreated();
      onClose();
    },
    onError: (err: unknown) => notifyError(err),
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
          type="email"
          required={ssoOnly}
          description={ssoOnly ? t("admin.emailSso", { provider }) : undefined}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        {!ssoOnly && (
          <PasswordInput
            label={t("admin.password")}
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
        )}
        <Checkbox
          label={t("admin.makeAdmin")}
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.currentTarget.checked)}
        />
        <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!ready}>
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
    onError: (err: unknown) => notifyError(err),
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
