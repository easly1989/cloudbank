import {
  Button,
  Card,
  Group,
  PasswordInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  NOTIFICATION_CHANNELS_KEY as CHANNELS_KEY,
  deleteNotificationChannel,
  listNotificationChannels,
  saveNotificationChannel,
  testNotificationChannel,
  type AddressedChannel,
  type NotificationChannelOptions,
  type NotificationChannelState,
} from "../api/client";
import { errorColor } from "../amountTone";
import { useAuth } from "../auth/AuthProvider";
import { notifyError } from "../notifyError";

// How a reader connects each channel that needs an address of their own
// (#686–#688), on that channel's page in Settings › Notifications. Each card
// says how the last delivery went and can send a test.

const REASONS = ["unauthorized", "rejected", "unreachable", "local"];

/** The channel's state from the server, shared with the overview. */
// eslint-disable-next-line react-refresh/only-export-components
export function useChannel(channel: AddressedChannel) {
  const { data } = useQuery({ queryKey: CHANNELS_KEY, queryFn: listNotificationChannels });
  return data?.channels.find((c) => c.channel === channel);
}

/** "Last delivery failed: 401", in words where the server gave a reason. */
// eslint-disable-next-line react-refresh/only-export-components
export function failureText(t: TFunction, error: string) {
  const reason = REASONS.includes(error) ? t(`notif.reason.${error}`) : error;
  return t("notif.lastError", { reason });
}

