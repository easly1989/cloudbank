import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Divider,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconKey, IconLogin2 } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, isTotpChallenge } from "../api/client";
import { useAuthConfig, useLogin, useRecoveryLogin } from "../auth/AuthProvider";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { ErrorMessage } from "../components/ErrorMessage";
import {
  conditionalPasskeys,
  passkeyCancelled,
  passkeysSupported,
  signInWithPasskey,
} from "../passkey";

const SSO_START = "/api/v1/auth/oidc/start";

export function LoginPage() {
  const { t } = useTranslation();
  // Available login methods (whether OIDC/SSO is configured, whether there is
  // a password form) and any SSO error handed back by the callback redirect
  // (?sso_error=...).
  const authConfig = useAuthConfig();
  const ssoError = new URLSearchParams(window.location.search).get("sso_error");

  if (authConfig.isPending) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }
  const sso = authConfig.data?.oidc;
  // A server that signs in through SSO only (#620) has no password form; the
  // recovery code is its way in while the provider is down.
  const ssoOnly = authConfig.data?.passwordLogin === false && !!sso?.enabled;

  return (
    <Center mih="100vh">
      <Card withBorder w={360} p="lg">
        <Stack>
          <Title order={3}>{t("login.title")}</Title>
          {ssoOnly ? (
            <SsoOnlyForm provider={sso.name} ssoError={ssoError} />
          ) : (
            <PasswordForm
              sso={sso}
              ssoError={ssoError}
              passkeys={!!authConfig.data?.passkeys && passkeysSupported()}
            />
          )}
          <Stack gap="xs" align="center">
            <LanguageSwitcher />
            <ColorSchemeToggle />
          </Stack>
        </Stack>
      </Card>
    </Center>
  );
}

