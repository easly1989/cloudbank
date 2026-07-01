import { ActionIcon, Anchor, Button, Group, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPaperclip, IconTrash, IconUpload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  attachmentUrl,
  deleteAttachment,
  listAttachments,
  uploadAttachment,
} from "../api/client";

// formatBytes renders a compact human-readable file size (e.g. "12.3 KB").
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// AttachmentsField lists a transaction's files and lets the user add/remove
// them. It is shown only for saved transactions (uploads need a transaction id).
export function AttachmentsField({
  walletId,
  transactionId,
}: {
  walletId: number;
  transactionId: number;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey: ["attachments", walletId, transactionId],
    queryFn: () => listAttachments(walletId, transactionId),
  });
  const items = query.data ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["attachments", walletId, transactionId] });
    // Refresh the register so the paperclip count updates.
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        await uploadAttachment(walletId, transactionId, file);
      }
    },
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteAttachment(walletId, id),
    onSuccess: invalidate,
    onError,
  });

  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          {t("attachments.title")}
        </Text>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconUpload size={14} />}
          loading={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {t("attachments.add")}
        </Button>
      </Group>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files && files.length) upload.mutate(Array.from(files));
          e.currentTarget.value = "";
        }}
      />
      {items.length === 0 ? (
        <Text size="xs" c="dimmed">
          {t("attachments.empty")}
        </Text>
      ) : (
        items.map((a) => (
          <Group key={a.id} justify="space-between" wrap="nowrap">
            <Anchor
              href={attachmentUrl(walletId, a.id)}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              style={{ overflow: "hidden" }}
            >
              <Group gap={4} wrap="nowrap">
                <IconPaperclip size={13} />
                <Text size="sm" truncate>
                  {a.filename}
                </Text>
              </Group>
            </Anchor>
            <Group gap={8} wrap="nowrap">
              <Text size="xs" c="dimmed">
                {formatBytes(a.size)}
              </Text>
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                aria-label={t("attachments.delete")}
                onClick={() => remove.mutate(a.id)}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          </Group>
        ))
      )}
    </Stack>
  );
}
