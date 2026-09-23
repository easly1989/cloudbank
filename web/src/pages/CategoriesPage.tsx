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
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCategory, IconDots, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

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

  // One button, shown in the header or in the empty state — never both.
  const addButton = (
    <Button leftSection={<IconPlus size={16} />} onClick={() => openAdd(null)}>
      {t("categories.add")}
    </Button>
  );

  return (
    <Stack maw={720}>
      <PageHeader
        title={t("categories.title")}
        hint={t("categories.hint")}
        actions={tops.length > 0 ? addButton : undefined}
      />

      {tops.length === 0 && (
        <EmptyState
          icon={IconCategory}
          message={t("categories.empty")}
          hint={t("categories.emptyHint")}
          action={addButton}
        />
      )}

      {tops.map((top) => (
        <Card withBorder key={top.id} p="sm">
          <Group justify="space-between" {...rowEditProps(() => openEdit(top))}>
            <Group gap="xs">
              <Text fw={600}>{top.name}</Text>
              <Badge color={top.isIncome ? "teal" : "gray"} variant="dot" size="sm">
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

      {/* Keyed so each opening mounts a fresh form. */}
      <CategoryFormModal
        key={`${editing?.id ?? "new"}-${presetParent?.id ?? ""}`}
        opened={formOpened}
        onClose={form.close}
        walletId={walletId}
        editing={editing}
        presetParent={presetParent}
        topLevel={tops}
        onSaved={invalidate}
      />
      <MergeModal
        key={`merge-${mergeFrom?.id ?? "none"}`}
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
        key={`delete-${deleteTarget?.id ?? "none"}`}
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
  // The form starts where the category is; the modal is mounted per opening.
  const [name, setName] = useState(editing?.name ?? "");
  const [isIncome, setIsIncome] = useState(editing?.isIncome ?? presetParent?.isIncome ?? false);
  const [noBudget, setNoBudget] = useState(editing?.noBudget ?? false);
  const [noReport, setNoReport] = useState(editing?.noReport ?? false);
  const [parentId, setParentId] = useState<string | null>(
    editing
      ? editing.parentId
        ? String(editing.parentId)
        : null
      : presetParent
        ? String(presetParent.id)
        : null,
  );

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
  // Mounted per source (see the key at the call site), so the choice starts
  // empty for each merge without an effect to clear it.
  const [target, setTarget] = useState<string | null>(null);

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
  // Mounted per category (see the key at the call site).
  const [reassignTo, setReassignTo] = useState<string | null>(null);

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
