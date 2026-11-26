import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Code,
  CopyButton,
  Divider,
  Group,
  Image,
  Loader,
  Menu,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconBrandWindows,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconExternalLink,
  IconMail,
  IconRefresh,
  IconServer,
  IconSparkles,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  type Account,
  checkMailbox,
  getMailOverview,
  listAccounts,
  listMailboxMessages,
  listMailPatterns,
  type Mailbox,
  type MailCheckResult,
  type MailPattern,
  type MailSummary,
  pollMicrosoftMail,
  removeMailbox,
  startMicrosoftMail,
  updateMailbox,
} from "../api/client";
import { useConfirm } from "../components/confirmContext";
import { ErrorMessage } from "../components/ErrorMessage";
import { formatMinor } from "../money";
import { notifyError } from "../notifyError";
import { ImapConnect } from "./mail/ImapConnect";
import { MailSources } from "./mail/MailSources";
import { useWhen } from "./mail/when";
import { countMails, filterMails, type MailFilter } from "./mail/latestMails";
import { providerForServer } from "./mail/imapProviders";
import { PatternSheet } from "./mail/PatternSheet";
import { useWallet } from "../wallet/WalletProvider";

/** How many of a mailbox's latest mails show before "Show all". */
const RECENT_SHOWN = 8;

/**
 * Bank mails (#654): CloudBank reads the bank's payment notifications from one
 * folder of a mailbox. This is where a mailbox is connected, its folder chosen
 * and what it read shown, in its own section of Settings.
 */
export function MailSettings() {
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [signIn, setSignIn] = useState<{ mailboxId?: number } | null>(null);
  // The IMAP connect form: a mailbox to give a new password, or a new one.
  const [imap, setImap] = useState<{ mailbox?: Mailbox } | null>(null);

  const overview = useQuery({
    queryKey: ["mail", walletId],
    queryFn: () => getMailOverview(walletId),
    enabled: walletId > 0,
    // The server listens on its own (#656): a mail that arrives, or a
    // connection that drops, shows here without a reload.
    refetchInterval: 30_000,
  });

  if (!currentWallet || !overview.data) return null;
  const { available, microsoft, mailboxes } = overview.data;

  return (
    <Stack>
      <ConnectCard
        available={available}
        microsoft={microsoft}
        onMicrosoft={() => setSignIn({})}
        onImap={() => setImap({})}
      />
      {mailboxes.map((m) => (
        <MailboxCard
          key={m.id}
          walletId={walletId}
          mailbox={m}
          onSignInAgain={() =>
            m.provider === "imap" ? setImap({ mailbox: m }) : setSignIn({ mailboxId: m.id })
          }
        />
      ))}
      {imap && (
        <ImapConnect
          walletId={walletId}
          mailbox={imap.mailbox}
          microsoft={microsoft}
          onMicrosoft={() => {
            setImap(null);
            setSignIn({});
          }}
          onClose={() => setImap(null)}
        />
      )}
      {signIn && (
        <MicrosoftSignIn
          walletId={walletId}
          mailboxId={signIn.mailboxId}
          onClose={() => setSignIn(null)}
        />
      )}
    </Stack>
  );
}

