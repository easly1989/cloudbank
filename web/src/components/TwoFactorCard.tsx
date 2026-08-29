import {
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  Group,
  Image,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconCopy, IconShieldLock } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, type TotpSetup, disable2fa, enable2fa, getMe, setup2fa } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

// TwoFactorCard shows the account's 2FA status and drives enable (QR + confirm →
// recovery codes) and disable (password re-auth).
export function TwoFactorCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const enabled = user?.twoFactorEnabled ?? false;

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const refreshMe = async () => qc.setQueryData(["me"], await getMe());
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  return (
    <Card withBorder>
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs">
            <IconShieldLock size={18} />
            <Title order={5}>{t("twofa.title")}</Title>
            {enabled ? (
              <Badge color="teal" variant="light">
                {t("twofa.on")}
              </Badge>
            ) : (
              <Badge color="gray" variant="light">
                {t("twofa.off")}
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed" maw={560} mt={4}>
            {t("twofa.hint")}
          </Text>
        </div>
        {enabled ? (
          <Button variant="light" color="red" onClick={() => setDisableOpen(true)}>
            {t("twofa.disable")}
          </Button>
        ) : (
          <Button onClick={() => setEnrollOpen(true)}>{t("twofa.enable")}</Button>
        )}
      </Group>

      <EnrollModal
        opened={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        onDone={() => void refreshMe()}
      />
      <DisableModal
        opened={disableOpen}
        onClose={() => setDisableOpen(false)}
        onDone={() => void refreshMe()}
        onError={onError}
      />
    </Card>
  );
}

function EnrollModal({
  opened,
  onClose,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [qr, setQr] = useState<string>("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Fetch a fresh secret each time the modal opens; render its QR.
  useEffect(() => {
    if (!opened) return;
    setSetup(null);
    setQr("");
    setCode("");
    setRecoveryCodes(null);
    let cancelled = false;
    void setup2fa()
      .then(async (s) => {
        if (cancelled) return;
        setSetup(s);
        setQr(await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 200 }));
      })
      .catch(() => {
        if (!cancelled) notifications.show({ color: "red", message: t("twofa.setupError") });
      });
    return () => {
      cancelled = true;
    };
  }, [opened, t]);

  const enable = useMutation({
    mutationFn: () => enable2fa(setup!.secret, code.trim()),
    onSuccess: (res) => setRecoveryCodes(res.recoveryCodes),
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const finish = () => {
    onDone();
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={recoveryCodes ? finish : onClose}
      title={t("twofa.enableTitle")}
    >
      {recoveryCodes ? (
        <Stack>
          <Alert color="teal" icon={<IconShieldLock size={18} />} title={t("twofa.recoveryTitle")}>
            {t("twofa.recoveryWarning")}
          </Alert>
          <Card withBorder bg="var(--mantine-color-default)">
            <Stack gap={4}>
              {recoveryCodes.map((c) => (
                <Text key={c} ff="monospace" size="sm" ta="center">
                  {c}
                </Text>
              ))}
            </Stack>
          </Card>
          <Group justify="space-between">
            <CopyButton value={recoveryCodes.join("\n")}>
              {({ copied, copy }) => (
                <Button
                  variant="light"
                  leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  onClick={copy}
                >
                  {copied ? t("twofa.copied") : t("twofa.copyCodes")}
                </Button>
              )}
            </CopyButton>
            <Button onClick={finish}>{t("twofa.done")}</Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Text size="sm" c="dimmed">
            {t("twofa.scanHint")}
          </Text>
          <Group justify="center">
            {qr ? <Image src={qr} alt="QR" w={200} h={200} /> : <Text c="dimmed">…</Text>}
          </Group>
          {setup && (
            <TextInput
              readOnly
              label={t("twofa.secretLabel")}
              value={setup.secret}
              styles={{ input: { fontFamily: "monospace" } }}
            />
          )}
          <TextInput
            label={t("twofa.codeLabel")}
            placeholder="123456"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("twofa.cancel")}
            </Button>
            <Button
              disabled={!setup || code.trim().length < 6}
              loading={enable.isPending}
              onClick={() => enable.mutate()}
            >
              {t("twofa.verifyEnable")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function DisableModal({
  opened,
  onClose,
  onDone,
  onError,
}: {
  opened: boolean;
  onClose: () => void;
  onDone: () => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");

  const disable = useMutation({
    mutationFn: () => disable2fa(password),
    onSuccess: () => {
      setPassword("");
      onDone();
      onClose();
      notifications.show({ color: "teal", message: t("twofa.disabled") });
    },
    onError,
  });

  return (
    <Modal opened={opened} onClose={onClose} title={t("twofa.disableTitle")}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t("twofa.disableHint")}
        </Text>
        <PasswordInput
          label={t("login.password")}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && password && disable.mutate()}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("twofa.cancel")}
          </Button>
          <Button
            color="red"
            disabled={!password}
            loading={disable.isPending}
            onClick={() => disable.mutate()}
          >
            {t("twofa.disable")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
