import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconKey,
  IconLogin2,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  ApiError,
  MAX_PASSKEYS,
  deletePasskey,
  listPasskeys,
  renamePasskey,
  type Passkey,
} from "../api/client";
import { AFTER_LOGIN } from "../afterLogin";
import { useLogout } from "../auth/AuthProvider";
import { useDateFormat } from "../dates";
import { notifyError } from "../notifyError";
import { addPasskey, deviceParts, passkeyCancelled, passkeysSupported } from "../passkey";
import { useConfirm } from "./confirmContext";
import { SettingRow, SettingState } from "../pages/settings/SettingRow";

// PasskeysCard is the user's passkeys (#798): the row in Settings › Account,
// and the modal that lists, adds, renames and removes them.
export function PasskeysCard() {
  const { t } = useTranslation();
  const supported = passkeysSupported();
  const list = useQuery({ queryKey: ["passkeys"], queryFn: listPasskeys });
  const count = list.data?.length ?? 0;
  // Back from signing in again to add one: the modal opens where it was.
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("passkeys") === "add");
  const close = () => {
    setOpen(false);
    if (params.has("passkeys")) {
      params.delete("passkeys");
      setParams(params, { replace: true });
    }
  };

  return (
    <>
      <SettingRow
        id="passkeys"
        testId="passkeys"
        description={supported ? undefined : t("passkeys.unsupported")}
        control={
          <>
            {list.isSuccess && (
              <SettingState tone={count > 0 ? "ok" : "off"}>
                {count > 0 ? t("passkeys.count", { count }) : t("passkeys.none")}
              </SettingState>
            )}
            {count > 0 ? (
              <Button variant="default" onClick={() => setOpen(true)}>
                {t("passkeys.manage")}
              </Button>
            ) : (
              <Button
                variant="default"
                disabled={!supported || !list.isSuccess}
                onClick={() => setOpen(true)}
              >
                {t("passkeys.add")}
              </Button>
            )}
          </>
        }
      />
      <PasskeysModal opened={open} onClose={close} passkeys={list.data ?? []} />
    </>
  );
}

// localDay is the day an RFC3339 instant falls on here, as YYYY-MM-DD.
const localDay = (iso: string) => new Date(iso).toLocaleDateString("sv");

