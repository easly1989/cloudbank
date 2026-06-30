import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Menu,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconDots, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Category,
  createCategory,
  deleteCategory,
  listCategories,
  mergeCategory,
  updateCategory,
} from "../api/client";
import { rowEditProps, stopRowEdit } from "../rowEdit";
import { useWallet } from "../wallet/WalletProvider";

export function CategoriesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const query = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled: walletId > 0,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["categories", walletId] });
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const [formOpened, form] = useDisclosure(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [presetParent, setPresetParent] = useState<Category | null>(null);
  const [mergeFrom, setMergeFrom] = useState<Category | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const categories = query.data ?? [];
  const tops = categories.filter((c) => !c.parentId);
  const childrenOf = (id: number) => categories.filter((c) => c.parentId === id);

  const remove = useMutation({
    mutationFn: ({ id, reassignTo }: { id: number; reassignTo?: number }) =>
      deleteCategory(walletId, id, reassignTo),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
    onError,
  });

  const openAdd = (parent: Category | null) => {
    setEditing(null);
    setPresetParent(parent);
    form.open();
  };
  const openEdit = (c: Category) => {
    setEditing(c);
    setPresetParent(null);
    form.open();
  };

  if (!currentWallet) return null;

  const renderActions = (c: Category) => (
    <span {...stopRowEdit}>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" aria-label={t("categories.actions")}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => openEdit(c)}>{t("categories.edit")}</Menu.Item>
          {!c.parentId && (
            <Menu.Item onClick={() => openAdd(c)}>{t("categories.addSub")}</Menu.Item>
          )}
          <Menu.Item onClick={() => setMergeFrom(c)}>{t("categories.merge")}</Menu.Item>
          <Menu.Item color="red" onClick={() => setDeleteTarget(c)}>
            {t("categories.delete")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </span>
  );

  return (
    <Stack maw={720}>
      <Group justify="space-between">
        <Title order={2}>{t("categories.title")}</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => openAdd(null)}>
          {t("categories.add")}
        </Button>
      </Group>

      {tops.length === 0 && <Text c="dimmed">{t("categories.empty")}</Text>}

      {tops.map((top) => (
        <Card withBorder key={top.id} p="sm">
          <Group justify="space-between" {...rowEditProps(() => openEdit(top))}>
            <Group gap="xs">
              <Text fw={600}>{top.name}</Text>
              <Badge color={top.isIncome ? "teal" : "gray"} size="sm">
                {top.isIncome ? t("categories.income") : t("categories.expense")}
              </Badge>
            </Group>
            {renderActions(top)}
          </Group>
          {childrenOf(top.id).map((child) => (
            <Group
              key={child.id}
              justify="space-between"
              pl="lg"
              mt={4}
              {...rowEditProps(() => openEdit(child))}
            >
              <Text size="sm">{child.name}</Text>
              {renderActions(child)}
            </Group>
          ))}
        </Card>
      ))}

      <CategoryFormModal
        opened={formOpened}
        onClose={form.close}
        walletId={walletId}
        editing={editing}
        presetParent={presetParent}
        topLevel={tops}
        onSaved={invalidate}
      />
      <MergeModal
        title={t("categories.mergeTitle")}
        source={mergeFrom}
        options={categories
          .filter((c) => c.id !== mergeFrom?.id)
          .map((c) => ({ value: String(c.id), label: c.name }))}
        onClose={() => setMergeFrom(null)}
        onMerge={(targetId) =>
          mergeCategory(walletId, mergeFrom!.id, targetId)
            .then(() => {
              setMergeFrom(null);
              invalidate();
            })
            .catch(onError)
        }
      />
      <DeleteCategoryModal
        category={deleteTarget}
        hasChildren={deleteTarget ? childrenOf(deleteTarget.id).length > 0 : false}
        topLevelTargets={tops
          .filter((c) => c.id !== deleteTarget?.id)
          .map((c) => ({ value: String(c.id), label: c.name }))}
        onClose={() => setDeleteTarget(null)}
        onDelete={(reassignTo) => remove.mutate({ id: deleteTarget!.id, reassignTo })}
        pending={remove.isPending}
      />
    </Stack>
  );
}

