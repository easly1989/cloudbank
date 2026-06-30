import { ActionIcon, Group, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type TagInfo,
  deleteTag,
  listTagsWithCounts,
  mergeTag,
  renameTag,
} from "../api/client";
import { useWallet } from "../wallet/WalletProvider";

export function TagsPage() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const qc = useQueryClient();

  const tagsQuery = useQuery({
    queryKey: ["tagsManage", walletId],
    queryFn: () => listTagsWithCounts(walletId),
    enabled: walletId > 0,
  });
  const tags = tagsQuery.data ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["tagsManage", walletId] });
    void qc.invalidateQueries({ queryKey: ["tags", walletId] }); // autocomplete list
  };

  if (!currentWallet) return null;

  return (
    <Stack>
      <Title order={2}>{t("tags.title")}</Title>
      {tags.length === 0 ? (
        <Text c="dimmed">{t("tags.empty")}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("tags.name")}</Table.Th>
              <Table.Th ta="right">{t("tags.count")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tags.map((tag) => (
              <TagRow
                key={tag.id}
                walletId={walletId}
                tag={tag}
                allTags={tags}
                onChanged={invalidate}
              />
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function TagRow({
  walletId,
  tag,
  allTags,
  onChanged,
}: {
  walletId: number;
  tag: TagInfo;
  allTags: TagInfo[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(tag.name);
  useEffect(() => setName(tag.name), [tag.name]);

  const onErr = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const rename = useMutation({
    mutationFn: () => renameTag(walletId, tag.id, name.trim()),
    onSuccess: onChanged,
    onError: onErr,
  });
  const merge = useMutation({
    mutationFn: (targetId: number) => mergeTag(walletId, tag.id, targetId),
    onSuccess: onChanged,
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: () => deleteTag(walletId, tag.id),
    onSuccess: onChanged,
    onError: onErr,
  });

  return (
    <Table.Tr>
      <Table.Td>
        <TextInput
          size="xs"
          w={220}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => {
            const next = name.trim();
            if (next && next !== tag.name) rename.mutate();
            else setName(tag.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </Table.Td>
      <Table.Td ta="right">{tag.count}</Table.Td>
      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          <Select
            size="xs"
            w={180}
            placeholder={t("tags.mergeInto")}
            clearable
            searchable
            data={allTags
              .filter((x) => x.id !== tag.id)
              .map((x) => ({ value: String(x.id), label: x.name }))}
            value={null}
            onChange={(v) => {
              if (v) merge.mutate(Number(v));
            }}
          />
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={t("tags.delete")}
            onClick={() => {
              if (window.confirm(t("tags.confirmDelete", { name: tag.name }))) remove.mutate();
            }}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}
