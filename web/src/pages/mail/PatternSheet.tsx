import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  CloseButton,
  Collapse,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconWand, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  applyMailPattern,
  createMailPattern,
  getMailboxMessage,
  listAccounts,
  type MailCardAccount,
  type MailPattern,
  type MailPatternInput,
  type MailSummary,
  savePreferences,
  testMailPattern,
  updateMailPattern,
} from "../../api/client";
import { ApiError } from "../../api/core";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorMessage } from "../../components/ErrorMessage";
import { SideSheet } from "../../components/SideSheet";
import { useDateFormat } from "../../dates";
import { formatMinor } from "../../money";
import { notifyError } from "../../notifyError";
import { TourButton } from "../../onboarding/TourButton";
import { useTour } from "../../onboarding/tourContext";
import { TourOffer } from "../../onboarding/TourOffer";
import { TOURS, toursSeen } from "../../onboarding/tours";
import { PAYMENT_MODES } from "../../transactionEnums";
import {
  buildPattern,
  FIELDS,
  type Field,
  guessDateFormat,
  mailText,
  type Mark,
  orderedMarks,
  readEditorState,
  type Sample,
  sampleFields,
} from "./patternBuilder";
import { PatternTestMails } from "./PatternTestMails";

/** Each field's colour, the same in the mail and in the list of fields. */
const FIELD_COLOR: Record<Field, string> = {
  amount: "teal",
  memo: "blue",
  payee: "indigo",
  info: "cyan",
  tag: "pink",
  category: "orange",
  date: "violet",
  card: "grape",
  direction: "lime",
};

/** A piece of the mail being chosen: a new selection, or a piece already marked. */
interface Pick {
  start: number;
  end: number;
}

/**
 * The pattern editor (#657, variant B of the mockup): start from one real
 * mail, select a piece of its text and say what it is. CloudBank writes the
 * pattern from those pieces, tries it on the sender's latest mails and shows
 * the transaction the mail becomes. Advanced shows the expression, which can
 * also be written by hand.
 *
 * A mail the pattern does not read shows where it stops matching; marking
 * the same fields in it too makes one pattern of both wordings (#674).
 */
