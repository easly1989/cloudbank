import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconFilter, IconGripVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../components/confirmContext";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

import {
  ApiError,
  type Assignment,
  type AssignmentInput,
  type MatchField,
  type MatchType,
  type MatchedTransaction,
  applyAssignments,
  createAssignment,
  deleteAssignment,
  listAccounts,
  listAssignments,
  listCategories,
  listPayees,
  reorderAssignments,
  testAssignment,
  updateAssignment,
} from "../api/client";
import { stopRowEdit } from "../rowEdit";
import { PAYMENT_MODES } from "../transactionEnums";
import { useWallet } from "../wallet/WalletProvider";

const FIELDS: MatchField[] = ["memo", "payee", "both"];
const TYPES: MatchType[] = ["exact", "contains", "regex"];

export function AssignmentsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const query = useQuery({
    queryKey: ["assignments", walletId],
    queryFn: () => listAssignments(walletId),
    enabled: walletId > 0,
  });
  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
  });

  // A local ordered copy so drag-reorder feels instant; adopted from the query
  // during render rather than in an effect, so the list never paints one frame
  // of the previous order after a save lands.
  const [order, setOrder] = useState<Assignment[]>(query.data ?? []);
  const [seenRules, setSeenRules] = useState(query.data);
  if (query.data !== seenRules) {
    setSeenRules(query.data);
    setOrder(query.data ?? []);
  }
  const [dragId, setDragId] = useState<number | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["assignments", walletId] });
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const [opened, form] = useDisclosure(false);
  const [editing, setEditing] = useState<Assignment | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => deleteAssignment(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => reorderAssignments(walletId, ids),
    onSuccess: invalidate,
    onError,
  });
  const apply = useMutation({
    mutationFn: (onlyFillEmpty: boolean) => applyAssignments(walletId, { onlyFillEmpty }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["register", walletId] });
      notifications.show({
        color: "green",
        message: t("assignments.applied", { count: res.changed }),
      });
    },
    onError,
  });

  const payeeName = (id?: number | null) => (payeesQuery.data ?? []).find((p) => p.id === id)?.name;
  const categoryName = (id?: number | null) =>
    (categoriesQuery.data ?? []).find((c) => c.id === id)?.name;

  const drop = (targetId: number) => {
    if (dragId == null || dragId === targetId) return;
    const ids = order.map((r) => r.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    setDragId(null);
    reorder.mutate(next.map((r) => r.id));
  };

  if (!currentWallet) return null;

  // The empty state offers the same button; the header drops it while the
  // list is empty rather than showing it twice.
  const addButton = (
    <Button
      onClick={() => {
        setEditing(null);
        form.open();
      }}
    >
      {t("assignments.add")}
    </Button>
  );

  return (
    <Stack>
      <PageHeader
        title={t("assignments.title")}
        hint={t("assignments.help")}
        actions={
          <>
            <Button
              variant="default"
              onClick={async () => {
                const ok = await confirm({
                  title: t("assignments.confirmApplyTitle"),
                  body: t("assignments.confirmApplyBody"),
                  confirmLabel: t("assignments.applyToExisting"),
                });
                if (ok) apply.mutate(true);
              }}
              loading={apply.isPending}
              disabled={order.length === 0}
            >
              {t("assignments.applyToExisting")}
            </Button>
            {order.length > 0 && addButton}
          </>
        }
      />

      {order.length === 0 && (
        <EmptyState
          icon={IconFilter}
          message={t("assignments.empty")}
          hint={t("assignments.emptyHint")}
          action={addButton}
        />
      )}

      {order.length > 0 && (
        <Table.ScrollContainer minWidth={440}>
          {/* Scrolls inside itself on a phone rather than pushing the whole page sideways, as the other tables in the app do. */}
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={32} />
                <Table.Th>{t("assignments.match")}</Table.Th>
                <Table.Th>{t("assignments.sets")}</Table.Th>
                <Table.Th>{t("assignments.applies")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {order.map((r) => (
                <Table.Tr
                  key={r.id}
                  draggable
                  onDragStart={() => setDragId(r.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => drop(r.id)}
                  onDoubleClick={() => {
                    setEditing(r);
                    form.open();
                  }}
                  style={{ cursor: "grab", userSelect: "none", opacity: dragId === r.id ? 0.5 : 1 }}
                >
                  <Table.Td>
                    <IconGripVertical size={16} opacity={0.5} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {t(`assignments.fields.${r.matchField}`)}{" "}
                      {t(`assignments.types.${r.matchType}`)}{" "}
                      <Text span fw={600}>
                        “{r.pattern}”
                      </Text>
                      {r.caseSensitive ? ` (${t("assignments.caseSensitiveShort")})` : ""}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {[
                        payeeName(r.setPayeeId),
                        categoryName(r.setCategoryId),
                        r.setPaymentMode != null
                          ? t(`paymentModes.${r.setPaymentMode}`)
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {[
                        r.applyOnManual ? t("assignments.onManual") : null,
                        r.applyOnImport ? t("assignments.onImport") : null,
                      ]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" {...stopRowEdit}>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        aria-label={t("assignments.edit")}
                        onClick={() => {
                          setEditing(r);
                          form.open();
                        }}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={t("assignments.delete")}
                        onClick={async () => {
                          const ok = await confirm({
                            title: t("assignments.confirmDeleteTitle"),
                            body: t("assignments.confirmDeleteBody"),
                            confirmLabel: t("assignments.delete"),
                            danger: true,
                          });
                          if (ok) remove.mutate(r.id);
                        }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {/* Keyed per record: the key gives every rule — and the new-rule form — its
          own instance, so the fields start where the rule is instead of being
          reset back to it by an effect. It stays mounted while closed, because a
          modal that is unmounted the moment it closes cannot animate out. */}
      <RuleForm
        key={editing?.id ?? "new"}
        opened={opened}
        onClose={form.close}
        walletId={walletId}
        editing={editing}
        payees={payeesQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        onSaved={invalidate}
      />
    </Stack>
  );
}

function RuleForm({
  opened,
  onClose,
  walletId,
  editing,
  payees,
  categories,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Assignment | null;
  payees: { id: number; name: string }[];
  categories: { id: number; name: string; parentId?: number | null }[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  const [matchField, setMatchField] = useState<MatchField>(editing?.matchField ?? "memo");
  const [matchType, setMatchType] = useState<MatchType>(editing?.matchType ?? "contains");
  const [pattern, setPattern] = useState(editing?.pattern ?? "");
  const [caseSensitive, setCaseSensitive] = useState(editing?.caseSensitive ?? false);
  const [matchAccountId, setMatchAccountId] = useState<string | null>(
    editing?.matchAccountId ? String(editing.matchAccountId) : null,
  );
  const [setPayeeId, setSetPayeeId] = useState<string | null>(
    editing?.setPayeeId ? String(editing.setPayeeId) : null,
  );
  const [setCategoryId, setSetCategoryId] = useState<string | null>(
    editing?.setCategoryId ? String(editing.setCategoryId) : null,
  );
  const [setPaymentMode, setSetPaymentMode] = useState<string | null>(
    editing?.setPaymentMode != null ? String(editing.setPaymentMode) : null,
  );
  const [setInfo, setSetInfo] = useState(editing?.setInfo ?? "");
  const [applyOnManual, setApplyOnManual] = useState(editing?.applyOnManual ?? true);
  const [applyOnImport, setApplyOnImport] = useState(editing?.applyOnImport ?? true);
  const [testResult, setTestResult] = useState<MatchedTransaction[] | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = accountsQuery.data ?? [];

  const body = (): AssignmentInput => ({
    matchField,
    matchType,
    pattern,
    caseSensitive,
    matchAccountId: matchAccountId ? Number(matchAccountId) : null,
    setPayeeId: setPayeeId ? Number(setPayeeId) : null,
    setCategoryId: setCategoryId ? Number(setCategoryId) : null,
    setPaymentMode: setPaymentMode != null ? Number(setPaymentMode) : null,
    setInfo: setInfo.trim() ? setInfo.trim() : null,
    applyOnManual,
    applyOnImport,
  });

  const save = useMutation({
    mutationFn: () =>
      editing ? updateAssignment(walletId, editing.id, body()) : createAssignment(walletId, body()),
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

  const test = useMutation({
    mutationFn: () => testAssignment(walletId, body()),
    onSuccess: (rows) => setTestResult(rows),
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({
        value: String(c.id),
        label: c.parentId
          ? `   ${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}`
          : c.name,
      })),
    [categories],
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t("assignments.editTitle") : t("assignments.addTitle")}
    >
      <Stack>
        <Group grow>
          <Select
            label={t("assignments.matchField")}
            data={FIELDS.map((f) => ({ value: f, label: t(`assignments.fields.${f}`) }))}
            value={matchField}
            onChange={(v) => v && setMatchField(v as MatchField)}
            allowDeselect={false}
          />
          <Select
            label={t("assignments.matchType")}
            data={TYPES.map((ty) => ({ value: ty, label: t(`assignments.types.${ty}`) }))}
            value={matchType}
            onChange={(v) => v && setMatchType(v as MatchType)}
            allowDeselect={false}
          />
        </Group>
        <TextInput
          label={t("assignments.pattern")}
          value={pattern}
          onChange={(e) => setPattern(e.currentTarget.value)}
        />
        <Switch
          label={t("assignments.caseSensitive")}
          checked={caseSensitive}
          onChange={(e) => setCaseSensitive(e.currentTarget.checked)}
        />
        <Select
          label={t("assignments.matchAccount")}
          placeholder={t("assignments.anyAccount")}
          data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
          value={matchAccountId}
          onChange={setMatchAccountId}
          clearable
          searchable
        />
        <Select
          label={t("assignments.setPayee")}
          data={payees.map((p) => ({ value: String(p.id), label: p.name }))}
          value={setPayeeId}
          onChange={setSetPayeeId}
          clearable
          searchable
        />
        <Select
          label={t("assignments.setCategory")}
          data={categoryOptions}
          value={setCategoryId}
          onChange={setSetCategoryId}
          clearable
          searchable
        />
        <Select
          label={t("assignments.setPaymentMode")}
          data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
          value={setPaymentMode}
          onChange={setSetPaymentMode}
          clearable
        />
        <TextInput
          label={t("assignments.setInfo")}
          placeholder={t("assignments.setInfoPlaceholder")}
          value={setInfo}
          onChange={(e) => setSetInfo(e.currentTarget.value)}
        />
        <Group>
          <Checkbox
            label={t("assignments.onManual")}
            checked={applyOnManual}
            onChange={(e) => setApplyOnManual(e.currentTarget.checked)}
          />
          <Checkbox
            label={t("assignments.onImport")}
            checked={applyOnImport}
            onChange={(e) => setApplyOnImport(e.currentTarget.checked)}
          />
        </Group>

        {testResult && (
          <Alert color={testResult.length > 0 ? "blue" : "gray"}>
            {t("assignments.testResult", { count: testResult.length })}
            {testResult.length > 0 && (
              <Text size="xs" mt={4} lineClamp={3}>
                {testResult
                  .slice(0, 5)
                  .map((m) => m.memo || m.payeeName || m.date)
                  .join(", ")}
              </Text>
            )}
          </Alert>
        )}

        <Group justify="space-between">
          <Button
            variant="subtle"
            onClick={() => test.mutate()}
            loading={test.isPending}
            disabled={!pattern.trim()}
          >
            {t("assignments.test")}
          </Button>
          <Group>
            <Button variant="default" onClick={onClose}>
              {t("assignments.cancel")}
            </Button>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!pattern.trim()}
            >
              {t("assignments.save")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