/** "Last delivery failed: 401", or when it last went through. */
function Status({ state }: { state: NotificationChannelState }) {
  const { t, i18n } = useTranslation();
  if (state.lastError) {
    return (
      <Text size="sm" c={errorColor} role="status">
        {failureText(t, state.lastError)}
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

type SaveBody = {
  target?: string;
  secret?: string;
  server?: string;
  options?: NotificationChannelOptions;
};

/** Save, send a test, remove: the same three for every channel. */
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
    mutationFn: (body: SaveBody) => saveNotificationChannel(channel, body),
    onSuccess: () => notifications.show({ color: "green", message: t("notif.saved") }),
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

type Actions = ReturnType<typeof useChannelActions>;

/** How the last delivery went, with Remove and Send a test, once saved. */
function Footer({
  state,
  actions: { test, remove },
}: {
  state: NotificationChannelState;
  actions: Actions;
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

function SetupCard({ children }: { children: ReactNode }) {
  return (
    <Card withBorder>
      <Stack gap="md">{children}</Stack>
    </Card>
  );
}

/** A form that runs down the card, one field under the other, for a bot. */
const FIELD = { maw: 460 };

function EmailSetup() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const state = useChannel("email");
  const actions = useChannelActions("email");
  const [address, setAddress] = useState<string | null>(null);
  if (!state) return null;
  if (!state.available) {
    return (
      <SetupCard>
        <Text size="sm" c="dimmed">
          {t("notif.emailUnavailable")}
        </Text>
      </SetupCard>
    );
  }
  const value = address ?? (state.configured ? state.target : (user?.email ?? ""));
  const dirty = !state.configured || value.trim() !== state.target;
  return (
    <SetupCard>
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
          loading={actions.save.isPending}
          onClick={() =>
            actions.save.mutate({ target: value.trim() }, { onSuccess: () => setAddress(null) })
          }
        >
          {t("common.save")}
        </Button>
      </Group>
      <Footer state={state} actions={actions} />
    </SetupCard>
  );
}

/**
 * "CloudBank's bot" or "Your bot", shown when the installation has a shared
 * one; without it there is only the reader's own.
 */
function ModeSwitch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      data={[
        { value: "shared", label: t("notif.mode.shared") },
        { value: "own", label: t("notif.mode.own") },
      ]}
      style={{ alignSelf: "flex-start" }}
    />
  );
}

function MatrixSetup() {
  const { t } = useTranslation();
  const state = useChannel("matrix");
  const actions = useChannelActions("matrix");
  const [mode, setMode] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [server, setServer] = useState<string | null>(null);
  const [token, setToken] = useState("");
  if (!state || !state.available) return null;

  const savedOwn = state.server !== "" || !state.shared;
  const own = (mode ?? (savedOwn ? "own" : "shared")) === "own";
  const roomValue = room ?? state.target;
  const serverValue = server ?? state.server;
  // A token is needed unless the reader's own bot already has one saved.
  const tokenKept = savedOwn && state.hasSecret;
  const changed =
    own !== savedOwn ||
    roomValue.trim() !== state.target ||
    (own && serverValue.trim() !== state.server) ||
    token.trim() !== "";
  const complete =
    roomValue.trim() !== "" &&
    (!own || (serverValue.trim() !== "" && (token.trim() !== "" || tokenKept)));

  const submit = () => {
    const body: SaveBody = { target: roomValue.trim(), server: own ? serverValue.trim() : "" };
    if (own && token.trim()) body.secret = token.trim();
    actions.save.mutate(body, {
      onSuccess: () => {
        setMode(null);
        setRoom(null);
        setServer(null);
        setToken("");
      },
    });
  };

  return (
    <SetupCard>
      {state.shared && <ModeSwitch value={own ? "own" : "shared"} onChange={setMode} />}
      {!own && (
        <Text size="sm">
          {state.bot
            ? t("notif.matrixHintShared", { bot: state.bot })
            : t("notif.matrixHintSharedNoBot")}
        </Text>
      )}
      <Stack gap="sm">
        {own && (
          <TextInput
            {...FIELD}
            label={t("notif.matrixServer")}
            placeholder="https://matrix.org"
            value={serverValue}
            onChange={(e) => setServer(e.currentTarget.value)}
            autoComplete="off"
          />
        )}
        <TextInput
          {...FIELD}
          label={t("notif.matrixRoom")}
          description={t("notif.matrixRoomHelp")}
          placeholder="!abcdefgh:matrix.org"
          value={roomValue}
          onChange={(e) => setRoom(e.currentTarget.value)}
          autoComplete="off"
        />
        {own && (
          <PasswordInput
            {...FIELD}
            label={t("notif.matrixToken")}
            placeholder={tokenKept ? t("notif.secretSaved") : undefined}
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
            autoComplete="new-password"
          />
        )}
        <Group>
          <Button
            disabled={!changed || !complete}
            loading={actions.save.isPending}
            onClick={submit}
          >
            {t("common.save")}
          </Button>
        </Group>
      </Stack>
      <Footer state={state} actions={actions} />
    </SetupCard>
  );
}

function TelegramSetup() {
  const { t } = useTranslation();
  const state = useChannel("telegram");
  const actions = useChannelActions("telegram");
  const [mode, setMode] = useState<string | null>(null);
  const [chat, setChat] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [silent, setSilent] = useState<boolean | null>(null);
  if (!state || !state.available) return null;

  const savedOwn = state.hasSecret || !state.shared;
  const own = (mode ?? (savedOwn ? "own" : "shared")) === "own";
  const chatValue = chat ?? state.target;
  const topicValue = topic ?? (state.options.topic ? String(state.options.topic) : "");
  const silentValue = silent ?? !!state.options.silent;
  const tokenKept = savedOwn && state.hasSecret;
  const topicOK = /^\d*$/.test(topicValue.trim());
  const changed =
    own !== savedOwn ||
    chatValue.trim() !== state.target ||
    token.trim() !== "" ||
    topicValue.trim() !== (state.options.topic ? String(state.options.topic) : "") ||
    silentValue !== !!state.options.silent;
  const complete = chatValue.trim() !== "" && topicOK && (!own || token.trim() !== "" || tokenKept);

  const submit = () => {
    const options: NotificationChannelOptions = { silent: silentValue };
    if (topicValue.trim()) options.topic = Number(topicValue.trim());
    // Back to the shared bot drops the reader's own token.
    const body: SaveBody = { target: chatValue.trim(), options };
    if (!own) body.secret = "";
    else if (token.trim()) body.secret = token.trim();
    actions.save.mutate(body, {
      onSuccess: () => {
        setMode(null);
        setChat(null);
        setToken("");
        setTopic(null);
        setSilent(null);
      },
    });
  };

  return (
    <SetupCard>
      {state.shared && <ModeSwitch value={own ? "own" : "shared"} onChange={setMode} />}
      {!own && (
        <Text size="sm">
          {state.bot
            ? t("notif.telegramHintShared", { bot: state.bot })
            : t("notif.telegramHintSharedNoBot")}
        </Text>
      )}
      <Stack gap="sm">
        {own && (
          <PasswordInput
            {...FIELD}
            label={t("notif.telegramToken")}
            description={t("notif.telegramTokenHelp")}
            placeholder={tokenKept ? t("notif.secretSaved") : "123456:ABC…"}
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
            autoComplete="new-password"
          />
        )}
        <TextInput
          {...FIELD}
          label={t("notif.telegramChat")}
          description={t("notif.telegramChatHelp")}
          placeholder="123456789"
          value={chatValue}
          onChange={(e) => setChat(e.currentTarget.value)}
          autoComplete="off"
        />
        <TextInput
          {...FIELD}
          label={t("notif.telegramTopic")}
          description={t("notif.telegramTopicHelp")}
          value={topicValue}
          onChange={(e) => setTopic(e.currentTarget.value)}
          error={topicOK ? undefined : t("notif.telegramTopicInvalid")}
          inputMode="numeric"
          autoComplete="off"
        />
        <Switch
          label={t("notif.telegramSilent")}
          description={t("notif.telegramSilentHelp")}
          checked={silentValue}
          onChange={(e) => setSilent(e.currentTarget.checked)}
        />
        <Group>
          <Button
            disabled={!changed || !complete}
            loading={actions.save.isPending}
            onClick={submit}
          >
            {t("common.save")}
          </Button>
        </Group>
      </Stack>
      <Footer state={state} actions={actions} />
    </SetupCard>
  );
}

/** A chat service's incoming webhook (Discord, Slack): one URL, its key. */
function IncomingWebhookSetup({
  channel,
  placeholder,
}: {
  channel: "discord" | "slack";
  placeholder: string;
}) {
  const { t } = useTranslation();
  const state = useChannel(channel);
  const actions = useChannelActions(channel);
  const [url, setUrl] = useState("");
  if (!state || !state.available) return null;
  return (
    <SetupCard>
      <Group align="flex-end" gap="xs" wrap="wrap">
        <TextInput
          label={t("notif.webhookUrl")}
          placeholder={
            state.configured ? t("notif.webhookSaved", { host: state.target }) : placeholder
          }
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          autoComplete="off"
          style={{ flex: "1 1 300px", maxWidth: 520 }}
        />
        <Button
          disabled={!url.trim()}
          loading={actions.save.isPending}
          onClick={() =>
            actions.save.mutate({ target: url.trim() }, { onSuccess: () => setUrl("") })
          }
        >
          {t("common.save")}
        </Button>
      </Group>
      <Footer state={state} actions={actions} />
    </SetupCard>
  );
}

function WebhookSetup() {
  const { t } = useTranslation();
  const state = useChannel("webhook");
  const actions = useChannelActions("webhook");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  if (!state || !state.available) return null;

  const submit = () => {
    const body: SaveBody = {};
    if (url.trim()) body.target = url.trim();
    if (secret.trim()) body.secret = secret.trim();
    actions.save.mutate(body, {
      onSuccess: () => {
        setUrl("");
        setSecret("");
      },
    });
  };

  return (
    <SetupCard>
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
          loading={actions.save.isPending}
          onClick={submit}
        >
          {t("common.save")}
        </Button>
      </Group>
      <Footer state={state} actions={actions} />
    </SetupCard>
  );
}

/** The connection card on a channel's page. */
export function ChannelSetup({ channel }: { channel: AddressedChannel }) {
  switch (channel) {
    case "email":
      return <EmailSetup />;
    case "matrix":
      return <MatrixSetup />;
    case "telegram":
      return <TelegramSetup />;
    case "discord":
      return (
        <IncomingWebhookSetup channel="discord" placeholder="https://discord.com/api/webhooks/…" />
      );
    case "slack":
      return (
        <IncomingWebhookSetup channel="slack" placeholder="https://hooks.slack.com/services/…" />
      );
    case "webhook":
      return <WebhookSetup />;
  }
}
