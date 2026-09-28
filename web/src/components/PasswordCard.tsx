import { Button, Card, Group, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconKey } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, changePassword } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

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

  // Said once the repeat is as long as the new one, not at every keystroke.
  const mismatch = repeat.length >= next.length && repeat.length > 0 && repeat !== next;
  const ready = current.length > 0 && next.length >= MIN_LENGTH && repeat === next;

  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setRepeat("");
      notifications.show({ color: "teal", message: t("password.changed") });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === "invalid_password") {
        setWrongCurrent(true);
        return;
      }
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      });
    },
  });

  const submit = () => {
    if (ready) change.mutate();
  };

  return (
    <Card withBorder>
      <Group gap="xs">
        <IconKey size={18} />
        <Title order={5}>{t("password.title")}</Title>
      </Group>
      <Text size="sm" c="dimmed" maw={560} mt={4}>
        {t("password.hint")}
      </Text>
      {user?.signsInWithSso && (
        <Text size="sm" c="dimmed" maw={560} mt={4}>
          {t("password.sso")}
        </Text>
      )}
      <Stack
        component="form"
        gap="sm"
        mt="md"
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
    </Card>
  );
}
