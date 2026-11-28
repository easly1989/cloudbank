import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  CopyButton,
  Divider,
  Grid,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconLock,
  IconPlug,
  IconServer,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import {
  ApiError,
  getOidcSettings,
  saveOidcSettings,
  turnOffOidc,
  type OidcSettings,
} from "../api/client";
import { notifyError } from "../notifyError";
import { useConfirm } from "./confirmContext";
import { SettingRow } from "../pages/settings/SettingRow";
import { draftFrom, issuerHost, saveAction, scopesHaveOpenid, type OidcDraft } from "./oidcForm";

const CALLBACK_PATH = "/api/v1/auth/oidc/callback";
const mono = { input: { fontFamily: "var(--mantine-font-family-monospace)" } };

/** Settings › Security › Single sign-on (#796), for administrators: a row like
 *  two-factor's, whose button opens the provider's fields in a modal. */
export function OidcSettingsGroup() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // In the light scheme a light badge's text is under 4.5:1 on its own tint:
  // the 9 shade reads, and teal also needs its palest background (4.7:1).
  const light = useComputedColorScheme("light") === "light";
  const query = useQuery({ queryKey: ["oidcSettings"], queryFn: getOidcSettings });
  const s = query.data;
  if (!s) return null;

  const env = s.source === "env";
  const badge = env ? (
    <Badge color="blue" variant="light" c={light ? "blue.9" : undefined}>
      {t("sso.badgeEnv")}
    </Badge>
  ) : s.enabled ? (
    <Badge
      color="teal"
      variant="light"
      c={light ? "teal.9" : undefined}
      bg={light ? "teal.0" : undefined}
    >
      {t("sso.badgeOn")}
    </Badge>
  ) : (
    <Badge color="gray" variant="light">
      {t("sso.badgeOff")}
    </Badge>
  );

  return (
    <>
      <SettingRow
        id="sso"
        testId="sso-settings"
        description={
          s.enabled ? (
            <Trans
              i18nKey="sso.rowOn"
              values={{ provider: s.name, host: issuerHost(s.issuer) }}
              components={{ b: <b />, code: <Text span ff="monospace" fz={12} /> }}
            />
          ) : (
            t("sso.rowOff")
          )
        }
        control={
          <>
            {badge}
            <Status s={s} />
            {env ? (
              <Button variant="default" onClick={() => setOpen(true)}>
                {t("sso.view")}
              </Button>
            ) : s.enabled ? (
              <Button variant="default" onClick={() => setOpen(true)}>
                {t("sso.edit")}
              </Button>
            ) : (
              <Button onClick={() => setOpen(true)}>{t("sso.configure")}</Button>
            )}
          </>
        }
      />
      <Modal opened={open} onClose={() => setOpen(false)} title={t("sso.title")} size="lg">
        <OidcForm s={s} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function Status({ s }: { s: OidcSettings }) {
  const { t } = useTranslation();
  const color = !s.enabled
    ? "var(--mantine-color-gray-4)"
    : s.reachable
      ? "var(--mantine-color-teal-6)"
      : "var(--mantine-color-red-6)";
  const label = !s.enabled
    ? t("sso.noProvider")
    : t(s.reachable ? "sso.reachable" : "sso.unreachable", { count: s.linkedUsers });
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={8} h={8} style={{ borderRadius: 4, background: color, flexShrink: 0 }} />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

/** A field's label, marked with the variable it comes from when one sets it. */
function label(text: string, envVar: string | false) {
  if (!envVar) return text;
  return (
    <Group component="span" gap={8} wrap="nowrap" style={{ display: "inline-flex" }}>
      {text}
      <Text span fz={12} fw={400} ff="monospace" c="dimmed">
        CB_OIDC_{envVar}
      </Text>
    </Group>
  );
}

function OidcForm({ s, onClose }: { s: OidcSettings; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [d, setD] = useState<OidcDraft>(() => draftFrom(s));
  const [issuerFailed, setIssuerFailed] = useState(false);
  const issuerRef = useRef<HTMLInputElement>(null);
  const env = s.source === "env";
  const noKey = !env && !s.secretKey;
  // A saved address stays: opening Settings from another address (a LAN IP,
  // localhost) must not move the callback the provider has registered.
  const callback = s.redirectUrl || window.location.origin + CALLBACK_PATH;
  const action = saveAction(s, d);
  const set = (patch: Partial<OidcDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const lock = env ? <IconLock size={16} aria-hidden /> : undefined;

  const done = (next?: OidcSettings) => {
    if (next) qc.setQueryData(["oidcSettings"], next);
    else void qc.invalidateQueries({ queryKey: ["oidcSettings"] });
    // The login page reads whether SSO is on from here.
    void qc.invalidateQueries({ queryKey: ["authConfig"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => saveOidcSettings({ ...d, redirectUrl: callback }),
    onSuccess: (next) => done(next),
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === "provider_unreachable") {
        setIssuerFailed(true);
        issuerRef.current?.focus();
      } else notifyError(err);
    },
  });
  const confirm = useConfirm();
  const askTurnOff = async () => {
    const body = [t("sso.turnOffBody")];
    if (s.linkedUsers > 0) body.push(t("sso.turnOffLinked", { count: s.linkedUsers }));
    const ok = await confirm({
      title: t("sso.turnOffTitle"),
      body: body.join(" "),
      confirmLabel: t("sso.turnOffConfirm"),
      danger: true,
    });
    if (ok) off.mutate();
  };
  const off = useMutation({
    mutationFn: turnOffOidc,
    onSuccess: () => done(),
    onError: (err: unknown) => notifyError(err),
  });

  const secret = noKey ? (
    <TextInput
      label={t("sso.secret")}
      placeholder={t("sso.secretNoKey")}
      description={t("sso.secretNoKeyHint")}
      inputWrapperOrder={["label", "input", "description"]}
      disabled
    />
  ) : env ? (
    <TextInput
      label={label(t("sso.secret"), "CLIENT_SECRET")}
      value={s.hasSecret ? "••••••••••••" : ""}
      readOnly
      rightSection={lock}
    />
  ) : (
    <PasswordInput
      label={t("sso.secret")}
      placeholder={action.keepsSecret ? t("sso.secretSaved") : t("sso.secretPaste")}
      description={action.keepsSecret ? t("sso.secretKeep") : t("sso.secretNew")}
      inputWrapperOrder={["label", "input", "description"]}
      autoComplete="off"
      value={d.clientSecret}
      onChange={(e) => set({ clientSecret: e.currentTarget.value })}
    />
  );

  return (
    <Stack gap="md">
      {env && (
        <Alert color="blue" icon={<IconServer size={16} />} title={t("sso.envTitle")}>
          <Trans
            i18nKey="sso.envBody"
            components={{ code: <Text span ff="monospace" fz="sm" /> }}
          />
        </Alert>
      )}
      {noKey && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title={t("sso.noKeyTitle")}>
          {t("sso.noKeyBody")}
        </Alert>
      )}
      {action.warnLinks && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title={t("sso.issuerTitle")}>
          <Trans
            i18nKey="sso.issuerBody"
            count={s.linkedUsers}
            values={{ count: s.linkedUsers, host: issuerHost(s.issuer) }}
            components={{ code: <Text span ff="monospace" fz="sm" /> }}
          />
          {s.ssoOnly && <> {t("sso.issuerSsoOnly")}</>}
        </Alert>
      )}
      <Grid>
        <Grid.Col span={12}>
          <TextInput
            label={label(t("sso.issuer"), env && "ISSUER")}
            placeholder="https://auth.example.com"
            description={issuerFailed ? undefined : t("sso.issuerHint")}
            inputWrapperOrder={["label", "input", "description", "error"]}
            error={issuerFailed ? t("sso.issuerFailed") : undefined}
            ref={issuerRef}
            styles={mono}
            value={d.issuer}
            readOnly={env}
            rightSection={lock}
            onChange={(e) => {
              set({ issuer: e.currentTarget.value });
              setIssuerFailed(false);
            }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label={label(t("sso.clientId"), env && "CLIENT_ID")}
            placeholder="cloudbank"
            styles={mono}
            value={d.clientId}
            readOnly={env}
            rightSection={lock}
            onChange={(e) => set({ clientId: e.currentTarget.value })}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>{secret}</Grid.Col>
        <Grid.Col span={12}>
          <TextInput
            label={label(t("sso.callback"), env && "REDIRECT_URL")}
            variant="filled"
            description={t("sso.callbackHint")}
            inputWrapperOrder={["label", "input", "description"]}
            styles={mono}
            value={callback}
            readOnly
            rightSection={
              <CopyButton value={callback}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? t("sso.copied") : t("sso.copy")} withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={copy}
                      aria-label={t("sso.copy")}
                    >
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            }
          />
        </Grid.Col>
      </Grid>
      <Divider />
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label={label(t("sso.name"), env && "NAME")}
            description={t("sso.nameHint", {
              button: t("login.ssoSignIn", { provider: d.name.trim() || "SSO" }),
            })}
            inputWrapperOrder={["label", "input", "description"]}
            value={d.name}
            readOnly={env}
            rightSection={lock}
            onChange={(e) => set({ name: e.currentTarget.value })}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label={label(t("sso.scopes"), env && "SCOPES")}
            error={scopesHaveOpenid(d.scopes) ? undefined : t("sso.scopesOpenid")}
            styles={mono}
            value={d.scopes}
            readOnly={env}
            rightSection={lock}
            onChange={(e) => set({ scopes: e.currentTarget.value })}
          />
        </Grid.Col>
        <Grid.Col span={12}>
          <Switch
            label={label(t("sso.autoProvision"), env && "AUTO_PROVISION")}
            description={t("sso.autoProvisionHint")}
            checked={d.autoProvision}
            disabled={env}
            onChange={(e) => set({ autoProvision: e.currentTarget.checked })}
          />
        </Grid.Col>
        <Grid.Col span={12}>
          <TextInput
            label={label(t("sso.adminEmail"), env && "ADMIN_EMAIL")}
            placeholder={t("sso.adminEmailNone")}
            description={t("sso.adminEmailHint")}
            inputWrapperOrder={["label", "input", "description"]}
            value={d.adminEmail}
            readOnly={env}
            rightSection={lock}
            onChange={(e) => set({ adminEmail: e.currentTarget.value })}
          />
        </Grid.Col>
      </Grid>
      {env ? (
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("common.close")}
          </Button>
        </Group>
      ) : (
        <Group justify="space-between" gap="sm">
          <div>
            {s.source === "settings" && !s.ssoOnly && (
              <Button
                variant="subtle"
                color="red"
                c="var(--mantine-color-red-text)"
                loading={off.isPending}
                onClick={() => void askTurnOff()}
              >
                {t("sso.turnOff")}
              </Button>
            )}
          </div>
          <Group gap="sm">
            <Button variant="default" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              leftSection={<IconPlug size={16} />}
              disabled={!action.ready}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              {action.kind === "turnOn"
                ? t("sso.turnOn")
                : action.kind === "changeProvider"
                  ? t("sso.changeProvider")
                  : t("common.save")}
            </Button>
          </Group>
        </Group>
      )}
    </Stack>
  );
}
