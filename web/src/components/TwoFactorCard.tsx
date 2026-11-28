import {
  Alert,
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
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconCopy, IconShieldLock } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { type TotpSetup, disable2fa, enable2fa, getMe, setup2fa } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { errorColor } from "../amountTone";
import { notifyError } from "../notifyError";
import { SettingRow, SettingState } from "../pages/settings/SettingRow";

// TwoFactorCard is the account's 2FA row in Settings › Account (#800): its
// status, and the dialogs that enable it (QR + confirm → recovery codes) and
// disable it (password re-auth).
export function TwoFactorCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const enabled = user?.twoFactorEnabled ?? false;

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const refreshMe = async () => qc.setQueryData(["me"], await getMe());
  const onError = (err: unknown) => notifyError(err);

  return (
    <>
      <SettingRow
        id="two-factor"
        control={
          <>
            <SettingState tone={enabled ? "ok" : "off"}>
              {enabled ? t("twofa.on") : t("twofa.off")}
            </SettingState>
            {enabled ? (
              <Button variant="default" c={errorColor} onClick={() => setDisableOpen(true)}>
                {t("twofa.disable")}
              </Button>
            ) : (
              <Button variant="default" onClick={() => setEnrollOpen(true)}>
                {t("twofa.enable")}
              </Button>
            )}
          </>
        }
      />
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
    </>
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

  // Clear the previous enrolment when the modal opens, during render: the fetch
  // below is a real side effect and belongs in an effect, but blanking the
  // fields is not, and doing it there shows the old QR for a frame.
  const [seededFor, setSeededFor] = useState(opened);
  if (opened !== seededFor) {
    setSeededFor(opened);
    if (opened) {
      setSetup(null);
      setQr("");
      setCode("");
      setRecoveryCodes(null);
    }
  }

  // Fetch a fresh secret each time the modal opens; render its QR.
  useEffect(() => {
    if (!opened) return;
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
    onError: (err: unknown) => notifyError(err),
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
