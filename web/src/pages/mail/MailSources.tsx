import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Menu,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
  IconDots,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type Account,
  checkMailSource,
  createMailSource,
  deleteMailSource,
  listMailboxFolders,
  listMailPatterns,
  type Mailbox,
  type MailCheckResult,
  type MailPattern,
  MAX_MAIL_SOURCES,
  type MailSource,
  reorderMailSources,
  updateMailSource,
} from "../../api/client";
import { useConfirm } from "../../components/confirmContext";
import { notifyError } from "../../notifyError";
import { MailAI } from "./MailAI";
import classes from "./MailSources.module.css";
import { PatternList } from "./PatternList";
import { moveOrder } from "./sourceOrder";
import { useClock, useWhen } from "./when";

/**
 * A mailbox's sources (#794): each reads one folder with its own name,
 * patterns and AI settings, in a band closed until opened. A mail more than
 * one source would read goes to the first in this order.
 */
export function MailSources({
  walletId,
  mailbox,
  accounts,
  hasMails,
  onNewPattern,
  onEditPattern,
  onChecked,
}: {
  walletId: number;
  mailbox: Mailbox;
  accounts: Account[];
  /** There is a mail to start a pattern from. */
  hasMails: boolean;
  onNewPattern: (sourceId: number) => void;
  onEditPattern: (sourceId: number, p: MailPattern) => void;
  onChecked: (res: MailCheckResult) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sources = mailbox.sources;
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  // Listing the folders logs in to the mailbox, so it waits until a folder
  // menu opens; every band shares the one list.
  const [foldersWanted, setFoldersWanted] = useState(false);
  const folders = useQuery({
    queryKey: ["mailFolders", walletId, mailbox.id],
    queryFn: () => listMailboxFolders(walletId, mailbox.id),
    enabled: foldersWanted,
    staleTime: 5 * 60_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["mail", walletId] });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => reorderMailSources(walletId, mailbox.id, ids),
    onSuccess: refresh,
    onError: (err) => {
      notifyError(err);
      refresh();
    },
  });
  const move = (from: number, to: number) => {
    const ids = moveOrder(
      sources.map((s) => s.id),
      from,
      to,
    );
    if (ids) reorder.mutate(ids);
  };
  const toggle = (id: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const full = sources.length >= MAX_MAIL_SOURCES;
  const limitId = useId();
  const addButton = (
    <Button
      size="xs"
      variant="light"
      leftSection={<IconPlus size={14} />}
      // At the limit it stays in the tab order, with the reason beside it.
      onClick={
        full
          ? undefined
          : () => {
              setAdding(true);
              setFoldersWanted(true);
            }
      }
      disabled={adding}
      aria-disabled={full || undefined}
      aria-describedby={full ? limitId : undefined}
      style={full ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
    >
      {t("mail.sources.new")}
    </Button>
  );

  const folderSelect = {
    data: folders.data?.folders,
    loading: folders.isFetching,
    want: () => setFoldersWanted(true),
  };

  return (
    <Stack gap="sm" data-testid="mail-sources" data-tour="mail-sources">
      <Group justify="space-between" gap="sm" wrap="wrap">
        <Text fw={600}>{t("mail.sources.title")}</Text>
        <Group gap="sm" wrap="wrap">
          {full ? (
            <Text size="xs" c="dimmed" id={limitId}>
              {t("mail.sources.limit", { max: MAX_MAIL_SOURCES })}
            </Text>
          ) : (
            sources.length > 1 && (
              <Text size="xs" c="dimmed">
                {t("mail.sources.count", { count: sources.length, max: MAX_MAIL_SOURCES })}
              </Text>
            )
          )}
          {addButton}
        </Group>
      </Group>
      {sources.length > 1 && (
        <Text size="xs" c="dimmed" mt={-4}>
          {t("mail.sources.orderHint")}
        </Text>
      )}
      <div className={classes.box}>
        {sources.map((s, i) => (
          <SourceBand
            key={s.id}
            walletId={walletId}
            mailbox={mailbox}
            source={s}
            index={i}
            count={sources.length}
            opened={open.has(s.id)}
            onToggle={() => toggle(s.id)}
            onMove={(to) => move(i, to)}
            accounts={accounts}
            folders={folderSelect}
            hasMails={hasMails}
            onNewPattern={() => onNewPattern(s.id)}
            onEditPattern={(p) => onEditPattern(s.id, p)}
            onChecked={onChecked}
          />
        ))}
        {adding && (
          <NewSource
            walletId={walletId}
            mailbox={mailbox}
            folders={folderSelect}
            onDone={(made) => {
              setAdding(false);
              if (made) setOpen((o) => new Set(o).add(made.id));
            }}
          />
        )}
      </div>
    </Stack>
  );
}

interface FolderChoices {
  data: string[] | undefined;
  loading: boolean;
  want: () => void;
}

/** The folder picker: the server's folders, loaded when the menu opens. */
function FolderSelect({
  value,
  onChange,
  folders,
  disabled,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  folders: FolderChoices;
  disabled?: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <Select
      label={t("mail.folder")}
      description={t("mail.folderHint")}
      inputWrapperOrder={["label", "input", "description", "error"]}
      data={Array.from(new Set([value, ...(folders.data ?? [])].filter(Boolean)))}
      value={value || null}
      allowDeselect={false}
      searchable
      onDropdownOpen={folders.want}
      nothingFoundMessage={folders.loading ? t("mail.loadingFolders") : undefined}
      rightSection={folders.loading ? <Loader size="xs" /> : undefined}
      onChange={(v) => v && onChange(v)}
      disabled={disabled}
      error={error}
    />
  );
}

/** What a source is doing now, in words, and the colour of its dot. */
function useSourceStatus(mailbox: Mailbox) {
  const { t } = useTranslation();
  const clock = useClock();
  const when = useWhen();
  return (s: MailSource): { text: string; color: string; error: boolean } => {
    if (mailbox.paused) return { text: t("mail.paused"), color: "gray", error: false };
    if (s.status === "error")
      return {
        text: t("mail.sources.statusError", { detail: s.statusDetail }),
        color: "red",
        error: true,
      };
    const next = s.nextCheckAt ? clock(s.nextCheckAt) : "";
    if (s.mode === "idle")
      return {
        text: [t("mail.listening"), next ? t("mail.nextFull", { time: next }) : null]
          .filter(Boolean)
          .join(" · "),
        color: "teal",
        error: false,
      };
    if (s.mode === "polling")
      return {
        text: [t("mail.polling"), next ? t("mail.nextPoll", { time: next }) : null]
          .filter(Boolean)
          .join(" · "),
        color: "teal",
        error: false,
      };
    if (s.mode === "retry")
      return {
        text: [t("mail.reconnecting"), next ? t("mail.retryAt", { time: next }) : null]
          .filter(Boolean)
          .join(" · "),
        color: "yellow",
        error: false,
      };
    return {
      text: s.lastCheckAt
        ? t("mail.lastCheck", { when: when(s.lastCheckAt) })
        : t("mail.neverChecked"),
      color: "teal",
      error: false,
    };
  };
}

function SourceBand({
  walletId,
  mailbox,
  source,
  index,
  count,
  opened,
  onToggle,
  onMove,
  accounts,
  folders,
  hasMails,
  onNewPattern,
  onEditPattern,
  onChecked,
}: {
  walletId: number;
  mailbox: Mailbox;
  source: MailSource;
  index: number;
  count: number;
  opened: boolean;
  onToggle: () => void;
  onMove: (to: number) => void;
  accounts: Account[];
  folders: FolderChoices;
  hasMails: boolean;
  onNewPattern: () => void;
  onEditPattern: (p: MailPattern) => void;
  onChecked: (res: MailCheckResult) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const bodyId = useId();
  const ref = { mailboxId: mailbox.id, sourceId: source.id };
  const status = useSourceStatus(mailbox)(source);
  const [name, setName] = useState(source.name);
  // A rename saved elsewhere (another tab) shows here too.
  const [savedName, setSavedName] = useState(source.name);
  if (savedName !== source.name) {
    setSavedName(source.name);
    setName(source.name);
  }
  const refresh = () => void qc.invalidateQueries({ queryKey: ["mail", walletId] });

  // The patterns load with the band, not before: a closed band does not need them.
  const patterns = useQuery({
    queryKey: ["mailPatterns", walletId, mailbox.id, source.id],
    queryFn: () => listMailPatterns(walletId, ref),
    enabled: opened,
  });

  const update = useMutation({
    mutationFn: (patch: { name?: string; folder?: string }) =>
      updateMailSource(walletId, ref, patch),
    onSuccess: (src, patch) => {
      if (patch.folder)
        notifications.show({
          color: "teal",
          message: t("mail.folderChanged", { folder: src.folder }),
        });
      setName(src.name);
      refresh();
    },
    onError: (err) => {
      notifyError(err);
      setName(source.name);
      refresh();
    },
  });
  const check = useMutation({
    mutationFn: () => checkMailSource(walletId, ref),
    onSuccess: (res) => {
      onChecked(res);
      refresh();
    },
    onError: (err) => {
      notifyError(err);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteMailSource(walletId, ref),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ["mailMessages", walletId, mailbox.id] });
    },
    onError: notifyError,
  });
  const askDelete = async () => {
    const ok = await confirm({
      title: t("mail.sources.deleteTitle", { name: source.name }),
      body: t("mail.sources.deleteBody"),
      confirmLabel: t("mail.sources.delete"),
      danger: true,
    });
    if (ok) remove.mutate();
  };
  const saveName = () => {
    const v = name.trim();
    if (!v) setName(source.name);
    // Enter saves, and the blur after it must not save again.
    else if (v !== source.name && !update.isPending) update.mutate({ name: v });
  };

  const mode = t(`mail.ai.modes.${source.ai.mode}`);
  return (
    <div className={classes.band} data-testid={`mail-source-${source.id}`}>
      <div className={classes.head}>
        <span className={classes.order} aria-hidden>
          {count > 1 ? index + 1 : ""}
        </span>
        <UnstyledButton
          className="cb-disclosure"
          aria-expanded={opened}
          aria-controls={opened ? bodyId : undefined}
          onClick={onToggle}
        >
          <IconChevronRight size={16} aria-hidden />
          <Text size="sm" fw={600} truncate>
            {source.name}
          </Text>
        </UnstyledButton>
        <span className={classes.meta}>
          <span
            className={classes.dot}
            style={{ background: `var(--mantine-color-${status.color}-filled)` }}
            title={status.text}
            aria-hidden
          />
          <Text
            span
            size="xs"
            c={status.error ? "red" : "dimmed"}
            truncate
            className={classes.metaText}
          >
            {status.error ? t("mail.sources.folderGone") : `${source.folder} · ${mode}`}
          </Text>
        </span>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={t("mail.sources.actions", { name: source.name })}
            >
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconArrowUp size={16} />}
              disabled={index === 0}
              onClick={() => onMove(index - 1)}
            >
              {t("mail.sources.moveUp")}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconArrowDown size={16} />}
              disabled={index === count - 1}
              onClick={() => onMove(index + 1)}
            >
              {t("mail.sources.moveDown")}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconRefresh size={16} />}
              disabled={mailbox.paused}
              onClick={() => check.mutate()}
            >
              {t("mail.checkNow")}
            </Menu.Item>
            <Menu.Divider />
            {count > 1 ? (
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={() => void askDelete()}
              >
                {t("mail.sources.delete")}
              </Menu.Item>
            ) : (
              <Tooltip label={t("mail.sources.lastSource")} position="left" withinPortal>
                <div>
                  <Menu.Item leftSection={<IconTrash size={16} />} disabled>
                    {t("mail.sources.delete")}
                  </Menu.Item>
                </div>
              </Tooltip>
            )}
          </Menu.Dropdown>
        </Menu>
      </div>
      {opened && (
        <div className={classes.body} id={bodyId}>
          <Stack gap="sm">
            <Text size="xs" c={status.error ? "red" : "dimmed"} data-testid="mail-source-status">
              {status.text}
            </Text>
            <MailAI
              // A change saved elsewhere starts the form again from it.
              key={JSON.stringify(source.ai)}
              walletId={walletId}
              source={source}
              aiReady={mailbox.aiReady}
              accounts={accounts}
              patterns={patterns.data ?? []}
              before={
                <>
                  <TextInput
                    label={t("mail.sources.name")}
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value)}
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                    }}
                    disabled={update.isPending}
                    maxLength={60}
                  />
                  <FolderSelect
                    value={source.folder}
                    folders={folders}
                    disabled={update.isPending}
                    error={status.error ? t("mail.sources.folderGone") : undefined}
                    onChange={(v) => v !== source.folder && update.mutate({ folder: v })}
                  />
                </>
              }
            />
          </Stack>
          <PatternList
            walletId={walletId}
            source={ref}
            patterns={patterns.data ?? []}
            canCreate={hasMails}
            onNew={onNewPattern}
            onEdit={onEditPattern}
          />
        </div>
      )}
    </div>
  );
}

