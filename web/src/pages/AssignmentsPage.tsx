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
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconGripVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
  listAssignments,
  listCategories,
  listPayees,
  reorderAssignments,
  testAssignment,
  updateAssignment,
} from "../api/client";
import { stopRowEdit } from "../rowEdit";
import { useWallet } from "../wallet/WalletProvider";

const FIELDS: MatchField[] = ["memo", "payee", "both"];
const TYPES: MatchType[] = ["exact", "contains", "regex"];
const PAYMENT_MODES = Array.from({ length: 12 }, (_, i) => i);

export function AssignmentsPage() {
  const { t } = useTranslation();
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

  // A local ordered copy so drag-reorder feels instant; synced from the query.
  const [order, setOrder] = useState<Assignment[]>([]);
  useEffect(() => setOrder(query.data ?? []), [query.data]);
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

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("assignments.title")}</Title>
        <Group>
          <Button
            variant="default"
            onClick={() => {
              if (window.confirm(t("assignments.confirmApply"))) apply.mutate(true);
            }}
            loading={apply.isPending}
            disabled={order.length === 0}
          >
            {t("assignments.applyToExisting")}
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              form.open();
            }}
          >
            {t("assignments.add")}
          </Button>
        </Group>
      </Group>

      <Text size="sm" c="dimmed">
        {t("assignments.help")}
      </Text>

      {order.length === 0 && <Text c="dimmed">{t("assignments.empty")}</Text>}

      {order.length > 0 && (
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
                      r.setPaymentMode != null ? t(`paymentModes.${r.setPaymentMode}`) : undefined,
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
                      onClick={() => {
                        if (window.confirm(t("assignments.confirmDelete"))) remove.mutate(r.id);
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
      )}

      <RuleForm
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

  const [matchField, setMatchField] = useState<MatchField>("memo");
  const [matchType, setMatchType] = useState<MatchType>("contains");
  const [pattern, setPattern] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [setPayeeId, setSetPayeeId] = useState<string | null>(null);
  const [setCategoryId, setSetCategoryId] = useState<string | null>(null);
  const [setPaymentMode, setSetPaymentMode] = useState<string | null>(null);
  const [applyOnManual, setApplyOnManual] = useState(true);
  const [applyOnImport, setApplyOnImport] = useState(true);
  const [testResult, setTestResult] = useState<MatchedTransaction[] | null>(null);

  useEffect(() => {
    if (!opened) return;
    const e = editing;
    setMatchField(e?.matchField ?? "memo");
    setMatchType(e?.matchType ?? "contains");
    setPattern(e?.pattern ?? "");
    setCaseSensitive(e?.caseSensitive ?? false);
    setSetPayeeId(e?.setPayeeId ? String(e.setPayeeId) : null);
    setSetCategoryId(e?.setCategoryId ? String(e.setCategoryId) : null);
    setSetPaymentMode(e?.setPaymentMode != null ? String(e.setPaymentMode) : null);
    setApplyOnManual(e?.applyOnManual ?? true);
    setApplyOnImport(e?.applyOnImport ?? true);
    setTestResult(null);
  }, [opened, editing]);

  const body = (): AssignmentInput => ({
    matchField,
    matchType,
    pattern,
    caseSensitive,
    setPayeeId: setPayeeId ? Number(setPayeeId) : null,
    setCategoryId: setCategoryId ? Number(setCategoryId) : null,
    setPaymentMode: setPaymentMode != null ? Number(setPaymentMode) : null,
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