function CategoryFormModal({
  opened,
  onClose,
  walletId,
  editing,
  presetParent,
  topLevel,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Category | null;
  presetParent: Category | null;
  topLevel: Category[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [isIncome, setIsIncome] = useState(false);
  const [noBudget, setNoBudget] = useState(false);
  const [noReport, setNoReport] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setName(editing?.name ?? "");
    setIsIncome(editing?.isIncome ?? presetParent?.isIncome ?? false);
    setNoBudget(editing?.noBudget ?? false);
    setNoReport(editing?.noReport ?? false);
    setParentId(
      editing
        ? editing.parentId
          ? String(editing.parentId)
          : null
        : presetParent
          ? String(presetParent.id)
          : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing?.id, presetParent?.id]);

  const isSub = parentId != null;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        isIncome,
        noBudget,
        noReport,
        parentId: parentId ? Number(parentId) : null,
      };
      return editing ? updateCategory(walletId, editing.id, body) : createCategory(walletId, body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t("categories.editTitle") : t("categories.addTitle")}
    >
      <Stack>
        <TextInput
          label={t("categories.name")}
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        {!editing && (
          <Select
            label={t("categories.parent")}
            placeholder={t("categories.topLevel")}
            clearable
            data={topLevel.map((c) => ({ value: String(c.id), label: c.name }))}
            value={parentId}
            onChange={setParentId}
          />
        )}
        {!isSub && (
          <Checkbox
            label={t("categories.isIncome")}
            checked={isIncome}
            onChange={(e) => setIsIncome(e.currentTarget.checked)}
          />
        )}
        <Checkbox
          label={t("categories.excludeBudget")}
          checked={noBudget}
          onChange={(e) => setNoBudget(e.currentTarget.checked)}
        />
        <Checkbox
          label={t("categories.excludeReport")}
          checked={noReport}
          onChange={(e) => setNoReport(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("categories.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name}>
            {t("categories.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function MergeModal({
  title,
  source,
  options,
  onClose,
  onMerge,
}: {
  title: string;
  source: { id: number; name: string } | null;
  options: { value: string; label: string }[];
  onClose: () => void;
  onMerge: (targetId: number) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => setTarget(null), [source?.id]);

  return (
    <Modal opened={source !== null} onClose={onClose} title={title}>
      <Stack>
        <Text size="sm">{t("categories.mergeHint", { name: source?.name ?? "" })}</Text>
        <Select data={options} value={target} onChange={setTarget} searchable />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("categories.cancel")}
          </Button>
          <Button
            color="orange"
            disabled={!target}
            onClick={() => target && onMerge(Number(target))}
          >
            {t("categories.merge")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function DeleteCategoryModal({
  category,
  hasChildren,
  topLevelTargets,
  onClose,
  onDelete,
  pending,
}: {
  category: Category | null;
  hasChildren: boolean;
  topLevelTargets: { value: string; label: string }[];
  onClose: () => void;
  onDelete: (reassignTo?: number) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [reassignTo, setReassignTo] = useState<string | null>(null);
  useEffect(() => setReassignTo(null), [category?.id]);

  return (
    <Modal opened={category !== null} onClose={onClose} title={t("categories.deleteTitle")}>
      <Stack>
        <Text size="sm">{t("categories.deleteHint", { name: category?.name ?? "" })}</Text>
        {hasChildren && (
          <Select
            label={t("categories.reassignTo")}
            description={t("categories.reassignHint")}
            data={topLevelTargets}
            value={reassignTo}
            onChange={setReassignTo}
            searchable
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("categories.cancel")}
          </Button>
          <Button
            color="red"
            loading={pending}
            disabled={hasChildren && !reassignTo}
            onClick={() => onDelete(reassignTo ? Number(reassignTo) : undefined)}
          >
            {t("categories.delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