/** A new source: its name and folder, then it opens like the others. */
function NewSource({
  walletId,
  mailbox,
  folders,
  onDone,
}: {
  walletId: number;
  mailbox: Mailbox;
  folders: FolderChoices;
  onDone: (made: MailSource | null) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const create = useMutation({
    mutationFn: () => createMailSource(walletId, mailbox.id, { name: name.trim(), folder }),
    onSuccess: (made) => {
      void qc.invalidateQueries({ queryKey: ["mail", walletId] });
      onDone(made);
    },
    onError: notifyError,
  });
  const ready = name.trim() !== "" && folder !== "";
  return (
    <div className={classes.band} data-testid="mail-source-new">
      <div className={classes.head}>
        <span className={classes.order} aria-hidden>
          {mailbox.sources.length + 1}
        </span>
        <Text size="sm" fw={600} px={8}>
          {t("mail.sources.new")}
        </Text>
      </div>
      <Stack gap="sm" p={16} maw={452}>
        <TextInput
          label={t("mail.sources.name")}
          placeholder={t("mail.sources.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          maxLength={60}
          data-autofocus
          autoFocus
        />
        <FolderSelect value={folder} onChange={setFolder} folders={folders} />
        <Group gap="sm">
          <Button
            size="xs"
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!ready}
          >
            {t("mail.sources.add")}
          </Button>
          <Button size="xs" variant="default" onClick={() => onDone(null)}>
            {t("common.cancel")}
          </Button>
        </Group>
      </Stack>
    </div>
  );
}
