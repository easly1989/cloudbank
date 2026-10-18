import {
  Anchor,
  Button,
  Card,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBrandMatrix, IconMail, IconWebhook } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { GUIDE_BASE_URL } from "../aboutLinks";
import {
  ApiError,
  NOTIFICATION_CHANNELS_KEY as CHANNELS_KEY,
  deleteNotificationChannel,
  listNotificationChannels,
  saveNotificationChannel,
  testNotificationChannel,
  type AddressedChannel,
  type NotificationChannelState,
} from "../api/client";
import { errorColor } from "../amountTone";
import { useAuth } from "../auth/AuthProvider";
import { notifyError } from "../notifyError";

// The channels a reader sets up with an address of their own (#686): email,
// through the installation's mail server, and a webhook (Home Assistant, n8n,
// a script). Each says how its last delivery went and can send a test.

const REASONS = ["unauthorized", "rejected", "unreachable", "local"];

function useChannel(channel: AddressedChannel) {
  const { data } = useQuery({ queryKey: CHANNELS_KEY, queryFn: listNotificationChannels });
  return data?.channels.find((c) => c.channel === channel);
}

/** "Last delivery failed: 401", or when it last went through. */
function Status({ state }: { state: NotificationChannelState }) {
  const { t, i18n } = useTranslation();
  if (state.lastError) {
    const reason = REASONS.includes(state.lastError)
      ? t(`notif.reason.${state.lastError}`)
      : state.lastError;
    return (
      <Text size="sm" c={errorColor} role="status">
        {t("notif.lastError", { reason })}
      </Text>
    );
  }
  if (state.lastOkAt) {
    const when = new Date(state.lastOkAt).toLocaleString(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return (
      <Text size="sm" c="dimmed" role="status">
        {t("notif.lastOk", { when })}
      </Text>
    );
  }
  return null;
}

function ChannelCard({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card withBorder>
      <Stack gap="sm">
        <div>
          <Group gap="xs">
            {icon}
            <Title order={5}>{title}</Title>
          </Group>
          <Text size="sm" c="dimmed" maw={560} mt={4}>
            {hint}
          </Text>
        </div>
        {children}
      </Stack>
    </Card>
  );
}

/** Save, send a test, remove: the same three for both channels. */
function useChannelActions(channel: AddressedChannel) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: CHANNELS_KEY });
  const saveError = (err: unknown) => {
    if (err instanceof ApiError && err.code === "local_network") {
      notifications.show({ color: "red", message: t("notif.localNetwork") });
    } else if (err instanceof ApiError && err.code === "invalid") {
      notifications.show({ color: "red", message: t("notif.invalidAddress") });
    } else {
      notifyError(err);
    }
  };
  const save = useMutation({
    mutationFn: (body: { target?: string; secret?: string }) =>
      saveNotificationChannel(channel, body),
    onSuccess: () => {
      notifications.show({ color: "green", message: t("notif.saved") });
      // A new channel joins the events table.
      void qc.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
    onError: saveError,
    onSettled: refresh,
  });
  const test = useMutation({
    mutationFn: () => testNotificationChannel(channel),
    onSuccess: (r) => {
      if (r.ok) {
        notifications.show({ color: "green", message: t("notif.testSent") });
      } else {
        const reason =
          r.error && REASONS.includes(r.error) ? t(`notif.reason.${r.error}`) : r.error;
        notifications.show({ color: "red", message: t("notif.testFailed", { reason }) });
      }
    },
    onError: notifyError,
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => deleteNotificationChannel(channel),
    onError: notifyError,
    onSettled: refresh,
  });
  return { save, test, remove };
}

/** How the last delivery went, with Remove and Send a test, once saved. */
function Footer({
  state,
  actions: { test, remove },
}: {
  state: NotificationChannelState;
  actions: ReturnType<typeof useChannelActions>;
}) {
  const { t } = useTranslation();
  if (!state.configured) return null;
  return (
    <Group justify="space-between" gap="xs" wrap="wrap">
      <Status state={state} />
      <Group gap="xs" ml="auto">
        <Button
          variant="subtle"
          color="red"
          loading={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {t("notif.remove")}
        </Button>
        <Button variant="default" loading={test.isPending} onClick={() => test.mutate()}>
          {t("notif.sendTest")}
        </Button>
      </Group>
    </Group>
  );
}

/** The guide's section on a channel, after the card's hint. */
function GuideLink({ section }: { section: string }) {
  const { t } = useTranslation();
  return (
    <Anchor
      href={`${GUIDE_BASE_URL}notifications.md#${section}`}
      target="_blank"
      rel="noreferrer"
      size="sm"
    >
      {t("notif.webhookGuide")}
    </Anchor>
  );
}

export function EmailChannelCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const state = useChannel("email");
  const actions = useChannelActions("email");
  const { save } = actions;
  const [address, setAddress] = useState<string | null>(null);
  if (!state) return null;
  const value = address ?? (state.configured ? state.target : (user?.email ?? ""));
  const dirty = !state.configured || value.trim() !== state.target;

  return (
    <ChannelCard icon={<IconMail size={18} />} title={t("notif.email")} hint={t("notif.emailHint")}>
      {!state.available ? (
        <Text size="sm" c="dimmed">
          {t("notif.emailUnavailable")}
        </Text>
      ) : (
        <>
          <Group align="flex-end" gap="xs" wrap="wrap">
            <TextInput
              label={t("notif.emailAddress")}
              type="email"
              autoComplete="email"
              value={value}
              onChange={(e) => setAddress(e.currentTarget.value)}
              style={{ flex: "1 1 260px", maxWidth: 420 }}
            />
            <Button
              disabled={!dirty || !value.trim()}
              loading={save.isPending}
              onClick={() =>
                save.mutate({ target: value.trim() }, { onSuccess: () => setAddress(null) })
              }
            >
              {t("common.save")}
            </Button>
          </Group>
          <Footer state={state} actions={actions} />
        </>
      )}
    </ChannelCard>
  );
}

