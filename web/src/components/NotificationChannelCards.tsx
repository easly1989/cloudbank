import {
  Anchor,
  Box,
  Button,
  Card,
  Group,
  Loader,
  PasswordInput,
  PinInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBrandTelegram } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  NOTIFICATION_CHANNELS_KEY as CHANNELS_KEY,
  confirmNotificationChannel,
  deleteNotificationChannel,
  listNotificationChannels,
  resendNotificationCode,
  saveNotificationChannel,
  testNotificationChannel,
  type AddressedChannel,
  type NotificationChannelOptions,
  type NotificationChannelState,
} from "../api/client";
import { errorColor } from "../amountTone";
import { useAuth } from "../auth/AuthProvider";
import { notifyError } from "../notifyError";
import classes from "./NotificationChannelCards.module.css";

// How a reader connects each channel that needs an address of their own
// (#686–#688), on that channel's page in Settings › Notifications. Each card
// says how the last delivery went and can send a test.

const REASONS = ["unauthorized", "rejected", "unreachable", "local", "limited"];

/**
 * The channel's state from the server, shared with the overview; poll asks
 * again every few seconds, while a Telegram link waits to be used.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useChannel(channel: AddressedChannel, poll = false) {
  const { data } = useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: listNotificationChannels,
    refetchInterval: poll ? 3000 : false,
  });
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

/** Why a save, or a new code, failed (#716), in the reader's words. */
function useSaveError() {
  const { t } = useTranslation();
  return (err: unknown) => {
    const say = (message: string) => notifications.show({ color: "red", message });
    if (!(err instanceof ApiError)) return notifyError(err);
    switch (err.code) {
      case "local_network":
        return say(t("notif.localNetwork"));
      case "invalid":
        return say(t("notif.invalidAddress"));
      case "not_invited":
        return say(t("notif.notInvited"));
      case "delivery_failed": {
        const r = err.message;
        return say(
          t("notif.codeFailed", { reason: REASONS.includes(r) ? t(`notif.reason.${r}`) : r }),
        );
      }
      default:
        return notifyError(err);
    }
  };
}

/** Save, send a test, remove: the same three for every channel. */
function useChannelActions(channel: AddressedChannel) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: CHANNELS_KEY });
  const saveError = useSaveError();
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

/** How the last delivery went, with Remove and, once confirmed, Send a test. */
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
        {!state.pending && (
          <Button variant="default" loading={test.isPending} onClick={() => test.mutate()}>
            {t("notif.sendTest")}
          </Button>
        )}
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

/** The code an address was sent, typed back to confirm it (#716). */
function CodeConfirm({ channel, children }: { channel: "email" | "matrix"; children?: ReactNode }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const saveError = useSaveError();
  const [code, setCode] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: CHANNELS_KEY });
  const confirm = useMutation({
    mutationFn: () => confirmNotificationChannel(channel, code),
    onSuccess: () => notifications.show({ color: "green", message: t("notif.confirmed") }),
    onError: (err) => {
      setCode("");
      if (err instanceof ApiError && err.code === "wrong_code") {
        notifications.show({ color: "red", message: t("notif.wrongCode") });
      } else if (err instanceof ApiError && err.code === "code_expired") {
        notifications.show({ color: "red", message: t("notif.codeExpired") });
      } else {
        notifyError(err);
      }
    },
    onSettled: refresh,
  });
  const resend = useMutation({
    mutationFn: () => resendNotificationCode(channel),
    onSuccess: () => notifications.show({ color: "green", message: t("notif.codeResent") }),
    onError: saveError,
  });
  return (
    <Stack gap="xs" className={classes.confirm}>
      {children && <Text size="sm">{children}</Text>}
      <Group gap="xs" wrap="wrap">
        <PinInput
          length={6}
          type="number"
          oneTimeCode
          value={code}
          onChange={setCode}
          aria-label={t("notif.code")}
        />
        <Button
          disabled={code.length < 6}
          loading={confirm.isPending}
          onClick={() => confirm.mutate()}
        >
          {t("notif.confirm")}
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        {t("notif.codeValid")}{" "}
        <Anchor component="button" type="button" size="xs" onClick={() => resend.mutate()}>
          {t("notif.resend")}
        </Anchor>
      </Text>
    </Stack>
  );
}

