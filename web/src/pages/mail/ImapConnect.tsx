import {
  Alert,
  Anchor,
  Button,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBrandWindows, IconExternalLink, IconLock } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { connectIMAPMail, type IMAPSettings, type Mailbox } from "../../api/client";
import { ApiError } from "../../api/core";
import { ErrorMessage } from "../../components/ErrorMessage";
import {
  isMicrosoftAddress,
  PROVIDERS,
  providerById,
  providerForAddress,
  providerForServer,
  type ProviderId,
} from "./imapProviders";

/** The usual port for each way of encrypting, to follow a change of one. */
const PORTS = { tls: 993, starttls: 143 } as const;

/**
 * Connects a mailbox over IMAP with an app password (#658), or gives one new
 * settings: a mailbox passed in keeps its address, folder and history, and
 * only needs the new password. The server logs in before it saves anything,
 * so whatever goes wrong is shown here, in the server's own words.
 */
export function ImapConnect({
  walletId,
  mailbox,
  microsoft,
  onMicrosoft,
  onClose,
}: {
  walletId: number;
  /** An IMAP mailbox to give new settings, or none for a new one. */
  mailbox?: Mailbox;
  /** Whether Outlook.com can be connected, for an address that is one. */
  microsoft: boolean;
  onMicrosoft: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const current = mailbox?.imap ?? null;
  const [address, setAddress] = useState(mailbox?.address ?? "");
  const [providerId, setProviderId] = useState<ProviderId>(
    current ? providerForServer(current).id : "gmail",
  );
  // Until the reader chooses a provider, it follows the address's domain.
  const [providerChosen, setProviderChosen] = useState(!!current);
  const [password, setPassword] = useState("");
  const [server, setServer] = useState<Omit<IMAPSettings, "username">>(
    current ?? providerById("gmail").server,
  );
  const [username, setUsername] = useState(
    current && current.username !== mailbox?.address ? current.username : "",
  );
  const [editServer, setEditServer] = useState(providerId === "other");
  const [tried, setTried] = useState(false);
  const provider = providerById(providerId);
  const outlook = !mailbox && isMicrosoftAddress(address);

  const chooseProvider = (id: ProviderId) => {
    setProviderId(id);
    setProviderChosen(true);
    setServer(providerById(id).server);
    if (id === "other") setEditServer(true);
  };
  const typeAddress = (v: string) => {
    setAddress(v);
    const found = providerForAddress(v);
    if (!providerChosen && found && found.id !== providerId) {
      setProviderId(found.id);
      setServer(found.server);
    }
  };
  const chooseSecurity = (security: IMAPSettings["security"]) =>
    setServer((s) => ({
      ...s,
      security,
      // A port that was the other way's usual one follows the change.
      port: s.port === PORTS[s.security] ? PORTS[security] : s.port,
    }));

  const problems = {
    address:
      !mailbox && !/^[^@\s]+@[^@\s]+$/.test(address.trim()) ? t("mail.imap.errAddress") : null,
    password: password === "" ? t("mail.imap.errPassword") : null,
    host: server.host.trim() === "" ? t("mail.imap.errHost") : null,
    port: !(server.port >= 1 && server.port <= 65535) ? t("mail.imap.errPort") : null,
  };
  const ready = !outlook && Object.values(problems).every((p) => p === null);

  const connect = useMutation({
    mutationFn: () =>
      connectIMAPMail(walletId, {
        mailboxId: mailbox?.id,
        address: mailbox ? undefined : address.trim(),
        username: username.trim() || undefined,
        password,
        host: server.host.trim(),
        port: server.port,
        security: server.security,
      }),
    onSuccess: (mb) => {
      notifications.show({
        color: "teal",
        message: mailbox
          ? t("mail.imap.saved", { address: mb.address })
          : t("mail.connected", { address: mb.address }),
      });
      void qc.invalidateQueries({ queryKey: ["mail", walletId] });
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (ready) connect.mutate();
  };
  // A field's problem shows once the reader tried to connect.
  const shown = (p: string | null) => (tried ? p : null);

  return (
    <Modal
      opened
      onClose={onClose}
      title={mailbox ? t("mail.imap.reconnectTitle") : t("mail.imap.title")}
      centered
      size="md"
    >
      <form onSubmit={submit} noValidate>
        <Stack gap="md">
          <TextInput
            label={t("mail.imap.address")}
            type="email"
            autoComplete="email"
            placeholder="nome@example.com"
            value={address}
            onChange={(e) => typeAddress(e.currentTarget.value)}
            disabled={!!mailbox}
            error={shown(problems.address)}
            data-autofocus={!mailbox || undefined}
            data-cb-sensitive
          />

          {outlook ? (
            <Alert color="blue" variant="light" p="sm" icon={<IconBrandWindows size={18} />}>
              <Stack gap="xs" align="flex-start">
                <Text size="sm">{t("mail.imap.outlook")}</Text>
                {microsoft && (
                  <Button size="xs" onClick={onMicrosoft}>
                    {t("mail.microsoftConnect")}
                  </Button>
                )}
              </Stack>
            </Alert>
          ) : (
            <>
              <Stack gap={6}>
                <Select
                  label={t("mail.imap.provider")}
                  data={PROVIDERS.map((p) => ({
                    value: p.id,
                    label: p.id === "other" ? t("mail.imap.other") : p.name,
                  }))}
                  value={providerId}
                  allowDeselect={false}
                  onChange={(v) => v && chooseProvider(v as ProviderId)}
                />
                <Text size="xs" c="dimmed">
                  {t(`mail.imap.hint.${providerId}`)}{" "}
                  {provider.help && (
                    <Anchor
                      href={provider.help}
                      target="_blank"
                      rel="noreferrer"
                      size="xs"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {t("mail.imap.guide", { name: provider.name })}
                      <IconExternalLink size={12} style={{ marginLeft: 3, verticalAlign: -1 }} />
                    </Anchor>
                  )}
                </Text>
              </Stack>

              <PasswordInput
                label={
                  providerId === "aruba" ? t("mail.imap.passwordMailbox") : t("mail.imap.password")
                }
                description={t("mail.imap.passwordHint")}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                error={shown(problems.password)}
                data-autofocus={mailbox ? true : undefined}
              />

              {editServer ? (
                <Stack gap="sm">
                  <Group gap="sm" align="flex-start" wrap="nowrap">
                    <TextInput
                      label={t("mail.imap.host")}
                      placeholder="imap.example.com"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={server.host}
                      onChange={(e) => {
                        const host = e.currentTarget.value;
                        setServer((s) => ({ ...s, host }));
                      }}
                      error={shown(problems.host)}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <NumberInput
                      label={t("mail.imap.port")}
                      value={server.port}
                      onChange={(v) => setServer((s) => ({ ...s, port: Number(v) || 0 }))}
                      min={1}
                      max={65535}
                      allowDecimal={false}
                      allowNegative={false}
                      hideControls
                      error={shown(problems.port)}
                      w={88}
                    />
                  </Group>
                  <Stack gap={4}>
                    <Text size="sm" fw={500}>
                      {t("mail.imap.security")}
                    </Text>
                    <SegmentedControl
                      fullWidth
                      value={server.security}
                      onChange={(v) => chooseSecurity(v as IMAPSettings["security"])}
                      data={[
                        { value: "tls", label: "TLS" },
                        { value: "starttls", label: "STARTTLS" },
                      ]}
                    />
                    <Text size="xs" c="dimmed">
                      {t("mail.imap.securityHint")}
                    </Text>
                  </Stack>
                  <TextInput
                    label={t("mail.imap.username")}
                    description={t("mail.imap.usernameHint")}
                    placeholder={address.trim() || undefined}
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.currentTarget.value)}
                    data-cb-sensitive
                  />
                </Stack>
              ) : (
                <Group gap="xs" wrap="nowrap" align="center">
                  <IconLock size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                  <Text size="sm" c="dimmed" truncate style={{ minWidth: 0 }}>
                    {t("mail.imap.serverLine", {
                      host: server.host,
                      port: server.port,
                      security: server.security === "tls" ? "TLS" : "STARTTLS",
                    })}
                  </Text>
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    onClick={() => setEditServer(true)}
                    style={{ flexShrink: 0 }}
                  >
                    {t("mail.imap.change")}
                  </Anchor>
                </Group>
              )}

              {connect.isError && <ConnectError error={connect.error} />}

              <Group justify="flex-end" gap="sm">
                {connect.isPending && (
                  <Text size="sm" c="dimmed" mr="auto">
                    {t("mail.imap.trying")}
                  </Text>
                )}
                <Button variant="default" onClick={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" loading={connect.isPending}>
                  {mailbox ? t("mail.imap.save") : t("mail.imap.connect")}
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </form>
    </Modal>
  );
}

/**
 * Why the server could not connect, with the mail server's own words, and
 * what to try next when that is not obvious from them.
 */
function ConnectError({ error }: { error: Error }) {
  const { t } = useTranslation();
  const code = error instanceof ApiError ? error.code : undefined;
  const next =
    code === "login_refused"
      ? t("mail.imap.refusedHint")
      : code === "tls_failed"
        ? t("mail.imap.tlsHint")
        : null;
  return (
    <Alert color="red" variant="light" p="sm" data-testid="imap-error">
      <Text size="sm" fw={500}>
        <ErrorMessage error={error} />
      </Text>
      {next && (
        <Text size="sm" mt={6}>
          {next}
        </Text>
      )}
    </Alert>
  );
}