export function WebhookChannelCard() {
  const { t } = useTranslation();
  const state = useChannel("webhook");
  const actions = useChannelActions("webhook");
  const { save } = actions;
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  if (!state || !state.available) return null;

  const submit = () => {
    const body: { target?: string; secret?: string } = {};
    if (url.trim()) body.target = url.trim();
    if (secret.trim()) body.secret = secret.trim();
    save.mutate(body, {
      onSuccess: () => {
        setUrl("");
        setSecret("");
      },
    });
  };

  return (
    <ChannelCard
      icon={<IconWebhook size={18} />}
      title={t("notif.webhook")}
      hint={
        <>
          {t("notif.webhookHint")} <GuideLink section="the-webhook" />
        </>
      }
    >
      <Group align="flex-end" gap="xs" wrap="wrap">
        <TextInput
          label={t("notif.webhookUrl")}
          placeholder={
            state.configured
              ? t("notif.webhookSaved", { host: state.target })
              : "https://homeassistant.local:8123/api/webhook/…"
          }
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          autoComplete="off"
          style={{ flex: "2 1 300px", maxWidth: 520 }}
        />
        <PasswordInput
          label={t("notif.webhookSecret")}
          placeholder={state.hasSecret ? t("notif.secretSaved") : t("notif.optional")}
          value={secret}
          onChange={(e) => setSecret(e.currentTarget.value)}
          autoComplete="new-password"
          style={{ flex: "1 1 180px", maxWidth: 260 }}
        />
        <Button
          disabled={state.configured ? !url.trim() && !secret.trim() : !url.trim()}
          loading={save.isPending}
          onClick={submit}
        >
          {t("common.save")}
        </Button>
      </Group>
      <Footer state={state} actions={actions} />
    </ChannelCard>
  );
}

export function MatrixChannelCard() {
  const { t } = useTranslation();
  const state = useChannel("matrix");
  const actions = useChannelActions("matrix");
  const { save } = actions;
  const [room, setRoom] = useState<string | null>(null);
  const [server, setServer] = useState<string | null>(null);
  const [token, setToken] = useState("");
  if (!state || !state.available) return null;

  // A bot of the reader's own, unless the installation has a shared one and
  // the reader has not saved their own.
  const own = state.server !== "" || !state.shared;
  const roomValue = room ?? state.target;
  const serverValue = server ?? state.server;
  const changed =
    roomValue.trim() !== state.target ||
    (own && serverValue.trim() !== state.server) ||
    token.trim() !== "";
  const complete =
    roomValue.trim() !== "" &&
    (!own || (serverValue.trim() !== "" && (token.trim() !== "" || state.hasSecret)));
  const hint = !own
    ? state.bot
      ? t("notif.matrixHintShared", { bot: state.bot })
      : t("notif.matrixHintSharedNoBot")
    : t("notif.matrixHint");

  const submit = () => {
    const body: { target: string; server?: string; secret?: string } = { target: roomValue.trim() };
    if (own) body.server = serverValue.trim();
    if (token.trim()) body.secret = token.trim();
    save.mutate(body, {
      onSuccess: () => {
        setRoom(null);
        setServer(null);
        setToken("");
      },
    });
  };

  return (
    <ChannelCard
      icon={<IconBrandMatrix size={18} />}
      title={t("notif.matrix")}
      hint={
        <>
          {hint} <GuideLink section="matrix" />
        </>
      }
    >
      <Group align="flex-end" gap="xs" wrap="wrap">
        {own && (
          <TextInput
            label={t("notif.matrixServer")}
            placeholder="https://matrix.org"
            value={serverValue}
            onChange={(e) => setServer(e.currentTarget.value)}
            autoComplete="off"
            style={{ flex: "1 1 200px", maxWidth: 300 }}
          />
        )}
        <TextInput
          label={t("notif.matrixRoom")}
          placeholder="!abcdefgh:matrix.org"
          value={roomValue}
          onChange={(e) => setRoom(e.currentTarget.value)}
          autoComplete="off"
          style={{ flex: "1 1 220px", maxWidth: own ? 300 : 420 }}
        />
        {own && (
          <PasswordInput
            label={t("notif.matrixToken")}
            placeholder={state.hasSecret ? t("notif.secretSaved") : undefined}
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
            autoComplete="new-password"
            style={{ flex: "1 1 180px", maxWidth: 240 }}
          />
        )}
        <Button disabled={!changed || !complete} loading={save.isPending} onClick={submit}>
          {t("common.save")}
        </Button>
      </Group>
      <Footer state={state} actions={actions} />
    </ChannelCard>
  );
}
