import { Button, Group, PasswordInput, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, changePassword } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { notifyError } from "../notifyError";
import { SettingRow } from "../pages/settings/SettingRow";

const MIN_LENGTH = 8;

// PasswordCard lets the signed-in user change their own password (#530), which
// until now only an administrator could reset. It asks for the current one, and
// the server signs out every other session: whoever else knew the old password
// is out at once, while this device stays in.
export function PasswordCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [wrongCurrent, setWrongCurrent] = useState(false);
  const [open, setOpen] = useState(false);

  // Said once the repeat is as long as the new one, not at every keystroke.
  const mismatch = repeat.length >= next.length && repeat.length > 0 && repeat !== next;
  const ready = current.length > 0 && next.length >= MIN_LENGTH && repeat === next;

  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setRepeat("");
      setOpen(false);
      notifications.show({ color: "teal", message: t("password.changed") });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === "invalid_password") {
        setWrongCurrent(true);
        return;
      }
      notifyError(err);
    },
  });

  const submit = () => {
    if (ready) change.mutate();
  };

  return (
    <SettingRow
      id="password"
      open={open}
      onOpenChange={setOpen}
      control={
        <Button variant="default" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {t("password.change")}
        </Button>
      }
    >
      {user?.signsInWithSso && (
        <Text size="sm" c="dimmed" maw={560}>
          {t("password.sso")}
        </Text>
      )}
      <Stack
        component="form"
        gap="sm"
        maw={360}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <PasswordInput
          label={t("password.current")}
          autoComplete="current-password"
          value={current}
          error={wrongCurrent ? t("password.wrongCurrent") : undefined}
          onChange={(e) => {
            setCurrent(e.currentTarget.value);
            setWrongCurrent(false);
          }}
        />
        <PasswordInput
          label={t("password.new")}
          description={t("password.newHint", { n: MIN_LENGTH })}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.currentTarget.value)}
        />
        <PasswordInput
          label={t("password.repeat")}
          autoComplete="new-password"
          value={repeat}
          error={mismatch ? t("password.mismatch") : undefined}
          onChange={(e) => setRepeat(e.currentTarget.value)}
        />
        <Group>
          <Button type="submit" disabled={!ready} loading={change.isPending}>
            {t("password.submit")}
          </Button>
        </Group>
      </Stack>
    </SettingRow>
  );
}