function ConnectCard({
  available,
  microsoft,
  onMicrosoft,
  onImap,
}: {
  available: boolean;
  microsoft: boolean;
  onMicrosoft: () => void;
  onImap: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card withBorder data-testid="mail-connect" data-tour="mail-connect">
      <Stack gap="sm">
        <Group gap="xs">
          <IconMail size={18} />
          <Title order={5}>{t("mail.connectTitle")}</Title>
        </Group>
        {!available && (
          <Alert color="gray" variant="light" p="sm">
            <Text size="sm">{t("mail.unavailable")}</Text>
          </Alert>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Paper withBorder p="sm" radius="md">
            <Group gap="xs" mb={4}>
              <IconBrandWindows size={16} />
              <Text fw={600} size="sm">
                Microsoft
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              {t("mail.microsoftHint")}
            </Text>
            <Button size="xs" onClick={onMicrosoft} disabled={!microsoft}>
              {t("mail.microsoftConnect")}
            </Button>
          </Paper>
          <Paper withBorder p="sm" radius="md">
            <Group gap="xs" mb={4}>
              <IconServer size={16} />
              <Text fw={600} size="sm">
                {t("mail.imapTitle")}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              {t("mail.imapHint")}
            </Text>
            <Button size="xs" onClick={onImap} disabled={!available}>
              {t("mail.imapConnect")}
            </Button>
          </Paper>
        </SimpleGrid>
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} p="sm">
          <Text size="sm">
            <Trans i18nKey="mail.warning" components={{ b: <b /> }} />
          </Text>
        </Alert>
      </Stack>
    </Card>
  );
}

function MailboxCard({
  walletId,
  mailbox,
  onSignInAgain,
}: {
  walletId: number;
  mailbox: Mailbox;
  onSignInAgain: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const when = useWhen();
  // The pattern editor: the source, and a pattern to edit or the mail a new
  // one starts from.
  const [editor, setEditor] = useState<{
    sourceId: number;
    pattern?: MailPattern;
    mailId?: number;
  } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["mail", walletId] });
    void qc.invalidateQueries({ queryKey: ["mailMessages", walletId, mailbox.id] });
  };
  const onError = (err: unknown) => {
    notifyError(err);
    refresh();
  };

  const messages = useQuery({
    // Keyed by the newest mail's arrival, so a mail the listener read comes
    // with the next look at the overview.
    queryKey: ["mailMessages", walletId, mailbox.id, mailbox.lastMailAt],
    queryFn: () => listMailboxMessages(walletId, mailbox.id),
    placeholderData: (prev) => prev,
  });
  const accounts = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
  });

  const checked = (res: MailCheckResult) =>
    notifications.show({
      color: "teal",
      message:
        res.new === 0
          ? t("mail.checkedNone")
          : res.created > 0
            ? `${t("mail.checked", { count: res.new })} · ${t("mail.checkedCreated", { count: res.created })}`
            : t("mail.checked", { count: res.new }),
    });
  const check = useMutation({
    mutationFn: () => checkMailbox(walletId, mailbox.id),
    onSuccess: (res) => {
      checked(res);
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: (patch: { paused?: boolean }) => updateMailbox(walletId, mailbox.id, patch),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: () => removeMailbox(walletId, mailbox.id),
    onSuccess: refresh,
    onError,
  });

  const disconnect = async () => {
    const ok = await confirm({
      title: t("mail.disconnectTitle", { address: mailbox.address }),
      body: t("mail.disconnectBody"),
      confirmLabel: t("mail.disconnect"),
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const list = messages.data ?? [];
  const sources = mailbox.sources;
  // A mail goes back to the source that read it; one whose source is gone, to
  // the first.
  const sourceFor = (m?: MailSummary) =>
    sources.find((s) => s.id === m?.sourceId)?.id ?? sources[0]?.id;
  const editPatternOf = async (m: MailSummary) => {
    const sourceId = sourceFor(m);
    if (sourceId == null || m.patternId == null) return;
    const ref = { mailboxId: mailbox.id, sourceId };
    const patterns = await qc.fetchQuery({
      queryKey: ["mailPatterns", walletId, mailbox.id, sourceId],
      queryFn: () => listMailPatterns(walletId, ref),
    });
    const p = patterns.find((x) => x.id === m.patternId);
    if (p) setEditor({ sourceId, pattern: p });
  };

  // The mailbox's own line is about the connection; each source says how its
  // folder is doing in its band.
  const lastMail = mailbox.lastMailAt
    ? t("mail.lastMail", { when: when(mailbox.lastMailAt) })
    : null;
  const broken = sources.filter((s) => s.status === "error").length;
  let statusColor = "teal";
  let parts: (string | null)[];
  if (mailbox.status === "reauth") {
    statusColor = "red";
    parts = [mailbox.provider === "imap" ? t("mail.imap.statusReauth") : t("mail.statusReauth")];
  } else if (mailbox.status === "error") {
    statusColor = "red";
    parts = [t("mail.statusError", { detail: mailbox.statusDetail })];
  } else if (broken > 0) {
    statusColor = "yellow";
    parts = [t("mail.sources.toFix", { count: broken, total: sources.length }), lastMail];
  } else {
    const live = sources.filter((s) => s.mode !== "").length;
    parts = [
      live > 0
        ? t("mail.sources.live", { count: live })
        : mailbox.lastCheckAt
          ? t("mail.lastCheck", { when: when(mailbox.lastCheckAt) })
          : t("mail.neverChecked"),
      lastMail,
    ];
  }
  const statusText: ReactNode = parts.filter(Boolean).join(" · ");
  const isImap = mailbox.provider === "imap";
  const providerName = mailbox.imap ? providerForServer(mailbox.imap).name || "IMAP" : "Microsoft";
  if (mailbox.paused) statusColor = "gray";

  return (
    <Card withBorder data-testid="mailbox-card">
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start" data-tour="mail-mailbox">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon variant="light" size={36} radius="md">
              {isImap ? <IconServer size={20} /> : <IconBrandWindows size={20} />}
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Text fw={600} truncate data-cb-sensitive>
                {mailbox.address}
              </Text>
              <Group gap={6}>
                <Badge variant="light" size="sm">
                  {providerName}
                </Badge>
                {mailbox.paused && (
                  <Badge variant="light" size="sm" color="gray">
                    {t("mail.paused")}
                  </Badge>
                )}
              </Group>
            </div>
          </Group>
          <Group gap={4} wrap="nowrap">
            <Button
              size="xs"
              variant="default"
              leftSection={<IconRefresh size={14} />}
              loading={check.isPending}
              onClick={() => check.mutate()}
              visibleFrom="sm"
            >
              {t("mail.checkNow")}
            </Button>
            <Tooltip label={t("mail.checkNow")}>
              <ActionIcon
                variant="default"
                hiddenFrom="sm"
                aria-label={t("mail.checkNow")}
                loading={check.isPending}
                onClick={() => check.mutate()}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" aria-label={t("mail.more")}>
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => update.mutate({ paused: !mailbox.paused })}>
                  {mailbox.paused ? t("mail.resume") : t("mail.pause")}
                </Menu.Item>
                <Menu.Item onClick={onSignInAgain}>
                  {isImap ? t("mail.imap.newPassword") : t("mail.signInAgain")}
                </Menu.Item>
                <Menu.Item color="red" onClick={() => void disconnect()}>
                  {t("mail.disconnect")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>

        <Group gap="xs" wrap="wrap" align="center">
          <Group gap={6} wrap="nowrap" align="baseline" style={{ minWidth: 0 }}>
            <Box w={8} h={8} bg={statusColor} style={{ borderRadius: 4, flexShrink: 0 }} />
            <Text
              size="xs"
              c={statusColor === "red" ? "red" : "dimmed"}
              data-testid="mailbox-status"
            >
              {statusText}
            </Text>
          </Group>
          {mailbox.status === "reauth" && (
            <Button size="compact-xs" variant="light" onClick={onSignInAgain}>
              {isImap ? t("mail.imap.newPassword") : t("mail.signInAgain")}
            </Button>
          )}
        </Group>

        <Divider />

        <MailSources
          walletId={walletId}
          mailbox={mailbox}
          accounts={accounts.data ?? []}
          hasMails={list.length > 0}
          onNewPattern={(sourceId) => setEditor({ sourceId })}
          onEditPattern={(sourceId, pattern) => setEditor({ sourceId, pattern })}
          onChecked={checked}
        />

        <Divider />

        <LatestMails
          mailboxId={mailbox.id}
          list={list}
          accounts={accounts.data ?? []}
          showSource={sources.length > 1}
          onCreate={(m) => {
            const sourceId = sourceFor(m);
            if (sourceId != null) setEditor({ sourceId, mailId: m.id });
          }}
          onFix={(m) => void editPatternOf(m)}
        />
      </Stack>
      {editor && (
        <PatternSheet
          walletId={walletId}
          mailboxId={mailbox.id}
          sourceId={editor.sourceId}
          pattern={editor.pattern}
          startMailId={editor.mailId}
          mails={list}
          onClose={() => setEditor(null)}
        />
      )}
    </Card>
  );
}

/** A value remembered for this browser session only (null: none kept). */
function useSessionValue(key: string): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const set = (v: string | null) => {
    setValue(v);
    try {
      if (v === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, v);
    } catch {
      /* storage unavailable (private mode): this page only */
    }
  };
  return [value, set];
}

/**
 * A mailbox's latest mails, closed by default. The title opens them; the badge
 * counts those read (a transaction exists) and those to review (none does), and
 * each half opens the list on its own group.
 */
function LatestMails({
  mailboxId,
  list,
  accounts,
  showSource,
  onCreate,
  onFix,
}: {
  mailboxId: number;
  list: MailSummary[];
  accounts: Account[];
  /** The mailbox has more than one source: each mail names the one that read it. */
  showSource: boolean;
  onCreate: (mail: MailSummary) => void;
  onFix: (mail: MailSummary) => void;
}) {
  const { t } = useTranslation();
  const when = useWhen();
  const bodyId = useId();
  // Closed at first; open state and filter are kept for this browser session.
  const [openRaw, setOpenRaw] = useSessionValue(`cb.mail.latestOpen.${mailboxId}`);
  const open = openRaw === "1";
  const setOpen = (v: boolean) => setOpenRaw(v ? "1" : "0");
  const [filterRaw, setFilter] = useSessionValue(`cb.mail.latestFilter.${mailboxId}`);
  const [showAll, setShowAll] = useState(false);
  const counts = countMails(list);
  // Unset, or its group now empty: the mails to review, or all of them when
  // none is.
  const filter = filterRaw === "review" || filterRaw === "read" ? filterRaw : null;
  const current: MailFilter =
    filter && counts[filter] > 0
      ? filter
      : filterRaw === "all"
        ? "all"
        : counts.review
          ? "review"
          : "all";
  const picked = filterMails(list, current);
  const shown = showAll ? picked : picked.slice(0, RECENT_SHOWN);
  const pick = (f: MailFilter) => {
    setFilter(f);
    setShowAll(false);
    setOpen(true);
  };
  const both = counts.read > 0 && counts.review > 0;

  return (
    <Stack gap="xs" data-tour="mail-history">
      <Group gap="xs" wrap="wrap" align="center">
        <UnstyledButton
          className="cb-disclosure"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => {
            // Opened by the title: the mails to review, or all when none is,
            // and it stays there while the counts change.
            setFilter(open ? null : counts.review ? "review" : "all");
            setOpen(!open);
            setShowAll(false);
          }}
        >
          <IconChevronRight size={16} aria-hidden />
          <Text fw={600}>{t("mail.recent")}</Text>
        </UnstyledButton>
        {counts.all === 0 ? (
          <Text size="xs" c="dimmed">
            {t("mail.latest.none")}
          </Text>
        ) : (
          <Group gap={0} wrap="nowrap">
            {counts.read > 0 && (
              <Badge
                component="button"
                type="button"
                variant="light"
                color="teal"
                size="md"
                className="cb-split-half mantine-focus-auto"
                aria-expanded={open}
                aria-controls={open ? bodyId : undefined}
                aria-label={t("mail.latest.openRead", { count: counts.read })}
                style={{
                  color: "var(--cb-teal-tint-fg)",
                  ...(both && { borderTopRightRadius: 0, borderBottomRightRadius: 0 }),
                }}
                onClick={() => pick("read")}
              >
                {t("mail.latest.read", { count: counts.read })}
              </Badge>
            )}
            {counts.review > 0 && (
              <Badge
                component="button"
                type="button"
                variant="light"
                color="yellow"
                size="md"
                className="cb-split-half mantine-focus-auto"
                aria-expanded={open}
                aria-controls={open ? bodyId : undefined}
                aria-label={t("mail.latest.openReview", { count: counts.review })}
                style={{
                  color: "var(--cb-attention)",
                  background: "var(--cb-attention-bg)",
                  ...(both && { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }),
                }}
                onClick={() => pick("review")}
              >
                {t("mail.latest.toReview", { count: counts.review })}
              </Badge>
            )}
          </Group>
        )}
      </Group>
      {open && (
        <Stack gap="xs" id={bodyId}>
          {list.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("mail.recentEmpty")}
            </Text>
          ) : (
            <>
              <SegmentedControl
                aria-label={t("mail.latest.filterLabel")}
                value={current}
                onChange={(v) => {
                  setFilter(v as MailFilter);
                  setShowAll(false);
                }}
                style={{ alignSelf: "flex-start", maxWidth: "100%" }}
                data={[
                  { value: "review", label: t("mail.latest.filterReview") },
                  { value: "read", label: t("mail.latest.filterRead") },
                  { value: "all", label: t("mail.latest.filterAll") },
                ]}
              />
              {current === "review" && picked.length === 0 ? (
                <Text size="sm" c="dimmed" py={8}>
                  {t("mail.latest.nothingToReview")}
                </Text>
              ) : (
                <Stack gap={0}>
                  {shown.map((m) => (
                    <Group
                      key={m.id}
                      gap="xs"
                      py={8}
                      wrap="wrap"
                      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
                    >
                      <Text
                        size="sm"
                        c="dimmed"
                        w={{ base: "100%", sm: 150 }}
                        style={{ flexShrink: 0 }}
                      >
                        {when(m.receivedAt)}
                      </Text>
                      <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }} data-cb-sensitive>
                        {m.subject || m.sender}
                      </Text>
                      {/* On a phone the outcome takes its own line, so the subject
                        keeps the width it needs. */}
                      <Group
                        gap={6}
                        wrap="nowrap"
                        w={{ base: "100%", sm: "auto" }}
                        style={{ minWidth: 0 }}
                      >
                        {showSource && (
                          <Text
                            span
                            size="11px"
                            c="dimmed"
                            title={t("mail.sources.readBy")}
                            style={{
                              flexShrink: 0,
                              whiteSpace: "nowrap",
                              border: "1px solid var(--mantine-color-default-border)",
                              borderRadius: 4,
                              padding: "1px 7px",
                            }}
                          >
                            {m.sourceName ?? t("mail.sources.removed")}
                          </Text>
                        )}
                        <Box style={{ minWidth: 0 }}>
                          <MailOutcome
                            mail={m}
                            accounts={accounts}
                            onCreate={() => onCreate(m)}
                            onFix={() => onFix(m)}
                          />
                        </Box>
                      </Group>
                    </Group>
                  ))}
                  {picked.length > RECENT_SHOWN && (
                    <Button variant="subtle" size="xs" mt={4} onClick={() => setShowAll((s) => !s)}>
                      {showAll ? t("mail.showFewer") : t("mail.showAll", { count: picked.length })}
                    </Button>
                  )}
                </Stack>
              )}
            </>
          )}
        </Stack>
      )}
    </Stack>
  );
}

