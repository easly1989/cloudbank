import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  Group,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconCopy, IconKey, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type ApiToken,
  type ApiTokenScope,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../api/client";
import { useDateFormat } from "../dates";

// ApiTokensPage manages the user's personal API tokens: create (with a
// show-once reveal of the plaintext), list, and revoke. The plaintext token is
// never recoverable after creation, so the reveal is emphasised.
export function ApiTokensPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fmtDate = useDateFormat();

  const query = useQuery({ queryKey: ["apiTokens"], queryFn: listApiTokens });
  const tokens = query.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiTokenScope>("read");
  const [expiry, setExpiry] = useState("0");
  const [reveal, setReveal] = useState<string | null>(null);

  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["apiTokens"] });

  const create = useMutation({
    mutationFn: () =>
      createApiToken({ name: name.trim(), scope, expiresInDays: Number(expiry) || undefined }),
    onSuccess: (res) => {
      setReveal(res.token);
      setCreateOpen(false);
      setName("");
      setScope("read");
      setExpiry("0");
      refresh();
    },
    onError,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiToken(id),
    onSuccess: refresh,
    onError,
  });

  const onRevoke = (tk: ApiToken) => {
    if (window.confirm(t("apiTokens.confirmRevoke", { name: tk.name }))) revoke.mutate(tk.id);
  };

  const scopeBadge = (s: ApiTokenScope) => (
    <Badge size="sm" variant="light" color={s === "write" ? "orange" : "gray"}>
      {t(`apiTokens.scope.${s}`)}
    </Badge>
  );

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fw={600}>{t("apiTokens.title")}</Text>
          <Text size="sm" c="dimmed" maw={620}>
            {t("apiTokens.hint")}
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          {t("apiTokens.create")}
        </Button>
      </Group>

      {reveal && (
        <Alert
          color="teal"
          icon={<IconKey size={18} />}
          title={t("apiTokens.revealTitle")}
          withCloseButton
          onClose={() => setReveal(null)}
        >
          <Stack gap="xs">
            <Text size="sm">{t("apiTokens.revealWarning")}</Text>
            <Group gap="xs" wrap="nowrap">
              <TextInput readOnly value={reveal} style={{ flex: 1, fontFamily: "monospace" }} />
              <CopyButton value={reveal}>
                {({ copied, copy }) => (
                  <Button
                    variant="light"
                    color={copied ? "teal" : "blue"}
                    leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    onClick={copy}
                  >
                    {copied ? t("apiTokens.copied") : t("apiTokens.copy")}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Stack>
        </Alert>
      )}

      <Card withBorder p={0}>
        {tokens.length === 0 ? (
          <Text c="dimmed" p="md">
            {t("apiTokens.empty")}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("apiTokens.name")}</Table.Th>
                  <Table.Th>{t("apiTokens.tokenScope")}</Table.Th>
                  <Table.Th>{t("apiTokens.prefix")}</Table.Th>
                  <Table.Th>{t("apiTokens.lastUsed")}</Table.Th>
                  <Table.Th>{t("apiTokens.expires")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tokens.map((tk) => (
                  <Table.Tr key={tk.id}>
                    <Table.Td>{tk.name}</Table.Td>
                    <Table.Td>{scopeBadge(tk.scope)}</Table.Td>
                    <Table.Td>
                      <Text ff="monospace" size="sm">
                        {tk.prefix}…
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {tk.lastUsedAt ? fmtDate(tk.lastUsedAt) : t("apiTokens.never")}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {tk.expiresAt ? fmtDate(tk.expiresAt) : t("apiTokens.never")}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={t("apiTokens.revoke")} withArrow>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={t("apiTokens.revoke")}
                          loading={revoke.isPending && revoke.variables === tk.id}
                          onClick={() => onRevoke(tk)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title={t("apiTokens.create")}>
        <Stack>
          <TextInput
            data-autofocus
            label={t("apiTokens.name")}
            placeholder={t("apiTokens.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Input.Wrapper label={t("apiTokens.tokenScope")} description={t("apiTokens.scopeHint")}>
            <SegmentedControl
              fullWidth
              mt={4}
              value={scope}
              onChange={(v) => setScope(v as ApiTokenScope)}
              data={[
                { value: "read", label: t("apiTokens.scope.read") },
                { value: "write", label: t("apiTokens.scope.write") },
              ]}
            />
          </Input.Wrapper>
          <Select
            label={t("apiTokens.expiry")}
            value={expiry}
            onChange={(v) => setExpiry(v ?? "0")}
            data={[
              { value: "0", label: t("apiTokens.never") },
              { value: "30", label: t("apiTokens.days", { n: 30 }) },
              { value: "90", label: t("apiTokens.days", { n: 90 }) },
              { value: "365", label: t("apiTokens.days", { n: 365 }) },
            ]}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpen(false)}>
              {t("apiTokens.cancel")}
            </Button>
            <Button
              disabled={name.trim() === ""}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              {t("apiTokens.create")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