function PasskeysModal({
  opened,
  onClose,
  passkeys,
}: {
  opened: boolean;
  onClose: () => void;
  passkeys: Passkey[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const logout = useLogout();
  const date = useDateFormat();
  const [added, setAdded] = useState<Passkey | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [stale, setStale] = useState(false);
  const supported = passkeysSupported();
  const full = passkeys.length >= MAX_PASSKEYS;
  const refresh = () => qc.invalidateQueries({ queryKey: ["passkeys"] });

  const suggested = () => {
    const { browser, os } = deviceParts();
    return browser && os ? t("passkeys.suggestedName", { browser, os }) : browser || os;
  };

  const add = useMutation({
    mutationFn: () => addPasskey(suggested()),
    onSuccess: (p) => {
      setAdded(p);
      setName(p.name);
      void refresh();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === "reauth_required") setStale(true);
      else if (err instanceof DOMException && err.name === "InvalidStateError")
        notifyError(new Error(t("passkeys.already")));
      else if (!passkeyCancelled(err)) notifyError(err);
    },
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renamePasskey(id, name),
    onSuccess: () => {
      setAdded(null);
      setEditing(null);
      void refresh();
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: deletePasskey,
    onSuccess: () => void refresh(),
    onError: notifyError,
  });

  // saveName renames once: not while a rename is on its way, and an empty or
  // unchanged name just closes the field.
  const saveName = (id: number, next: string, was?: string) => {
    if (rename.isPending) return;
    if (!next.trim() || next.trim() === was) {
      setEditing(null);
      return;
    }
    rename.mutate({ id, name: next });
  };

  const askRemove = async (p: Passkey) => {
    const ok = await confirm({
      title: t("passkeys.removeTitle", { name: p.name }),
      body: t("passkeys.removeBody"),
      confirmLabel: t("passkeys.remove"),
      danger: true,
    });
    if (ok) remove.mutate(p.id);
  };

  // Signing in again keeps the way back: the app returns here after it.
  const signInAgain = () => {
    sessionStorage.setItem(
      AFTER_LOGIN,
      JSON.stringify({ path: "/settings/account?passkeys=add", at: Date.now() }),
    );
    logout.mutate();
  };

  const close = () => {
    setAdded(null);
    setEditing(null);
    setStale(false);
    onClose();
  };

  const meta = (p: Passkey) => {
    const today = localDay(new Date().toISOString());
    const addedOn = date(localDay(p.createdAt));
    if (!p.lastUsedAt) return t("passkeys.metaUnused", { added: addedOn });
    const used = localDay(p.lastUsedAt);
    if (used === today) return t("passkeys.metaToday", { added: addedOn });
    return t("passkeys.meta", { added: addedOn, used: date(used) });
  };

  return (
    <Modal opened={opened} onClose={close} title={t("passkeys.title")}>
      <Stack>
        {added ? (
          <>
            <Alert color="teal" icon={<IconCheck size={16} />}>
              {t("passkeys.added")}
            </Alert>
            <TextInput
              label={t("passkeys.name")}
              description={t("passkeys.nameHint")}
              inputWrapperOrder={["label", "input", "description"]}
              value={name}
              maxLength={60}
              data-autofocus
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName(added.id, name)}
            />
            <Group justify="flex-end">
              <Button
                loading={rename.isPending}
                disabled={!name.trim()}
                onClick={() => saveName(added.id, name)}
              >
                {t("passkeys.saveName")}
              </Button>
            </Group>
          </>
        ) : (
          <Text size="sm" c="dimmed">
            {t("passkeys.intro")}
          </Text>
        )}

        {passkeys.length > 0 && (
          <Card withBorder p={0}>
            {passkeys.map((p, i) => (
              <Group
                key={p.id}
                wrap="nowrap"
                gap="sm"
                px="sm"
                py="sm"
                style={
                  i > 0 ? { borderTop: "1px solid var(--mantine-color-default-border)" } : undefined
                }
              >
                <IconKey size={18} color="var(--mantine-color-dimmed)" aria-hidden />
                {editing === p.id ? (
                  <TextInput
                    flex={1}
                    size="xs"
                    aria-label={t("passkeys.name")}
                    value={editName}
                    maxLength={60}
                    autoFocus
                    onChange={(e) => setEditName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName(p.id, editName, p.name);
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    onBlur={() => saveName(p.id, editName, p.name)}
                  />
                ) : (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {p.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {meta(p)}
                    </Text>
                  </div>
                )}
                <Group gap={2} wrap="nowrap">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={t("passkeys.renameOne", { name: p.name })}
                    onClick={() => {
                      setEditing(p.id);
                      setEditName(p.name);
                    }}
                  >
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={t("passkeys.removeOne", { name: p.name })}
                    onClick={() => void askRemove(p)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>
            ))}
          </Card>
        )}

        {stale ? (
          <>
            <Alert
              color="yellow"
              icon={<IconAlertTriangle size={16} />}
              title={t("passkeys.reauthTitle")}
            >
              {t("passkeys.reauthBody")}
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setStale(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                leftSection={<IconLogin2 size={16} />}
                loading={logout.isPending}
                onClick={signInAgain}
              >
                {t("passkeys.reauth")}
              </Button>
            </Group>
          </>
        ) : (
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {full
                ? t("passkeys.full", { max: MAX_PASSKEYS })
                : t("passkeys.of", { n: passkeys.length, max: MAX_PASSKEYS })}
            </Text>
            <Button
              leftSection={<IconPlus size={16} />}
              disabled={full || !supported}
              loading={add.isPending}
              onClick={() => add.mutate()}
            >
              {t("passkeys.addOne")}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