/** One numbered step of a setup that takes several. */
function Step({
  n,
  done,
  text,
  children,
}: {
  n: number;
  done?: boolean;
  text: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Group align="flex-start" gap="sm" wrap="nowrap">
      <Box className={classes.step} data-done={done || undefined} aria-hidden>
        {n}
      </Box>
      <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" c={done ? "dimmed" : undefined}>
          {text}
        </Text>
        {children}
      </Stack>
    </Group>
  );
}

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
      {state.pending && (
        <CodeConfirm channel="email">
          {t("notif.emailCodeSent", { address: state.target })}
        </CodeConfirm>
      )}
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
  // With the shared bot: the room waits for the code the bot wrote in it.
  const pending = !own && !savedOwn && state.pending;
  const linked = !own && !savedOwn && state.configured && !state.pending;

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

  const roomInput = (
    <TextInput
      {...FIELD}
      label={t("notif.matrixRoom")}
      description={t("notif.matrixRoomHelp")}
      placeholder="!abcdefgh:matrix.org"
      value={roomValue}
      onChange={(e) => setRoom(e.currentTarget.value)}
      autoComplete="off"
    />
  );
  const saveButton = (label: string) => (
    <Group>
      <Button disabled={!changed || !complete} loading={actions.save.isPending} onClick={submit}>
        {label}
      </Button>
    </Group>
  );

  return (
    <SetupCard>
      {state.shared && <ModeSwitch value={own ? "own" : "shared"} onChange={setMode} />}
      {own ? (
        <Stack gap="sm">
          <TextInput
            {...FIELD}
            label={t("notif.matrixServer")}
            placeholder="https://matrix.org"
            value={serverValue}
            onChange={(e) => setServer(e.currentTarget.value)}
            autoComplete="off"
          />
          {roomInput}
          <PasswordInput
            {...FIELD}
            label={t("notif.matrixToken")}
            placeholder={tokenKept ? t("notif.secretSaved") : undefined}
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
            autoComplete="new-password"
          />
          {saveButton(t("common.save"))}
        </Stack>
      ) : linked ? (
        <Text size="sm">{t("notif.linkedTo", { target: state.target })}</Text>
      ) : (
        <Stack gap="md">
          <Step
            n={1}
            done={pending}
            text={
              state.bot
                ? t("notif.matrixStepInvite", { bot: state.bot })
                : t("notif.matrixStepInviteNoBot")
            }
          />
          <Step n={2} done={pending} text={t("notif.matrixStepRoom")}>
            {roomInput}
            {saveButton(t("notif.link"))}
          </Step>
          {pending && (
            <Step n={3} text={t("notif.matrixStepCode")}>
              <CodeConfirm channel="matrix" />
            </Step>
          )}
        </Stack>
      )}
      <Footer state={state} actions={actions} />
    </SetupCard>
  );
}