const OUTCOME_COLOR: Record<MailSummary["outcome"], string> = {
  created: "teal",
  duplicate: "gray",
  unrecognized: "yellow",
  unverified: "orange",
  failed: "red",
};

/**
 * What became of one mail, and what to do next: open the transaction it made,
 * make a pattern from it, or fix the pattern that could not write it.
 */
function MailOutcome({
  mail,
  accounts,
  onCreate,
  onFix,
}: {
  mail: MailSummary;
  accounts: Account[];
  onCreate: () => void;
  onFix: () => void;
}) {
  const { t } = useTranslation();
  const badge = (
    <Badge color={OUTCOME_COLOR[mail.outcome]} variant="light" size="sm" style={{ flexShrink: 0 }}>
      {t(`mail.outcome.${mail.outcome}`)}
    </Badge>
  );
  const acc = accounts.find((a) => a.id === mail.accountId);
  const link =
    mail.transactionId && mail.accountId
      ? `/transactions?account=${mail.accountId}&txn=${mail.transactionId}`
      : null;
  let next: ReactNode = null;
  if (mail.outcome === "created" && link) {
    const amount =
      acc && mail.amount != null
        ? formatMinor(mail.amount, {
            fracDigits: acc.currencyFracDigits,
            decimalChar: acc.currencyDecimalChar,
            groupChar: acc.currencyGroupChar,
            symbol: acc.currencySymbol,
            symbolPrefix: acc.currencySymbolPrefix,
          })
        : null;
    next = (
      <Anchor component={Link} to={link} size="sm" truncate data-cb-sensitive>
        {[amount, mail.payee, mail.memo].filter(Boolean).join(" · ") || t("mail.history.open")}
      </Anchor>
    );
  } else if (mail.outcome === "duplicate") {
    next = link ? (
      <Anchor component={Link} to={link} size="sm" c="dimmed">
        {t("mail.history.alreadyThere")}
      </Anchor>
    ) : (
      <Text size="sm" c="dimmed">
        {t("mail.history.alreadyThere")}
      </Text>
    );
  } else if (mail.outcome === "unrecognized") {
    next = (
      <Anchor component="button" type="button" size="sm" onClick={onCreate}>
        {t("mail.history.createPattern")}
      </Anchor>
    );
  } else if (mail.outcome === "unverified") {
    next = (
      <Text size="sm" c="dimmed">
        {t("mail.history.unverified")}
      </Text>
    );
  } else if (mail.outcome === "failed") {
    next = (
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <Text size="sm" c="dimmed" truncate title={mail.detail}>
          {mail.detail}
        </Text>
        {mail.patternId != null && (
          <Anchor
            component="button"
            type="button"
            size="sm"
            onClick={onFix}
            style={{ flexShrink: 0 }}
          >
            {t("mail.history.fixPattern")}
          </Anchor>
        )}
      </Group>
    );
  }
  return (
    <Group gap={6} wrap="wrap" style={{ minWidth: 0, maxWidth: "100%", rowGap: 4 }}>
      {badge}
      {mail.byAi && (
        <Tooltip label={t("mail.ai.readByAI")}>
          <Badge
            color="violet"
            variant="outline"
            size="sm"
            leftSection={<IconSparkles size={11} />}
            style={{ flexShrink: 0 }}
            aria-label={t("mail.ai.readByAI")}
          >
            AI
          </Badge>
        </Tooltip>
      )}
      {next}
    </Group>
  );
}