export function PatternSheet({
  walletId,
  mailboxId,
  pattern,
  startMailId,
  mails,
  onClose,
}: {
  walletId: number;
  mailboxId: number;
  /** The pattern to edit; none for a new one. */
  pattern?: MailPattern;
  /** The mail a new pattern starts from. */
  startMailId?: number;
  /** The mailbox's history, to pick the mail from. */
  mails: MailSummary[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const fmtDate = useDateFormat();
  const saved = useMemo(() => (pattern ? readEditorState(pattern.editor) : null), [pattern]);

  // The editor's tour is offered once, the first time a pattern is made, and
  // being offered counts as seen, as a page's tour does (#678).
  const { user } = useAuth();
  const { start } = useTour();
  const [offer, setOffer] = useState(
    () =>
      !pattern &&
      (user?.preferences?.tourOffers ?? true) &&
      !toursSeen(user?.preferences).includes("patternEditor"),
  );
  useEffect(() => {
    if (!offer) return;
    const seen = toursSeen(user?.preferences);
    void savePreferences(qc, { toursSeen: [...seen, "patternEditor"], tutorialSeen: undefined });
    // Once, as the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Left unset, a new pattern's name and sender come from its mail.
  const [nameSet, setName] = useState<string | null>(pattern ? pattern.name : null);
  const [senderSet, setSender] = useState<string | null>(pattern ? pattern.sender : null);
  const [subjectMode, setSubjectMode] = useState<MailPatternInput["subjectMode"]>(
    pattern?.subjectMode ?? "",
  );
  const [subject, setSubject] = useState(pattern?.subject ?? "");
  const [accountId, setAccountId] = useState<string | null>(
    pattern ? String(pattern.accountId) : null,
  );
  const [cards, setCards] = useState<MailCardAccount[]>(pattern?.cards ?? []);
  // Money out, money in, or told by a word in each mail: one or the other.
  const [direction, setDirection] = useState<MailPatternInput["direction"]>(
    pattern?.direction ?? "out",
  );
  const [inWords, setInWords] = useState(pattern?.inWords ?? "");
  const [paymentMode, setPaymentMode] = useState(String(pattern?.paymentMode ?? 0));
  const [applyRules, setApplyRules] = useState(pattern?.applyRules ?? true);
  const [dateFormat, setDateFormat] = useState(pattern?.dateFormat ?? "");
  const [requireAuth, setRequireAuth] = useState(pattern?.requireAuth ?? true);

  // The mails the pieces are chosen in. A saved pattern reopens on the texts
  // it was made from, which may have left the history since.
  const firstMail =
    startMailId ?? mails.find((m) => m.outcome === "unrecognized")?.id ?? mails[0]?.id ?? null;
  const [samplesSet, setSamples] = useState<Sample[] | null>(saved?.samples ?? null);
  const [cur, setCur] = useState(0);
  const [manual, setManual] = useState(pattern ? (saved?.manual ?? true) : false);
  const [expr, setExpr] = useState(pattern?.body ?? "");
  const [advanced, setAdvanced] = useState(!!pattern && (!saved || saved.manual));
  const [pick, setPick] = useState<Pick | null>(null);
  const [applyWaiting, setApplyWaiting] = useState(true);

  const accounts = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
  });
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const accountData = (accounts.data ?? [])
    .filter((a) => !a.closed || String(a.id) === accountId)
    .map((a) => ({ value: String(a.id), label: a.name }));

  // The mail a new pattern opens on.
  const first = useQuery({
    queryKey: ["mailMessage", walletId, mailboxId, firstMail],
    queryFn: () => getMailboxMessage(walletId, mailboxId, firstMail ?? 0),
    enabled: !pattern && firstMail != null,
  });
  const samples: Sample[] = samplesSet ?? [
    {
      mailId: firstMail,
      text: first.data ? mailText(first.data.subject, first.data.body) : "",
      marks: [],
    },
  ];
  const current = samples[Math.min(cur, samples.length - 1)];
  const { mailId, text, marks } = current;
  const editCurrent = (change: (prev: Mark[]) => Mark[]) =>
    setSamples(samples.map((s) => (s === current ? { ...s, marks: change(s.marks) } : s)));
  const name = nameSet ?? first.data?.subject ?? "";
  const sender = senderSet ?? first.data?.sender ?? "";

  // Another mail to choose the pieces in: either it replaces the only one,
  // and the pieces chosen in it go, or it joins the example mails.
  const [loading, setLoading] = useState(false);
  const loadMail = (id: number, join: boolean) => {
    setLoading(true);
    qc.fetchQuery({
      queryKey: ["mailMessage", walletId, mailboxId, id],
      queryFn: () => getMailboxMessage(walletId, mailboxId, id),
    })
      .then((d) => {
        const s = { mailId: id, text: mailText(d.subject, d.body), marks: [] };
        // From the list as it is now: marks may have changed while it loaded.
        setSamples((prev) => (join ? [...(prev ?? samples), s] : [s]));
        // Past the end means the last one: the mail just added.
        setCur(join ? Infinity : 0);
        setManual(false);
        setPick(null);
      })
      .catch(notifyError)
      .finally(() => setLoading(false));
  };
  const built = buildPattern(samples);
  const body = manual ? expr : built.expression;
  const lead = samples[0];
  const has = (f: Field) =>
    manual ? body.includes(`(?P<${f}>`) : lead.marks.some((m) => m.field === f);
  // The mail on screen has other fields marked than the first one.
  const leadFields = sampleFields(lead);
  const unlike =
    current !== lead && [...sampleFields(current)].sort().join() !== [...leadFields].sort().join();
  const words = inWords
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  // Only a direction told by the mail has a word to mark in it.
  const chooseDirection = (v: string | null) => {
    const d = (v ?? "out") as MailPatternInput["direction"];
    setDirection(d);
    if (d !== "capture") {
      setSamples(
        samples.map((s) => ({ ...s, marks: s.marks.filter((m) => m.field !== "direction") })),
      );
    }
  };

  const input: MailPatternInput = {
    name: name.trim(),
    sender: sender.trim(),
    subjectMode,
    subject: subjectMode ? subject : "",
    body,
    accountId: Number(accountId ?? 0),
    cards: has("card") ? cards.filter((c) => c.digits.trim() && c.accountId) : [],
    direction,
    inWords: direction === "capture" ? inWords : "",
    paymentMode: Number(paymentMode),
    applyRules,
    dateFormat: has("date") ? dateFormat : "",
    requireAuth,
    editor: JSON.stringify({
      v: 2,
      samples: samples.map((s) => ({ ...s, marks: orderedMarks(s.marks) })),
      manual,
    }),
  };
  // What would make the server refuse the pattern, said by the field it is
  // about and in the reader's language. Only an expression's own syntax is
  // left for the server to judge.
  const problems = {
    sender: !input.sender ? t("mail.editor.errSender") : "",
    subject: subjectMode && !subject.trim() ? t("mail.editor.errSubject") : "",
    direction:
      direction === "capture" && !has("direction")
        ? t(manual ? "mail.editor.errDirGroup" : "mail.editor.errDirMark")
        : "",
    inWords: direction === "capture" && words.length === 0 ? t("mail.editor.errInWords") : "",
    dateFormat:
      has("date") && !(dateFormat.includes("DD") && dateFormat.includes("MM"))
        ? t("mail.editor.errDateFormat")
        : "",
    samples:
      manual || !built.problem
        ? ""
        : built.problem.code === "order"
          ? t("mail.editor.errOrder")
          : t("mail.editor.errNothing", { field: t(`mail.field.${built.problem.field}`) }),
  };
  const ready =
    Object.values(problems).every((p) => !p) && input.accountId > 0 && body.includes("(?P<amount>");

  // Tried as it is written, once typing pauses. Nothing is saved.
  const testBody = { ...input, editor: "" };
  const [debounced] = useDebouncedValue(JSON.stringify(testBody), 400);
  const test = useQuery({
    queryKey: ["mailPatternTest", walletId, mailboxId, debounced],
    queryFn: () => testMailPattern(walletId, mailboxId, JSON.parse(debounced) as MailPatternInput),
    enabled: ready && debounced === JSON.stringify(testBody),
    retry: false,
    placeholderData: (prev) => prev,
  });
  const tried = ready ? test.data : undefined;

  // The mails the last change to the expression made it read, to check.
  const [reads, setReads] = useState<{
    body: string;
    ids: Set<number>;
    before: Set<number> | null;
  }>();
  if (test.data && !test.isPlaceholderData) {
    const tested = (JSON.parse(debounced) as MailPatternInput).body;
    if (reads?.body !== tested) {
      const ids = new Set(test.data.mails.filter((m) => m.matched).map((m) => m.id));
      setReads({ body: tested, ids, before: reads?.ids ?? null });
    }
  }
  const before = reads?.body === body ? reads.before : null;
  const fresh = new Set(
    tried && before
      ? tried.mails.filter((m) => m.matched && !before.has(m.id)).map((m) => m.id)
      : [],
  );
  const sample = tried?.mails.find((m) => m.id === mailId);
  const shown = sample?.matched ? sample : tried?.mails.find((m) => m.transaction);

  // A piece selected in the mail, as offsets in its text.
  const sampleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onSelect = () => {
      const el = sampleRef.current;
      const sel = document.getSelection();
      if (!el || !sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return;
      if (sel.isCollapsed) return;
      const before = document.createRange();
      before.selectNodeContents(el);
      before.setEnd(r.startContainer, r.startOffset);
      let start = before.toString().length;
      let end = start + r.toString().length;
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (end > start) setPick({ start, end });
    };
    document.addEventListener("selectionchange", onSelect);
    return () => document.removeEventListener("selectionchange", onSelect);
  }, [text]);

  const picked = pick ? marks.find((m) => m.start === pick.start && m.end === pick.end) : undefined;
  const assign = (field: Field) => {
    if (!pick) return;
    const piece = text.slice(pick.start, pick.end);
    // One piece per field, and none overlapping another.
    editCurrent((prev) => [
      ...prev.filter((m) => m.field !== field && (m.end <= pick.start || m.start >= pick.end)),
      { field, start: pick.start, end: pick.end },
    ]);
    if (field === "date" && !dateFormat) setDateFormat(guessDateFormat(piece));
    if (field === "card" && cards.length === 0) {
      setCards([{ digits: piece.replace(/\D/g, ""), accountId: Number(accountId ?? 0) }]);
    }
    setManual(false);
    setPick(null);
    document.getSelection()?.removeAllRanges();
  };
  const unmark = () => {
    if (!picked) return;
    editCurrent((prev) => prev.filter((m) => m !== picked));
    setPick(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const p = pattern
        ? await updateMailPattern(walletId, mailboxId, pattern.id, input)
        : await createMailPattern(walletId, mailboxId, input);
      const waiting = tried?.retry ?? 0;
      const applied =
        applyWaiting && waiting > 0 ? await applyMailPattern(walletId, mailboxId, p.id) : null;
      return { p, applied };
    },
    onSuccess: ({ applied }) => {
      notifications.show({
        color: "teal",
        message:
          applied && applied.created > 0
            ? t("mail.editor.savedApplied", { count: applied.created })
            : t("mail.editor.saved"),
      });
      void qc.invalidateQueries({ queryKey: ["mailPatterns", walletId, mailboxId] });
      void qc.invalidateQueries({ queryKey: ["mailMessages", walletId, mailboxId] });
      if (applied) void qc.invalidateQueries({ queryKey: ["register", walletId] });
      onClose();
    },
    onError: notifyError,
  });

  const mailOptions = mails.map((m) => ({
    value: String(m.id),
    label: `${when(m.receivedAt, i18n.language)} · ${m.subject || m.sender}`,
  }));
  if (
    mailId != null &&
    saved?.samples.some((s) => s.mailId === mailId) &&
    !mails.some((m) => m.id === mailId)
  ) {
    mailOptions.unshift({ value: String(mailId), label: t("mail.editor.savedMail") });
  }

  const segments = useMemo(() => {
    const out: { text: string; mark?: Mark; start: number }[] = [];
    let pos = 0;
    for (const m of orderedMarks(marks)) {
      if (m.start > pos) out.push({ text: text.slice(pos, m.start), start: pos });
      out.push({ text: text.slice(m.start, m.end), mark: m, start: m.start });
      pos = m.end;
    }
    if (pos < text.length) out.push({ text: text.slice(pos), start: pos });
    return out;
  }, [text, marks]);

  const account = accountById.get(shown?.transaction?.accountId ?? input.accountId);
  const money = account
    ? {
        fracDigits: account.currencyFracDigits,
        decimalChar: account.currencyDecimalChar,
        groupChar: account.currencyGroupChar,
        symbol: account.currencySymbol,
        symbolPrefix: account.currencySymbolPrefix,
      }
    : null;

  return (
    <SideSheet
      opened
      onClose={onClose}
      title={pattern ? t("mail.editor.editTitle") : t("mail.editor.newTitle")}
      testId="pattern-sheet"
      headerActions={<TourButton id="patternEditor" size={28} round />}
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ready}>
            {t("mail.editor.save")}
          </Button>
        </>
      }
    >
      {offer && (
        <TourOffer
          inline
          id="patternEditor"
          steps={TOURS.patternEditor.length}
          onAccept={() => {
            setOffer(false);
            start("patternEditor");
          }}
          onDecline={() => setOffer(false)}
        />
      )}
      {samples.length === 1 ? (
        <Select
          label={t("mail.editor.sample")}
          data={mailOptions}
          value={mailId != null ? String(mailId) : null}
          onChange={(v) => v && Number(v) !== mailId && loadMail(Number(v), false)}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
          data-cb-sensitive
        />
      ) : (
        <Stack gap={6}>
          <Text size="sm" fw={500} id="pattern-samples">
            {t("mail.editor.samples")}
          </Text>
          <Group gap={6} wrap="nowrap">
            <SegmentedControl
              size="xs"
              aria-labelledby="pattern-samples"
              value={String(samples.indexOf(current))}
              onChange={(v) => {
                setCur(Number(v));
                setPick(null);
              }}
              data={samples.map((s, i) => ({ value: String(i), label: sampleLabel(s, i) }))}
              style={{ flex: 1, minWidth: 0 }}
              data-testid="pattern-samples"
              data-cb-sensitive
            />
            <CloseButton
              size="sm"
              aria-label={t("mail.editor.removeSample")}
              onClick={() => {
                setSamples(samples.filter((s) => s !== current));
                setCur(0);
                setPick(null);
              }}
            />
          </Group>
          <Text size="xs" c="dimmed">
            {t("mail.editor.samplesHint")}
          </Text>
        </Stack>
      )}

      <Stack gap={6}>
        <Text size="sm" fw={500}>
          {t("mail.editor.pick")}
        </Text>
        {(loading || first.isFetching) && !text ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : (
          <Paper
            withBorder
            p="sm"
            radius="md"
            ref={sampleRef}
            data-testid="pattern-sample"
            data-tour="pattern-sample"
            data-cb-sensitive
            style={{
              lineHeight: 1.9,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontSize: "var(--mantine-font-size-sm)",
              maxHeight: 280,
              overflowY: "auto",
              opacity: manual ? 0.6 : 1,
            }}
          >
            {segments.map((s) =>
              s.mark ? (
                <Box
                  key={s.start}
                  component="span"
                  role="button"
                  tabIndex={0}
                  aria-label={`${t(`mail.field.${s.mark.field}`)}: ${s.text}`}
                  onClick={() => setPick({ start: s.mark!.start, end: s.mark!.end })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPick({ start: s.mark!.start, end: s.mark!.end });
                    }
                  }}
                  px={3}
                  py={1}
                  style={{
                    background: `var(--mantine-color-${FIELD_COLOR[s.mark.field]}-light)`,
                    color: `var(--mantine-color-${FIELD_COLOR[s.mark.field]}-light-color)`,
                    borderRadius: 4,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {s.text}
                </Box>
              ) : (
                <span key={s.start}>{s.text}</span>
              ),
            )}
          </Paper>
        )}
        {pick && !manual ? (
          <Paper
            withBorder
            shadow="sm"
            p={6}
            radius="md"
            data-testid="pattern-pick"
            data-tour="pattern-pick"
          >
            <Group gap={4} wrap="wrap">
              <Text size="xs" c="dimmed" px={4} truncate maw="100%" data-cb-sensitive>
                {t("mail.editor.is", { text: text.slice(pick.start, pick.end) })}
              </Text>
              {FIELDS.filter((f) => f !== "direction" || direction === "capture").map((f) => (
                <Button
                  key={f}
                  size="compact-sm"
                  variant={picked?.field === f ? "light" : "subtle"}
                  color={FIELD_COLOR[f]}
                  // Keep the text selected while the button is pressed.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => assign(f)}
                >
                  {t(`mail.field.${f}`)}
                </Button>
              ))}
              {picked && (
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="gray"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={unmark}
                >
                  {t("mail.editor.remove")}
                </Button>
              )}
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label={t("common.close")}
                onClick={() => setPick(null)}
                ml="auto"
              >
                <IconX size={14} />
              </ActionIcon>
            </Group>
          </Paper>
        ) : (
          !manual && (
            <Text size="xs" c="dimmed" data-tour="pattern-pick">
              {t("mail.editor.pickHint")}
            </Text>
          )
        )}
      </Stack>

      {!manual && (
        <Stack gap={6} data-tour="pattern-fields">
          <Text size="sm" fw={500}>
            {t("mail.editor.fields")}
          </Text>
          {lead.marks.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("mail.editor.noFields")}
            </Text>
          ) : (
            orderedMarks(lead.marks).map((m) => (
              <Group key={m.field} gap="xs" wrap="nowrap">
                <Badge
                  color={FIELD_COLOR[m.field]}
                  variant="light"
                  w={120}
                  style={{ flexShrink: 0 }}
                >
                  {t(`mail.field.${m.field}`)}
                </Badge>
                <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }} data-cb-sensitive>
                  {samples
                    .flatMap((s) => {
                      const x = s.marks.find((y) => y.field === m.field);
                      return x ? [s.text.slice(x.start, x.end)] : [];
                    })
                    .join(" · ")}
                </Text>
              </Group>
            ))
          )}
          {lead.marks.length > 0 && !has("amount") && (
            <Text size="xs" c="red">
              {t("mail.editor.needAmount")}
            </Text>
          )}
          {unlike && leadFields.length > 0 && (
            <Text size="xs" c="dimmed" data-testid="pattern-same-fields">
              {t("mail.editor.sameFields", {
                fields: leadFields.map((f) => t(`mail.field.${f}`)).join(", "),
              })}
            </Text>
          )}
          {problems.samples && (
            <Text size="xs" c="red" data-testid="pattern-merge-problem">
              {problems.samples}
            </Text>
          )}
        </Stack>
      )}

      <Stack gap="xs" data-tour="pattern-when">
        <Text size="sm" fw={500}>
          {t("mail.editor.when")}
        </Text>
        <TextInput
          label={t("mail.editor.sender")}
          value={sender}
          onChange={(e) => setSender(e.currentTarget.value)}
          error={problems.sender || undefined}
          data-cb-sensitive
        />
        <Select
          label={t("mail.editor.subjectMode")}
          data={[
            { value: "", label: t("mail.editor.subjectAny") },
            { value: "contains", label: t("mail.editor.subjectContains") },
            { value: "regex", label: t("mail.editor.subjectRegex") },
          ]}
          value={subjectMode}
          onChange={(v) => setSubjectMode((v ?? "") as MailPatternInput["subjectMode"])}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
        {subjectMode && (
          <TextInput
            aria-label={t("mail.editor.subjectText")}
            placeholder={t("mail.editor.subjectText")}
            value={subject}
            onChange={(e) => setSubject(e.currentTarget.value)}
            error={problems.subject || undefined}
            ff={subjectMode === "regex" ? "monospace" : undefined}
          />
        )}
      </Stack>

      <Select
        wrapperProps={{ "data-tour": "pattern-account" }}
        label={t("mail.editor.account")}
        description={t("mail.editor.accountHint")}
        withAsterisk
        data={accountData}
        value={accountId}
        onChange={setAccountId}
        searchable
        comboboxProps={{ withinPortal: true }}
      />

      {has("card") && (
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            {t("mail.editor.cards")}
          </Text>
          <Text size="xs" c="dimmed">
            {t("mail.editor.cardsHint")}
          </Text>
          {cards.map((c, i) => (
            <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
              <TextInput
                aria-label={t("mail.editor.cardDigits")}
                placeholder={t("mail.editor.cardDigits")}
                value={c.digits}
                w={110}
                onChange={(e) => {
                  const digits = e.currentTarget.value;
                  setCards((prev) => prev.map((x, j) => (j === i ? { ...x, digits } : x)));
                }}
                data-cb-sensitive
              />
              <Select
                aria-label={t("mail.editor.account")}
                data={accountData}
                value={c.accountId ? String(c.accountId) : null}
                onChange={(v) =>
                  setCards((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, accountId: Number(v ?? 0) } : x)),
                  )
                }
                style={{ flex: 1, minWidth: 0 }}
                comboboxProps={{ withinPortal: true }}
              />
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={t("mail.editor.removeCard")}
                onClick={() => setCards((prev) => prev.filter((_, j) => j !== i))}
                mb={4}
              >
                <IconX size={16} />
              </ActionIcon>
            </Group>
          ))}
          <Button
            size="compact-sm"
            variant="subtle"
            leftSection={<IconPlus size={14} />}
            onClick={() => setCards((prev) => [...prev, { digits: "", accountId: 0 }])}
            style={{ alignSelf: "flex-start" }}
          >
            {t("mail.editor.addCard")}
          </Button>
        </Stack>
      )}

      <SimpleGrid cols={2} spacing="sm">
        <Select
          label={t("mail.editor.direction")}
          data={[
            { value: "out", label: t("mail.editor.out") },
            { value: "in", label: t("mail.editor.in") },
            { value: "capture", label: t("mail.editor.fromMail") },
          ]}
          value={direction}
          onChange={chooseDirection}
          allowDeselect={false}
          error={problems.direction || undefined}
          comboboxProps={{ withinPortal: true }}
        />
        <Select
          label={t("mail.editor.paymentMode")}
          data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
          value={paymentMode}
          onChange={(v) => setPaymentMode(v ?? "0")}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
      </SimpleGrid>
      {direction === "capture" && (
        <TextInput
          label={t("mail.editor.inWords")}
          description={t("mail.editor.fromMailHint")}
          value={inWords}
          onChange={(e) => setInWords(e.currentTarget.value)}
          placeholder={t("mail.editor.inWordsPlaceholder")}
          error={problems.inWords || undefined}
          data-cb-sensitive
        />
      )}

      {has("date") ? (
        <TextInput
          label={t("mail.editor.dateFormat")}
          description={t("mail.editor.dateFormatHint")}
          value={dateFormat}
          onChange={(e) => setDateFormat(e.currentTarget.value.toUpperCase())}
          error={problems.dateFormat || undefined}
          ff="monospace"
          w={200}
        />
      ) : (
        <TextInput label={t("mail.editor.date")} value={t("mail.editor.dateFromMail")} readOnly />
      )}

      <Switch
        label={t("mail.editor.applyRules")}
        checked={applyRules}
        onChange={(e) => setApplyRules(e.currentTarget.checked)}
      />

      {!ready && (
        // Where the test will be, so the tour has something to point at.
        <Text size="xs" c="dimmed" data-tour="pattern-test">
          {t(
            !input.accountId && body.includes("(?P<amount>")
              ? "mail.editor.needAccount"
              : "mail.editor.testHint",
          )}
        </Text>
      )}
      {ready && (
        // Announced as it changes: the result arrives while the reader is
        // still selecting or typing.
        <div role="status" aria-atomic="true" data-tour="pattern-test">
          <TestResult
            pending={test.isFetching && !tried}
            error={test.error}
            matched={tried?.matched}
            total={tried?.total}
          />
        </div>
      )}
      {tried && !test.error && (
        <PatternTestMails
          walletId={walletId}
          mailboxId={mailboxId}
          tried={tried}
          steps={manual ? null : built.steps}
          fresh={fresh}
          examples={samples.map((s) => s.mailId)}
          adding={loading}
          onAdd={(id) => loadMail(id, true)}
          amount={(tx) => {
            const a = accountById.get(tx.accountId);
            return a
              ? formatMinor(tx.amount, {
                  fracDigits: a.currencyFracDigits,
                  decimalChar: a.currencyDecimalChar,
                  groupChar: a.currencyGroupChar,
                  symbol: a.currencySymbol,
                  symbolPrefix: a.currencySymbolPrefix,
                })
              : "";
          }}
          when={(iso) => when(iso, i18n.language)}
        />
      )}
      {sample && !sample.authenticated && requireAuth && (
        <Text size="xs" c="orange">
          {t("mail.editor.unauthenticated")}
        </Text>
      )}
      {shown?.error && (
        <Text size="sm" c="red">
          {shown.error}
        </Text>
      )}
      {shown?.transaction && money && (
        <Paper
          withBorder
          p="sm"
          radius="md"
          bg="var(--mantine-color-default-hover)"
          data-testid="pattern-preview"
        >
          <Text size="xs" c="dimmed" mb={4}>
            {t("mail.editor.becomes")}
          </Text>
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={500} truncate data-cb-sensitive>
                {shown.transaction.payee || shown.transaction.memo || "—"}
              </Text>
              {shown.transaction.payee && shown.transaction.memo && (
                <Text size="sm" truncate data-cb-sensitive>
                  {shown.transaction.memo}
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {[
                  fmtDate(shown.transaction.date),
                  account?.name,
                  shown.transaction.paymentMode
                    ? t(`paymentModes.${shown.transaction.paymentMode}`)
                    : null,
                  shown.transaction.category || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </div>
            <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
              <Text
                size="sm"
                fw={600}
                ff="monospace"
                c={shown.transaction.amount < 0 ? "red" : "teal"}
                data-cb-sensitive
              >
                {formatMinor(shown.transaction.amount, money)}
              </Text>
              <Badge size="xs" variant="light" color="teal">
                {t("status.1")}
              </Badge>
            </Stack>
          </Group>
        </Paper>
      )}

      <Anchor
        size="sm"
        component="button"
        type="button"
        onClick={() => setAdvanced((a) => !a)}
        style={{ alignSelf: "flex-start" }}
        data-tour="pattern-advanced"
      >
        {advanced ? t("mail.editor.hideAdvanced") : t("mail.editor.advanced")}
      </Anchor>
      <Collapse expanded={advanced}>
        <Stack gap="sm">
          <TextInput
            label={t("mail.editor.name")}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Textarea
            label={t("mail.editor.expression")}
            description={t("mail.editor.expressionHint")}
            autosize
            minRows={2}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            value={body}
            onChange={(e) => {
              setExpr(e.currentTarget.value);
              setManual(true);
            }}
            data-testid="pattern-expression"
          />
          {manual && !!text && (
            <Alert color="yellow" variant="light" p="xs">
              <Group gap="xs" justify="space-between" wrap="wrap">
                <Text size="sm">{t("mail.editor.manual")}</Text>
                <Button size="compact-xs" variant="light" onClick={() => setManual(false)}>
                  {t("mail.editor.backToPicks")}
                </Button>
              </Group>
            </Alert>
          )}
          <Switch
            label={t("mail.editor.requireAuth")}
            description={t("mail.editor.requireAuthHint")}
            checked={requireAuth}
            onChange={(e) => setRequireAuth(e.currentTarget.checked)}
          />
        </Stack>
      </Collapse>

      {(tried?.retry ?? 0) > 0 && (
        <Checkbox
          label={t("mail.editor.applyWaiting", { count: tried?.retry ?? 0 })}
          checked={applyWaiting}
          onChange={(e) => setApplyWaiting(e.currentTarget.checked)}
        />
      )}
    </SideSheet>
  );
}

function TestResult({
  pending,
  error,
  matched,
  total,
}: {
  pending: boolean;
  error: unknown;
  matched?: number;
  total?: number;
}) {
  const { t } = useTranslation();
  const expression =
    error instanceof ApiError &&
    (error.code === "invalid_expression" || error.code === "invalid_subject_expression");
  if (expression) {
    // RE2's reason, under a heading in the reader's language.
    return (
      <Alert
        color="red"
        variant="light"
        p="xs"
        title={t(
          error.code === "invalid_subject_expression"
            ? "mail.editor.invalidSubject"
            : "mail.editor.invalid",
        )}
        data-testid="pattern-invalid"
      >
        <Text size="sm" style={{ overflowWrap: "anywhere" }}>
          {error.message}
        </Text>
      </Alert>
    );
  }
  if (error) {
    return (
      <Alert color="red" variant="light" p="xs">
        <Text size="sm">
          <ErrorMessage error={error} />
        </Text>
      </Alert>
    );
  }
  if (pending || matched == null) {
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          {t("mail.editor.testing")}
        </Text>
      </Group>
    );
  }
  return (
    <Alert
      color={matched > 0 ? "teal" : "yellow"}
      variant="light"
      p="xs"
      icon={<IconWand size={16} />}
      data-testid="pattern-test"
    >
      <Text size="sm">{t("mail.editor.tested", { matched, total })}</Text>
    </Alert>
  );
}

/** An example mail's name: what its first text field reads, else its number. */
function sampleLabel(s: Sample, i: number): string {
  const m = orderedMarks(s.marks).find((x) => x.field !== "amount");
  return m ? `${i + 1} · ${s.text.slice(m.start, m.end)}` : String(i + 1);
}

/** A mail's arrival, short, for the list of mails to start from. */
function when(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