function PasswordForm({
  sso,
  ssoError,
  passkeys,
}: {
  sso: { enabled: boolean; name: string } | undefined;
  ssoError: string | null;
  passkeys: boolean;
}) {
  const { t } = useTranslation();
  const login = useLogin();
  const passkey = usePasskeySignIn(passkeys);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

  // After a correct password, a 2FA account gets a totp challenge; the form then
  // asks for the second factor and resubmits with it.
  const challenged = login.data ? isTotpChallenge(login.data) : false;

  const submit = () => login.mutate({ username, password, totpCode: totpCode.trim() || undefined });

  const error =
    login.error instanceof ApiError && login.error.status === 401 ? (
      challenged ? (
        t("login.invalidCode")
      ) : (
        t("login.invalid")
      )
    ) : login.error ? (
      <ErrorMessage error={login.error} />
    ) : null;

  const passkeyError =
    passkey.error instanceof ApiError && passkey.error.status === 401 ? (
      t("login.passkeyInvalid")
    ) : passkey.error instanceof ApiError && passkey.error.status === 429 ? (
      t("login.tooMany")
    ) : passkey.error ? (
      <ErrorMessage error={passkey.error} />
    ) : null;

  return (
    <>
      {error && <Alert color="red">{error}</Alert>}
      {!error && passkeyError && <Alert color="red">{passkeyError}</Alert>}
      {ssoError && <Alert color="red">{t("login.ssoFailed")}</Alert>}
      <TextInput
        label={t("login.username")}
        required
        // "webauthn" lets the browser offer the saved passkeys here (#798).
        autoComplete={passkeys ? "username webauthn" : "username"}
        value={username}
        onChange={(e) => setUsername(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <PasswordInput
        label={t("login.password")}
        required
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      {challenged && (
        <>
          <Text size="sm" c="dimmed">
            {t("login.totpHint")}
          </Text>
          <TextInput
            label={t("login.totpCode")}
            required
            autoFocus
            autoComplete="one-time-code"
            value={totpCode}
            onChange={(e) => setTotpCode(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </>
      )}
      <Button
        onClick={submit}
        loading={login.isPending}
        disabled={!username || !password || (challenged && !totpCode)}
      >
        {challenged ? t("login.verify") : t("login.submit")}
      </Button>
      {(passkeys || sso?.enabled) && !challenged && (
        <>
          <Divider label={t("login.or")} labelPosition="center" />
          {passkeys && (
            <Button
              variant="default"
              leftSection={<IconKey size={16} />}
              loading={passkey.pending}
              onClick={() => void passkey.signIn()}
            >
              {t("login.passkeySignIn")}
            </Button>
          )}
          {sso?.enabled && (
            <Button
              variant="default"
              component="a"
              href={SSO_START}
              leftSection={<IconLogin2 size={16} />}
            >
              {t("login.ssoSignIn", { provider: sso.name })}
            </Button>
          )}
        </>
      )}
    </>
  );
}

// usePasskeySignIn signs in with a passkey (#798): from the button, or from the
// username field, where the browser offers the saved passkeys while the page
// waits on a conditional request. One request at a time: the button stops the
// waiting one, and a new round of waiting starts once it is done.
function usePasskeySignIn(enabled: boolean) {
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [round, setRound] = useState(0);
  const waiting = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || pending) return;
    const ctrl = new AbortController();
    waiting.current = ctrl;
    void (async () => {
      if (!(await conditionalPasskeys()) || ctrl.signal.aborted) return;
      try {
        qc.setQueryData(["me"], await signInWithPasskey("conditional", ctrl.signal));
      } catch (err) {
        if (ctrl.signal.aborted || passkeyCancelled(err)) return;
        setError(err);
        // A passkey CloudBank does not know: offer the others again. Anything
        // else (the server refusing to start) would only fail again.
        if (err instanceof ApiError && err.status === 401) setRound((r) => r + 1);
      }
    })();
    // The server keeps a challenge 10 minutes; take a new one before it goes.
    const renew = setTimeout(() => setRound((r) => r + 1), 9 * 60_000);
    return () => {
      clearTimeout(renew);
      ctrl.abort();
    };
  }, [enabled, pending, round, qc]);

  const signIn = async () => {
    // Stopped here, before the button's request: the browser takes one at a time.
    waiting.current?.abort();
    setError(null);
    setPending(true);
    try {
      qc.setQueryData(["me"], await signInWithPasskey());
    } catch (err) {
      if (!passkeyCancelled(err)) setError(err);
    } finally {
      setPending(false);
    }
  };

  return { signIn, pending, error };
}

// SsoOnlyForm is the sign-in of a server without passwords: the provider's
// button, and under it the way in with a recovery code.
function SsoOnlyForm({ provider, ssoError }: { provider: string; ssoError: string | null }) {
  const { t } = useTranslation();
  const recovery = useRecoveryLogin();
  const [useCode, setUseCode] = useState(false);
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");

  const toCode = () => {
    recovery.reset();
    setUseCode(true);
  };

  const submit = () => {
    if (!username.trim() || !code.trim()) return;
    recovery.mutate(
      { username: username.trim(), code: code.trim() },
      {
        onSuccess: ({ remaining }) =>
          notifications.show({
            color: remaining > 0 ? "teal" : "yellow",
            autoClose: remaining > 0 ? 8000 : false,
            message:
              remaining > 0
                ? t("login.recoveryLeft", { count: remaining })
                : t("login.recoveryNoneLeft"),
          }),
      },
    );
  };

  const recoveryLink = (
    <Anchor component="button" type="button" fz="inherit" onClick={toCode}>
      {t("login.recoveryLink")}
    </Anchor>
  );

  if (!useCode) {
    return (
      <>
        {ssoError && (
          <Alert color="red">
            {ssoError === "unavailable"
              ? t("login.ssoUnavailable", { provider })
              : t("login.ssoFailedOnly", { provider })}{" "}
            {recoveryLink}
          </Alert>
        )}
        <Button component="a" href={SSO_START} leftSection={<IconLogin2 size={16} />}>
          {t("login.ssoSignIn", { provider })}
        </Button>
        {/* The error already offers the code; once is enough. */}
        {!ssoError && (
          <Text fz={13} c="dimmed" ta="center">
            {t("login.recoveryPrompt")} {recoveryLink}
          </Text>
        )}
      </>
    );
  }

  const error =
    recovery.error instanceof ApiError && recovery.error.status === 401 ? (
      t("login.recoveryInvalid")
    ) : recovery.error instanceof ApiError && recovery.error.status === 429 ? (
      t("login.tooMany")
    ) : recovery.error ? (
      <ErrorMessage error={recovery.error} />
    ) : null;

  return (
    <>
      {error && <Alert color="red">{error}</Alert>}
      <Text fz={13} c="dimmed">
        {t("login.recoveryHint")}
      </Text>
      <TextInput
        label={t("login.username")}
        required
        autoFocus
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <TextInput
        label={t("login.recoveryCode")}
        required
        placeholder="XXXX-XXXX-XXXX-XXXX"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <Button onClick={submit} loading={recovery.isPending} disabled={!username || !code}>
        {t("login.recoverySubmit")}
      </Button>
      <Text fz={13} ta="center">
        <Anchor component="button" type="button" fz="inherit" onClick={() => setUseCode(false)}>
          {t("login.backToSso", { provider })}
        </Anchor>
      </Text>
    </>
  );
}