/**
 * The device-code sign-in: the code to type at microsoft.com/devicelogin, a
 * countdown, and a quiet poll until Microsoft says yes or no.
 */
function MicrosoftSignIn({
  walletId,
  mailboxId,
  onClose,
}: {
  walletId: number;
  mailboxId?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const start = useQuery({
    queryKey: ["mailSignIn", walletId, mailboxId ?? 0, attempt],
    queryFn: () => startMicrosoftMail(walletId, mailboxId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const flow = start.data;
  const poll = useQuery({
    queryKey: ["mailSignInPoll", flow?.flowId],
    queryFn: () => pollMicrosoftMail(walletId, flow?.flowId ?? ""),
    enabled: !!flow,
    gcTime: 0,
    // A dropped poll must not end a sign-in the user is halfway through.
    retry: 3,
    refetchInterval: (q) => {
      const state = q.state.data?.state;
      return !state || state === "pending" ? (flow?.interval ?? 5) * 1000 : false;
    },
  });
  const state = poll.data?.state;
  const [qr, setQr] = useState("");
  const uri = flow?.verificationUri;

  useEffect(() => {
    if (!uri) return;
    let live = true;
    void QRCode.toDataURL(uri, { margin: 1, width: 208 }).then((d) => live && setQr(d));
    return () => {
      live = false;
    };
  }, [uri]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (state !== "done") return;
    notifications.show({
      color: "teal",
      message: t("mail.connected", { address: poll.data?.mailbox?.address ?? "" }),
    });
    void qc.invalidateQueries({ queryKey: ["mail", walletId] });
    onClose();
  }, [state, poll.data, qc, walletId, onClose, t]);

  // Counted from when the code arrived, by this browser's clock: a wrong
  // clock would otherwise show a fresh code as expired.
  const deadline = flow ? start.dataUpdatedAt + flow.expiresIn * 1000 : 0;
  const left = flow ? Math.max(0, Math.round((deadline - now) / 1000)) : 0;
  const countdown = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const expired = state === "expired" || (flow && left === 0);
  const failed = start.isError || poll.isError;
  const again = () => setAttempt((a) => a + 1);

  return (
    <Modal opened onClose={onClose} title={t("mail.signInTitle")} centered size="md">
      {start.isPending ? (
        <Group justify="center" py="lg">
          <Loader size="sm" />
        </Group>
      ) : failed ? (
        <Stack>
          <Alert color="red" variant="light">
            <ErrorMessage error={start.error ?? poll.error} />
          </Alert>
          <Group justify="flex-end">
            <Button onClick={again}>{t("mail.tryAgain")}</Button>
          </Group>
        </Stack>
      ) : state === "declined" || expired ? (
        <Stack>
          <Text size="sm">{state === "declined" ? t("mail.declined") : t("mail.expired")}</Text>
          <Group justify="flex-end">
            <Button onClick={again}>{t("mail.tryAgain")}</Button>
          </Group>
        </Stack>
      ) : (
        flow && (
          <Stack gap="md">
            <Step n={1}>
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                <div>
                  <Text size="sm">{t("mail.step1")}</Text>
                  <Button
                    size="xs"
                    variant="default"
                    mt={6}
                    rightSection={<IconExternalLink size={14} />}
                    component="a"
                    href={flow.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {flow.verificationUri.replace(/^https?:\/\/(www\.)?/, "")}
                  </Button>
                </div>
                {/* Only the page: Microsoft takes no code in the link, so the
                    code below is typed on the phone too. Not on a phone, which
                    would be scanning itself. */}
                {qr && (
                  <Stack gap={4} align="center" style={{ flexShrink: 0 }} visibleFrom="sm">
                    <Image src={qr} alt={t("mail.scanQr")} w={104} h={104} radius="sm" />
                    <Text size="xs" c="dimmed" ta="center" maw={120}>
                      {t("mail.scanQr")}
                    </Text>
                  </Stack>
                )}
              </Group>
            </Step>
            <Step n={2}>
              <Text size="sm">{t("mail.step2")}</Text>
              <Group gap="xs" mt={6}>
                <Code
                  fz={22}
                  fw={700}
                  px="md"
                  py={6}
                  style={{ letterSpacing: 3 }}
                  data-testid="mail-user-code"
                >
                  {flow.userCode}
                </Code>
                <CopyButton value={flow.userCode}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? t("mail.copied") : t("mail.copyCode")}>
                      <ActionIcon variant="subtle" onClick={copy} aria-label={t("mail.copyCode")}>
                        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
            </Step>
            <Step n={3}>
              <Text size="sm">
                <Trans i18nKey="mail.step3" components={{ b: <b /> }} />
              </Text>
            </Step>
            <Group gap="xs" wrap="nowrap">
              <Loader size="xs" style={{ flexShrink: 0 }} />
              <Text size="sm" c="dimmed">
                {t("mail.waiting", { time: countdown })}
              </Text>
            </Group>
          </Stack>
        )
      )}
    </Modal>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <Group gap="sm" align="flex-start" wrap="nowrap">
      <ThemeIcon size={24} radius="xl" variant="light">
        <Text size="xs" fw={700}>
          {n}
        </Text>
      </ThemeIcon>
      <div style={{ flex: 1 }}>{children}</div>
    </Group>
  );
}
