import { ActionIcon, Button, Group, Menu, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconDots,
  IconGripVertical,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  deleteMailPattern,
  listAccounts,
  type MailPattern,
  reorderMailPatterns,
} from "../../api/client";
import { useConfirm } from "../../components/confirmContext";
import { notifyError } from "../../notifyError";

/**
 * A mailbox's patterns, in the order they are tried: the first that reads a
 * mail wins. Drag by the grip, or Move up / down from ⋯ (#657).
 */
export function PatternList({
  walletId,
  mailboxId,
  patterns,
  canCreate,
  onNew,
  onEdit,
}: {
  walletId: number;
  mailboxId: number;
  patterns: MailPattern[];
  /** There is a mail to start a pattern from. */
  canCreate: boolean;
  onNew: () => void;
  onEdit: (p: MailPattern) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const key = ["mailPatterns", walletId, mailboxId];

  const accounts = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
  });
  const accountName = (id: number) => accounts.data?.find((a) => a.id === id)?.name ?? "";

  const reorder = useMutation({
    mutationFn: (ids: number[]) => reorderMailPatterns(walletId, mailboxId, ids),
    onMutate: (ids) => {
      const byId = new Map(patterns.map((p) => [p.id, p]));
      qc.setQueryData(
        key,
        ids.map((id) => byId.get(id)!),
      );
    },
    onSuccess: (list) => qc.setQueryData(key, list),
    onError: (err) => {
      notifyError(err);
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (p: MailPattern) => deleteMailPattern(walletId, mailboxId, p.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: notifyError,
  });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= patterns.length || from === to) return;
    const ids = patterns.map((p) => p.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorder.mutate(ids);
  };
  const drop = (onto: number) => {
    if (dragId == null) return;
    move(
      patterns.findIndex((p) => p.id === dragId),
      patterns.findIndex((p) => p.id === onto),
    );
  };
  const end = () => {
    setDragId(null);
    setOverId(null);
  };
  const askDelete = async (p: MailPattern) => {
    const ok = await confirm({
      title: t("mail.patterns.deleteTitle", { name: p.name || p.sender }),
      body: t("mail.patterns.deleteBody"),
      confirmLabel: t("mail.patterns.delete"),
      danger: true,
    });
    if (ok) remove.mutate(p);
  };

  const newButton = (
    <Button
      size="xs"
      variant="light"
      leftSection={<IconPlus size={14} />}
      onClick={onNew}
      disabled={!canCreate}
    >
      {t("mail.patterns.new")}
    </Button>
  );

  return (
    <Stack gap="xs" data-testid="mail-patterns" data-tour="mail-patterns">
      <Group justify="space-between">
        <Text fw={600}>{t("mail.patterns.title")}</Text>
        {canCreate ? (
          newButton
        ) : (
          <Tooltip label={t("mail.patterns.noMails")} multiline w={260}>
            <span>{newButton}</span>
          </Tooltip>
        )}
      </Group>
      {patterns.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("mail.patterns.empty")}
        </Text>
      ) : (
        <Stack gap={0}>
          {patterns.map((p, i) => (
            <Group
              key={p.id}
              gap="sm"
              wrap="nowrap"
              py={8}
              draggable
              data-testid={`mail-pattern-${p.id}`}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragId(p.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(p.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(p.id);
                end();
              }}
              onDragEnd={end}
              style={{
                borderTop:
                  overId === p.id && dragId !== p.id
                    ? "2px solid var(--mantine-primary-color-filled)"
                    : "1px solid var(--mantine-color-default-border)",
                opacity: dragId === p.id ? 0.5 : 1,
                cursor: "pointer",
              }}
              onClick={() => onEdit(p)}
            >
              <Tooltip label={t("mail.patterns.drag")} withinPortal>
                <IconGripVertical
                  size={16}
                  style={{ opacity: 0.45, flexShrink: 0, cursor: "grab" }}
                  aria-hidden
                />
              </Tooltip>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>
                  {p.name || p.sender}
                </Text>
                <Text size="xs" c="dimmed" truncate data-cb-sensitive>
                  {[p.sender, t(`mail.patterns.${p.direction}`), accountName(p.accountId)]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </div>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={t("mail.patterns.actions", { name: p.name || p.sender })}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconDots size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                  <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => onEdit(p)}>
                    {t("mail.patterns.edit")}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconArrowUp size={16} />}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    {t("mail.patterns.up")}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconArrowDown size={16} />}
                    disabled={i === patterns.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    {t("mail.patterns.down")}
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={16} />}
                    onClick={() => void askDelete(p)}
                  >
                    {t("mail.patterns.delete")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