function TelegramSetup() {
  const { t } = useTranslation();
  const peek = useChannel("telegram");
  // While a link waits to be used, ask the server until the chat shows up.
  const state = useChannel("telegram", !!peek?.pending);
  const actions = useChannelActions("telegram");
  const saveError = useSaveError();
  const qc = useQueryClient();
  const newLink = useMutation({
    mutationFn: () => resendNotificationCode("telegram"),
    onError: saveError,
    onSettled: () => qc.invalidateQueries({ queryKey: CHANNELS_KEY }),
  });
  const [mode, setMode] = useState<string | null>(null);
  const [chat, setChat] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [silent, setSilent] = useState<boolean | null>(null);
  if (!state || !state.available) return null;

  const savedOwn = state.hasSecret || !state.shared;
  const own = (mode ?? (savedOwn ? "own" : "shared")) === "own";
  const chatValue = chat ?? (savedOwn ? state.target : "");
  const savedTopic = state.options.topic ? String(state.options.topic) : "";
  const topicValue = topic ?? savedTopic;
  const silentValue = silent ?? !!state.options.silent;
  const tokenKept = savedOwn && state.hasSecret;
  const topicOK = /^\d*$/.test(topicValue.trim());
  const optionsChanged = topicValue.trim() !== savedTopic || silentValue !== !!state.options.silent;
  const changed =
    own !== savedOwn || chatValue.trim() !== state.target || token.trim() !== "" || optionsChanged;
  const complete = chatValue.trim() !== "" && topicOK && (token.trim() !== "" || tokenKept);
  const pending = !own && !savedOwn && state.pending;
  const linked = !own && !savedOwn && state.configured && !state.pending;

  const options = (): NotificationChannelOptions => {
    const o: NotificationChannelOptions = { silent: silentValue };
    if (topicValue.trim()) o.topic = Number(topicValue.trim());
    return o;
  };
  const reset = () => {
    setMode(null);
    setChat(null);
    setToken("");
    setTopic(null);
    setSilent(null);
  };
  // The shared bot takes no chat from the page: the link tells it which.
  const shared = (opts?: NotificationChannelOptions) =>
    actions.save.mutate({ target: "", secret: "", options: opts }, { onSuccess: reset });
  const submitOwn = () => {
    const body: SaveBody = { target: chatValue.trim(), options: options() };
    if (token.trim()) body.secret = token.trim();
    actions.save.mutate(body, { onSuccess: reset });
  };

  const intro = state.bot
    ? t("notif.telegramSharedIntro", { bot: state.bot })
    : t("notif.telegramSharedIntroNoBot");
  const optionFields = (
    <>
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
    </>
  );

  return (
    <SetupCard>
      {state.shared && <ModeSwitch value={own ? "own" : "shared"} onChange={setMode} />}
      {own ? (
        <Stack gap="sm">
          <PasswordInput
            {...FIELD}
            label={t("notif.telegramToken")}
            description={t("notif.telegramTokenHelp")}
            placeholder={tokenKept ? t("notif.secretSaved") : "123456:ABC…"}
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
            autoComplete="new-password"
          />
          <TextInput
            {...FIELD}
            label={t("notif.telegramChat")}
            description={t("notif.telegramChatHelp")}
            placeholder="123456789"
            value={chatValue}
            onChange={(e) => setChat(e.currentTarget.value)}
            autoComplete="off"
          />
          {optionFields}
          <Group>
            <Button
              disabled={!changed || !complete}
              loading={actions.save.isPending}
              onClick={submitOwn}
            >
              {t("common.save")}
            </Button>
          </Group>
        </Stack>
      ) : linked ? (
        <Stack gap="sm">
          <Text size="sm">{t("notif.linkedTo", { target: state.target })}</Text>
          {optionFields}
          <Group>
            <Button
              disabled={!optionsChanged || !topicOK}
              loading={actions.save.isPending}
              onClick={() => shared(options())}
            >
              {t("common.save")}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Text size="sm">{intro}</Text>
          {!pending ? (
            <Group>
              <Button
                leftSection={<IconBrandTelegram size={16} />}
                loading={actions.save.isPending}
                onClick={() => shared()}
              >
                {t("notif.telegramLinkChat")}
              </Button>
            </Group>
          ) : state.link ? (
            <>
              <Group gap="xs" wrap="wrap">
                <Button
                  component="a"
                  href={state.link}
                  target="_blank"
                  rel="noreferrer"
                  leftSection={<IconBrandTelegram size={16} />}
                >
                  {t("notif.telegramLinkChat")}
                </Button>
                <Button
                  component="a"
                  href={state.groupLink}
                  target="_blank"
                  rel="noreferrer"
                  variant="default"
                >
                  {t("notif.telegramLinkGroup")}
                </Button>
              </Group>
              <Group gap="xs" wrap="nowrap" align="flex-start" role="status">
                <Loader size={14} mt={3} style={{ flex: "none" }} />
                <Text size="sm" c="dimmed">
                  {t("notif.telegramWaiting")}
                </Text>
              </Group>
            </>
          ) : (
            <Group gap="xs" wrap="wrap">
              <Text size="sm" c="dimmed">
                {t("notif.telegramNoLink")}
              </Text>
              <Button
                variant="default"
                loading={newLink.isPending}
                onClick={() => newLink.mutate()}
              >
                {t("notif.telegramNewLink")}
              </Button>
            </Group>
          )}
        </Stack>
      )}
      <Footer state={state} actions={actions} />
    </SetupCard>
  );
}

