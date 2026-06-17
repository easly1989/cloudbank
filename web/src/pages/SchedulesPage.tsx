import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
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
import {
  IconPencil,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Schedule,
  type ScheduleInput,
  type ScheduleUnit,
  createSchedule,
  deleteSchedule,
  listSchedules,
  listTemplates,
  postScheduleNow,
  skipSchedule,
  updateSchedule,
} from "../api/client";
import { useWallet } from "../wallet/WalletProvider";

const UNITS: ScheduleUnit[] = ["day", "week", "month", "year"];
const WEEKEND_MODES = [0, 1, 2, 3];

export function SchedulesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const query = useQuery({
    queryKey: ["schedules", walletId],
    queryFn: () => listSchedules(walletId),
    enabled: walletId > 0,
  });
  const schedules = query.data ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["schedules", walletId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const [opened, form] = useDisclosure(false);
  const [editing, setEditing] = useState<Schedule | null>(null);

  const post = useMutation({
    mutationFn: (id: number) => postScheduleNow(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const skip = useMutation({
    mutationFn: (id: number) => skipSchedule(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteSchedule(walletId, id),
    onSuccess: invalidate,
    onError,
  });

  if (!currentWallet) return null;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("schedules.title")}</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setEditing(null);
            form.open();
          }}
        >
          {t("schedules.add")}
        </Button>
      </Group>

      {schedules.length === 0 && <Text c="dimmed">{t("schedules.empty")}</Text>}

      {schedules.length > 0 && (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("schedules.template")}</Table.Th>
              <Table.Th>{t("schedules.cadenceLabel")}</Table.Th>
              <Table.Th>{t("schedules.nextDue")}</Table.Th>
              <Table.Th>{t("schedules.remaining")}</Table.Th>
              <Table.Th>{t("schedules.mode")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {schedules.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>{s.templateName}</Table.Td>
                <Table.Td>
                  {t("schedules.cadence", { n: s.everyN, unit: t(`schedules.units.${s.unit}`) })}
                </Table.Td>
                <Table.Td>{s.nextDue}</Table.Td>
                <Table.Td>{s.remaining ?? "∞"}</Table.Td>
                <Table.Td>
                  <Badge variant="light" color={s.autoPost ? "teal" : "gray"}>
                    {s.autoPost ? t("schedules.autoLabel") : t("schedules.remindLabel")}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      color="teal"
                      aria-label={t("schedules.postNow")}
                      onClick={() => post.mutate(s.id)}
                    >
                      <IconPlayerPlay size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label={t("schedules.skip")}
                      onClick={() => skip.mutate(s.id)}
                    >
                      <IconPlayerSkipForward size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      aria-label={t("schedules.edit")}
                      onClick={() => {
                        setEditing(s);
                        form.open();
                      }}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={t("schedules.delete")}
                      onClick={() => {
                        if (window.confirm(t("schedules.confirmDelete"))) remove.mutate(s.id);
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

      <ScheduleForm
        opened={opened}
        onClose={form.close}
        walletId={walletId}
        editing={editing}
        onSaved={invalidate}
      />
    </Stack>
  );
}

function ScheduleForm({
  opened,
  onClose,
  walletId,
  editing,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Schedule | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled: opened,
  });

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [unit, setUnit] = useState<ScheduleUnit>("month");
  const [everyN, setEveryN] = useState<number | string>(1);
  const [nextDue, setNextDue] = useState("");
  const [weekendMode, setWeekendMode] = useState("0");
  const [limited, setLimited] = useState(false);
  const [remaining, setRemaining] = useState<number | string>(12);
  const [postAdvance, setPostAdvance] = useState<number | string>(0);
  const [autoPost, setAutoPost] = useState(true);

  useEffect(() => {
    if (!opened) return;
    const e = editing;
    setTemplateId(e ? String(e.templateId) : null);
    setUnit(e?.unit ?? "month");
    setEveryN(e?.everyN ?? 1);
    setNextDue(e?.nextDue ?? new Date().toISOString().slice(0, 10));
    setWeekendMode(String(e?.weekendMode ?? 0));
    setLimited(e?.remaining != null);
    setRemaining(e?.remaining ?? 12);
    setPostAdvance(e?.postAdvance ?? 0);
    setAutoPost(e?.autoPost ?? true);
  }, [opened, editing]);

  const save = useMutation({
    mutationFn: () => {
      const body: ScheduleInput = {
        templateId: Number(templateId),
        unit,
        everyN: Number(everyN) || 1,
        nextDue,
        weekendMode: Number(weekendMode),
        remaining: limited ? Number(remaining) : null,
        postAdvance: Number(postAdvance) || 0,
        autoPost,
      };
      return editing ? updateSchedule(walletId, editing.id, body) : createSchedule(walletId, body);
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

  const templates = templatesQuery.data ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t("schedules.editTitle") : t("schedules.addTitle")}
    >
      <Stack>
        <Select
          label={t("schedules.template")}
          placeholder={templates.length === 0 ? t("schedules.noTemplates") : undefined}
          data={templates.map((tpl) => ({ value: String(tpl.id), label: tpl.name }))}
          value={templateId}
          onChange={setTemplateId}
          disabled={editing != null}
          searchable
        />
        <Group grow>
          <NumberInput label={t("schedules.everyN")} min={1} value={everyN} onChange={setEveryN} />
          <Select
            label={t("schedules.unit")}
            data={UNITS.map((u) => ({ value: u, label: t(`schedules.units.${u}`) }))}
            value={unit}
            onChange={(v) => v && setUnit(v as ScheduleUnit)}
            allowDeselect={false}
          />
        </Group>
        <TextInput
          type="date"
          label={t("schedules.nextDue")}
          value={nextDue}
          onChange={(e) => setNextDue(e.currentTarget.value)}
        />
        <Select
          label={t("schedules.weekendMode")}
          data={WEEKEND_MODES.map((m) => ({
            value: String(m),
            label: t(`schedules.weekend.${m}`),
          }))}
          value={weekendMode}
          onChange={(v) => v && setWeekendMode(v)}
          allowDeselect={false}
        />
        <NumberInput
          label={t("schedules.postAdvance")}
          min={0}
          value={postAdvance}
          onChange={setPostAdvance}
        />
        <Switch
          label={t("schedules.limit")}
          checked={limited}
          onChange={(e) => setLimited(e.currentTarget.checked)}
        />
        {limited && (
          <NumberInput
            label={t("schedules.remaining")}
            min={1}
            value={remaining}
            onChange={setRemaining}
          />
        )}
        <Switch
          label={t("schedules.autoPost")}
          checked={autoPost}
          onChange={(e) => setAutoPost(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("schedules.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!templateId || !nextDue}
          >
            {t("schedules.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