/** ntfy: a topic on ntfy.sh or the reader's own server, with an optional token. */
function NtfySetup() {
  const { t } = useTranslation();
  const state = useChannel("ntfy");
  const actions = useChannelActions("ntfy");
  const [server, setServer] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [token, setToken] = useState("");
  if (!state || !state.available) return null;
  // ntfy.sh is what an empty server means; show it empty too.
  const savedServer = state.server === NTFY_SH ? "" : state.server;
  const serverValue = server ?? savedServer;
  const topicValue = topic ?? state.target;
  const changed =
    !state.configured ||
    serverValue.trim().replace(/\/+$/, "") !== savedServer ||
    topicValue.trim() !== state.target ||
    token.trim() !== "";
  const submit = () => {
    const body: SaveBody = { target: topicValue.trim(), server: serverValue.trim() };
    if (token.trim()) body.secret = token.trim();
    actions.save.mutate(body, {
      onSuccess: () => {
        setServer(null);
        setTopic(null);
        setToken("");
      },
    });
  };
  return (
    <SetupCard>
      <Stack gap="sm">
        <TextInput
          {...FIELD}
          label={t("notif.selfServer")}
          description={t("notif.ntfyServerHelp")}
          placeholder={NTFY_SH}
          value={serverValue}
          onChange={(e) => setServer(e.currentTarget.value)}
          autoComplete="off"
        />
        <TextInput
          {...FIELD}
          label={t("notif.ntfyTopic")}
          description={t("notif.ntfyTopicHelp")}
          value={topicValue}
          onChange={(e) => setTopic(e.currentTarget.value)}
          autoComplete="off"
        />
        <PasswordInput
          {...FIELD}
          label={t("notif.ntfyToken")}
          description={t("notif.ntfyTokenHelp")}
          placeholder={state.hasSecret ? t("notif.secretSaved") : t("notif.optional")}
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
          autoComplete="new-password"
        />
        <Group>
          <Button
            disabled={!changed || !topicValue.trim()}
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

const NTFY_SH = "https://ntfy.sh";

/** Gotify: the reader's server and an application's token. */
function GotifySetup() {
  const { t } = useTranslation();
  const state = useChannel("gotify");
  const actions = useChannelActions("gotify");
  const [server, setServer] = useState<string | null>(null);
  const [token, setToken] = useState("");
  if (!state || !state.available) return null;
  const serverValue = server ?? state.server;
  const changed = serverValue.trim().replace(/\/+$/, "") !== state.server || token.trim() !== "";
  const complete = serverValue.trim() !== "" && (token.trim() !== "" || state.hasSecret);
  const submit = () => {
    const body: SaveBody = { server: serverValue.trim() };
    if (token.trim()) body.secret = token.trim();
    actions.save.mutate(body, {
      onSuccess: () => {
        setServer(null);
        setToken("");
      },
    });
  };
  return (
    <SetupCard>
      <Stack gap="sm">
        <TextInput
          {...FIELD}
          label={t("notif.selfServer")}
          placeholder="https://gotify.example.org"
          value={serverValue}
          onChange={(e) => setServer(e.currentTarget.value)}
          autoComplete="off"
        />
        <PasswordInput
          {...FIELD}
          label={t("notif.gotifyToken")}
          description={t("notif.gotifyTokenHelp")}
          placeholder={state.hasSecret ? t("notif.secretSaved") : undefined}
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
          autoComplete="new-password"
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
    case "ntfy":
      return <NtfySetup />;
    case "gotify":
      return <GotifySetup />;
    case "webhook":
      return <WebhookSetup />;
  }
}
