import {
  ActionIcon,
  Alert,
  Button,
  Collapse,
  Drawer,
  Group,
  Input,
  Menu,
  NumberFormatter,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAdjustments,
  IconChevronDown,
  IconDeviceFloppy,
  IconDots,
  IconSparkles,
  IconSquare,
  IconSquareCheck,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { errorColor } from "../amountTone";
import { useAuth } from "../auth/AuthProvider";
import { useConfirm } from "./confirmContext";
import {
  type EntryField,
  type Placement,
  lastEntryDate,
  packRows,
  placements,
  rememberEntryDate,
} from "./entryFields";
import { StatusPicker } from "./StatusPicker";

import {
  ApiError,
  type Account,
  type Split,
  type Template,
  type Transaction,
  type TransactionInput,
  createTemplate,
  createTransaction,
  findDuplicateTransactions,
  getAISettings,
  listAccounts,
  listCategories,
  listPayees,
  listTags,
  listVehicles,
  parseEntry,
  suggestAssignment,
  suggestCategory,
  updateTransaction,
} from "../api/client";
import { minorToInput } from "../money";
import { PAYMENT_MODES } from "../transactionEnums";
import { useAmountParser } from "../useAmountParser";
import { AttachmentsField } from "./AttachmentsField";
import { ENTRY_SHEET } from "./entrySheetTheme";
import { todayCivil } from "../civilDate";

// How a save resolves: close the sheet, or stay open for another entry — with
// the fields cleared, or kept when "keep the fields" is ticked. Editing always
// closes.
type SaveMode = "close" | "new";

export function TransactionForm({
  opened,
  onClose,
  walletId,
  account,
  editing,
  duplicate,
  onSaved,
  templates,
  onTemplateSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  account: Account;
  editing: Transaction | null;
  /** Pre-fill a NEW transaction from this row (create, not update). */
  duplicate?: Transaction | null;
  /** Called with the id of the row that was saved, so it can be marked. */
  onSaved: (savedId?: number) => void;
  templates: Template[];
  onTemplateSaved: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const parseAmount = useAmountParser();
  const { user } = useAuth();
  // Which fields sit in the base and which under More details, and what a new
  // entry starts from: the reader's own choices, from Settings.
  const place = placements(user?.preferences?.entryFields);
  const entryDefaults = user?.preferences?.entryDefaults;
  const startDate = () => (entryDefaults?.date === "last" ? lastEntryDate() : null) ?? todayCivil();
  const startStatus = entryDefaults?.status ?? 0;
  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
  });
  const tagsQuery = useQuery({ queryKey: ["tags", walletId], queryFn: () => listTags(walletId) });
  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", walletId],
    queryFn: () => listVehicles(walletId),
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
  });
  const [accountId, setAccountId] = useState(String(account.id));
  // The account the entry lands in, and whose currency its amount is written
  // in. Closed accounts are not offered, except the one the sheet opened on.
  const accounts = accountsQuery.data ?? [account];
  const current = accounts.find((a) => String(a.id) === accountId) ?? account;
  const accountOptions = accounts
    .filter((a) => !a.closed || a.id === account.id)
    .map((a) => ({ value: String(a.id), label: a.name }));
  const phone = useMediaQuery("(max-width: 47.99em)");
  // The sheet's own messages go where the sheet is not: the default corner,
  // bottom right, is its foot, and a toast there sits on the very buttons the
  // next entry needs — and stays, for as long as the pointer rests on it.
  const toastAt = phone ? "top-center" : "bottom-left";

  const dc = current.currencyDecimalChar;
  const fd = current.currencyFracDigits;

  const [date, setDate] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("0");
  const [status, setStatus] = useState("0");
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [info, setInfo] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSplit, setIsSplit] = useState(false);
  const [splits, setSplits] = useState<{ categoryId: string | null; amount: string }[]>([]);
  // "Save and add another" keeps every field instead of clearing them. Off each
  // time the sheet opens: it is for a run of similar entries, not a setting.
  const [keepFields, setKeepFields] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Opt-in AI category suggestion, shown only when the user has enabled and
  // keyed a provider. It fills the category from the current payee/memo/amount.
  const aiSettings = useQuery({
    queryKey: ["aiSettings"],
    queryFn: getAISettings,
    staleTime: 60_000,
    // The demo build has no AI to ask.
    enabled: !__DEMO__,
  });
  const aiEnabled = !!(aiSettings.data?.enabled && aiSettings.data?.hasKey);
  const payeeName = useMemo(
    () => payeesQuery.data?.find((p) => String(p.id) === payeeId)?.name ?? "",
    [payeesQuery.data, payeeId],
  );
  const suggest = useMutation({
    mutationFn: () => suggestCategory(walletId, { payee: payeeName, memo, amount }),
    onSuccess: (res) => {
      if (res.category) setCategoryId(String(res.category.id));
      else
        notifications.show({
          position: toastAt,
          color: "gray",
          message: t("ai.noSuggestion"),
        });
    },
    onError: (err: unknown) =>
      notifications.show({
        position: toastAt,
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  // Natural-language quick entry: describe a transaction and let the model fill
  // the fields. Only unmatched names are left blank — never invented.
  const [quickText, setQuickText] = useState("");
  const parse = useMutation({
    mutationFn: () => parseEntry(walletId, quickText.trim()),
    onSuccess: (res) => {
      const e = res.entry;
      if (!e) {
        notifications.show({
          position: toastAt,
          color: "gray",
          message: t("ai.noParse"),
        });
        return;
      }
      if (e.amount) setAmount(e.amount);
      setDirection(e.direction);
      if (e.date) setDate(e.date);
      if (e.memo) setMemo(e.memo);
      if (e.categoryId != null) setCategoryId(String(e.categoryId));
      if (e.payeeId != null) setPayeeId(String(e.payeeId));
      if (e.tags && e.tags.length > 0) setTags(e.tags);
      setQuickText("");
    },
    onError: (err: unknown) =>
      notifications.show({
        position: toastAt,
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  // Save-mode support: modeRef carries the clicked button's intent into the
  // (async) mutation success; savingMode drives which button shows loading;
  // amountRef refocuses the amount for the next entry; savedMsg is announced.
  const modeRef = useRef<SaveMode>("close");
  const [savingMode, setSavingMode] = useState<SaveMode | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [savedMsg, setSavedMsg] = useState("");
  // Snapshot of the form as opened, to detect unsaved edits (dirty) for the
  // discard guard on Cancel / ✕ / Escape. State, not a ref: `dirty` is read
  // during render, and a ref read there is a value React does not promise is
  // the one this render was given.
  const [baseline, setBaseline] = useState("");
  const snapshot = () =>
    JSON.stringify({
      date,
      direction,
      amount,
      paymentMode,
      status,
      payeeId,
      categoryId,
      vehicleId,
      memo,
      info,
      tags,
      isSplit,
      splits,
    });
  const pulse = () => {
    document
      .querySelector<HTMLElement>(".txnFormContent")
      ?.animate(
        [
          { boxShadow: "0 8px 30px rgba(0,0,0,.3), 0 0 0 0 rgba(18,184,134,.7)" },
          { boxShadow: "0 8px 30px rgba(0,0,0,.3), 0 0 0 12px rgba(18,184,134,0)" },
        ],
        { duration: 750, easing: "ease-out" },
      );
  };

  const applyValues = (v: EntryValues) => {
    setDate(v.date);
    setDirection(v.direction);
    setAmount(v.amount);
    setPaymentMode(v.paymentMode);
    setStatus(v.status);
    setPayeeId(v.payeeId);
    setCategoryId(v.categoryId);
    setVehicleId(v.vehicleId);
    setMemo(v.memo);
    setInfo(v.info);
    setTags(v.tags);
    setIsSplit(v.isSplit);
    setSplits(v.splits);
  };

  // Seed the fields when the drawer opens, during render rather than in an
  // effect: an effect runs after the drawer is already on screen, so the reader
  // gets one frame of whatever the form held last time.
  //
  // The key is null while closed, which is what makes reopening the same row
  // re-seed it — and it deliberately does NOT clear the fields on the way out,
  // because the drawer is still animating closed and emptying it is visible.
  const openingKey = opened ? `${editing?.id ?? "new"}:${duplicate?.id ?? ""}` : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (openingKey !== seededFor) {
    setSeededFor(openingKey);
    if (openingKey !== null) {
      const init = initialValues(editing, duplicate, account, fd, dc, startDate(), startStatus);
      applyValues(init);
      setBaseline(JSON.stringify(init));
      setAccountId(String(account.id));
      setKeepFields(false);
      setMoreOpen(
        hasDetails(init, place, account.defaultPaymentMode) || (editing?.attachmentCount ?? 0) > 0,
      );
    }
  }

  const sign = direction === "expense" ? -1 : 1;
  const totalMinor = (parseAmount(amount, fd, dc) ?? 0) * sign;
  const splitSumMinor = splits.reduce(
    (sum, s) => sum + (parseAmount(s.amount, fd, dc) ?? 0) * sign,
    0,
  );
  const splitMismatch = isSplit && splits.length > 0 && splitSumMinor !== totalMinor;

  // Duplicate warning.
  const dupQuery = useQuery({
    queryKey: ["dup", walletId, current.id, date, totalMinor],
    queryFn: () => findDuplicateTransactions(walletId, current.id, date, totalMinor),
    enabled: opened && !editing && !!date && totalMinor !== 0,
  });
  const duplicates = (dupQuery.data ?? []).filter((d) => d.id !== editing?.id);

  const save = useMutation({
    mutationFn: () => {
      const body: TransactionInput = {
        accountId: current.id,
        date,
        amount: totalMinor,
        paymentMode: Number(paymentMode),
        status: Number(status),
        info,
        memo,
        payeeId: payeeId ? Number(payeeId) : null,
        categoryId: isSplit ? null : categoryId ? Number(categoryId) : null,
        vehicleId: vehicleId ? Number(vehicleId) : null,
        tags,
        splits: isSplit
          ? splits.map<Split>((s) => ({
              categoryId: s.categoryId ? Number(s.categoryId) : null,
              amount: (parseAmount(s.amount, fd, dc) ?? 0) * sign,
            }))
          : [],
      };
      return editing
        ? updateTransaction(walletId, editing.id, body)
        : createTransaction(walletId, body);
    },
    onSuccess: (saved) => {
      onSaved(saved?.id);
      if (!editing) rememberEntryDate(date);
      // A row saved to another account does not appear in this register, so
      // say where it went rather than let it look lost.
      if (current.id !== account.id) {
        notifications.show({
          position: toastAt,
          color: "green",
          message: t("transactions.savedTo", { account: current.name }),
        });
      }
      const mode = modeRef.current;
      if (mode === "close") {
        onClose();
        return;
      }
      // Stay open for another entry: clear the fields (keeping the date), or keep
      // them all when asked to. Flash the border, toast, announce, refocus — so
      // the save clearly registered even though the sheet stayed put.
      // Either way the form now starts from what was just saved, so closing it
      // straight away asks nothing: there is nothing unsaved to lose.
      if (!keepFields) resetFields(date);
      else setBaseline(snapshot());
      pulse();
      notifications.show({
        position: toastAt,
        color: "green",
        message: t("transactions.saved"),
        autoClose: 1400,
      });
      setSavedMsg(t(keepFields ? "transactions.savedKeepOpen" : "transactions.savedNew"));
      amountRef.current?.focus();
      amountRef.current?.select();
    },
    onError: (err: unknown) =>
      notifications.show({
        position: toastAt,
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  // Reset the form to the blank new-transaction defaults (used by "Save and add
  // another"), keeping the date, and rebase the dirty snapshot so the
  // just-cleared form isn't flagged as edited.
  const resetFields = (keepDate: string) => {
    const init = initialValues(null, null, current, fd, dc, keepDate, startStatus);
    applyValues(init);
    setBaseline(JSON.stringify(init));
  };

  // Save, resolving the modal per mode (close / keep fields / clear fields).
  const submit = (mode: SaveMode) => {
    modeRef.current = mode;
    setSavingMode(mode);
    save.mutate();
  };

  // True once the form differs from how it opened — drives the discard
  // confirmation on ✕ and Escape.
  const dirty = opened && snapshot() !== baseline;
  const canSave = !!date && totalMinor !== 0 && !splitMismatch && !save.isPending;

  // The amount's sign is a switch, but a + or − typed in front of the figure
  // flips it as well, so the keyboard never has to leave the field.
  const onAmount = (value: string) => {
    const lead = value.trimStart()[0];
    if (lead === "+" || lead === "-" || lead === "\u2212") {
      setDirection(lead === "+" ? "income" : "expense");
      value = value.trimStart().slice(1);
    }
    setAmount(value);
  };

  // Whether the sheet may close: at once when nothing is unsaved, otherwise
  // only once the reader agrees to lose it.
  const mayDiscard = async () =>
    !dirty ||
    (await confirm({
      title: t("transactions.confirmDiscardTitle"),
      body: t("transactions.confirmDiscardBody"),
      confirmLabel: t("transactions.confirmDiscardAction"),
      cancelLabel: t("transactions.confirmDiscardKeep"),
      danger: true,
    }));

  // Close, warning first if there are unsaved edits (✕ / Escape).
  const requestClose = async () => {
    if (await mayDiscard()) onClose();
  };

  // Apply a template into the form (user reviews, then saves).
  const applyTemplate = (id: string | null) => {
    const tpl = templates.find((x) => String(x.id) === id);
    if (!tpl) return;
    // A template has no date or vehicle: those stay as they are.
    const next: EntryValues = {
      date,
      direction: tpl.amount < 0 ? "expense" : "income",
      amount: tpl.amount !== 0 ? minorToInput(Math.abs(tpl.amount), fd, dc) : "",
      paymentMode: String(tpl.paymentMode),
      status: String(tpl.status),
      payeeId: tpl.payeeId ? String(tpl.payeeId) : null,
      categoryId: tpl.categoryId ? String(tpl.categoryId) : null,
      vehicleId,
      memo: tpl.memo,
      info: tpl.info,
      tags: tpl.tags,
      isSplit: tpl.isSplit,
      splits:
        tpl.splits?.map((s) => ({
          categoryId: s.categoryId ? String(s.categoryId) : null,
          amount: minorToInput(Math.abs(s.amount), fd, dc),
        })) ?? [],
    };
    applyValues(next);
    if (hasDetails(next, place, current.defaultPaymentMode)) setMoreOpen(true);
  };

  // Settings is a page of its own, so going there closes the sheet — asking
  // first, as closing it any other way would.
  const customise = async () => {
    if (!(await mayDiscard())) return;
    onClose();
    navigate("/settings/general#entry-fields");
  };

  const saveTemplate = useMutation({
    mutationFn: (name: string) =>
      createTemplate(walletId, {
        name,
        accountId: current.id,
        amount: totalMinor,
        paymentMode: Number(paymentMode),
        status: Number(status),
        info,
        memo,
        payeeId: payeeId ? Number(payeeId) : null,
        categoryId: isSplit ? null : categoryId ? Number(categoryId) : null,
        tags,
        splits: isSplit
          ? splits.map<Split>((s) => ({
              categoryId: s.categoryId ? Number(s.categoryId) : null,
              amount: (parseAmount(s.amount, fd, dc) ?? 0) * sign,
            }))
          : [],
      }),
    onSuccess: () => {
      onTemplateSaved();
      notifications.show({
        position: toastAt,
        color: "green",
        message: t("templates.saved"),
      });
    },
    onError: (err: unknown) =>
      notifications.show({
        position: toastAt,
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const payeeOptions = (payeesQuery.data ?? []).map((p) => ({
    value: String(p.id),
    label: p.name,
  }));
  const categoryOptions = useMemo(
    () =>
      (categoriesQuery.data ?? []).map((c) => ({
        value: String(c.id),
        label: c.parentId
          ? `   ${(categoriesQuery.data ?? []).find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}`
          : c.name,
      })),
    [categoriesQuery.data],
  );
  const vehicleOptions = (vehiclesQuery.data ?? []).map((v) => ({
    value: String(v.id),
    label: v.name,
  }));

  // Apply-on-manual: when adding a transaction, the first matching rule fills
  // any empty payee/category/payment-mode fields (the user can still override).
  const runSuggest = async () => {
    if (editing) return;
    const name = (payeesQuery.data ?? []).find((p) => String(p.id) === payeeId)?.name ?? "";
    if (!memo.trim() && !name) return;
    try {
      const res = await suggestAssignment(walletId, memo, name, current.id);
      if (!res.matched) return;
      if (!payeeId && res.payeeId != null) setPayeeId(String(res.payeeId));
      if (!isSplit && !categoryId && res.categoryId != null) setCategoryId(String(res.categoryId));
      if (paymentMode === "0" && res.paymentMode != null) setPaymentMode(String(res.paymentMode));
      if (!info && res.info != null) setInfo(res.info);
    } catch {
      // suggestion is best-effort; ignore failures
    }
  };

  // Enter saves and closes; Shift+Enter saves and starts another — each
  // button wears its key. From any plain field, but not from one whose own
  // Enter means something: an open dropdown picking its option, the tags field
  // adding a tag, the quick-entry line sending its text. Editing has no
  // "another", so there Shift+Enter does nothing.
  const onEnter = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target as HTMLElement;
    if (el.tagName !== "INPUT" || (el as HTMLInputElement).type === "file") return;
    if (el.getAttribute("aria-expanded") === "true") return;
    if (el.closest(".mantine-TagsInput-root")) return;
    e.preventDefault();
    if (!canSave) return;
    if (!e.shiftKey) submit("close");
    else if (!editing) submit("new");
  };

  const signLabel = t(
    direction === "expense" ? "transactions.signExpense" : "transactions.signIncome",
  );

  // Every movable field, drawn wherever the reader's layout puts it. The
  // vehicle is null in a wallet without vehicles, and then not drawn at all.
  const fieldEl: Record<EntryField, ReactNode> = {
    date: (
      <TextInput
        type="date"
        label={t("transactions.date")}
        value={date}
        onChange={(e) => setDate(e.currentTarget.value)}
      />
    ),
    // The account an entry lands in. It starts on the register the sheet was
    // opened from; an existing row keeps its own — moving a transaction between
    // accounts is not what editing it means.
    account: (
      <Select
        label={t("transactions.account")}
        data={accountOptions}
        value={accountId}
        onChange={(v) => v && setAccountId(v)}
        allowDeselect={false}
        disabled={!!editing}
      />
    ),
    memo: (
      <TextInput
        label={t("transactions.memo")}
        value={memo}
        onChange={(e) => setMemo(e.currentTarget.value)}
        onBlur={() => void runSuggest()}
      />
    ),
    paymentMode: (
      <Select
        label={t("transactions.paymentMode")}
        data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
        value={paymentMode}
        onChange={(v) => v && setPaymentMode(v)}
        allowDeselect={false}
      />
    ),
    category: (
      <div>
        <Select
          label={t("transactions.category")}
          data={categoryOptions}
          value={isSplit ? null : categoryId}
          onChange={setCategoryId}
          placeholder={isSplit ? t("transactions.split") : undefined}
          disabled={isSplit}
          clearable
          searchable
        />
        {aiEnabled && !isSplit && (
          <Button
            variant="subtle"
            size="compact-xs"
            mt={4}
            leftSection={<IconSparkles size={14} />}
            loading={suggest.isPending}
            disabled={!payeeName && !memo}
            onClick={() => suggest.mutate()}
          >
            {t("ai.suggestCategory")}
          </Button>
        )}
      </div>
    ),
    status: (
      <Input.Wrapper label={t("transactions.status")} labelElement="div">
        <StatusPicker value={status} onChange={setStatus} />
      </Input.Wrapper>
    ),
    payee: (
      <Select
        label={t("transactions.payee")}
        data={payeeOptions}
        value={payeeId}
        onChange={setPayeeId}
        clearable
        searchable
      />
    ),
    info: (
      <TextInput
        label={t("transactions.info")}
        value={info}
        onChange={(e) => setInfo(e.currentTarget.value)}
      />
    ),
    vehicle:
      vehicleOptions.length > 0 ? (
        <Select
          label={t("transactions.vehicle")}
          data={vehicleOptions}
          value={vehicleId}
          onChange={setVehicleId}
          clearable
          searchable
        />
      ) : null,
    tags: (
      <TagsInput
        label={t("transactions.tags")}
        data={tagsQuery.data ?? []}
        value={tags}
        onChange={setTags}
      />
    ),
  };
  const fieldRows = (p: Placement) =>
    packRows(
      (Object.keys(fieldEl) as EntryField[]).filter((id) => place[id] === p && fieldEl[id]),
    ).map((row) =>
      row.length === 1 ? (
        <Fragment key={row[0]}>{fieldEl[row[0]]}</Fragment>
      ) : (
        <Group key={row.join()} grow gap={ENTRY_SHEET.pairGap} align="flex-start" wrap="nowrap">
          {row.map((id) => (
            <Fragment key={id}>{fieldEl[id]}</Fragment>
          ))}
        </Group>
      ),
    );

  return (
    // A sheet rather than a modal: entering a transaction is work you do beside
    // the ledger, not instead of it. The rows and the running balance stay
    // visible while you type — the overlay is the board's 4% wash, not a
    // blackout — and "save and add another" does not blank the page between
    // entries. Modals are kept for decisions you cannot undo. On a phone the
    // same sheet comes up from the bottom, as the board's note says, with no
    // other change.
    //
    // Built to the Entering and deciding board (#469): 396px, the amount first
    // and large, the fields below it, and a foot with two actions. Which fields
    // sit in the base and which under "More details" is the reader's choice; by
    // default the base is what a transaction needs (Date · Account, Memo,
    // Payment · Category, Status), which is where it departs from the board.
    <Drawer.Root
      opened={opened}
      onClose={requestClose}
      position={phone ? "bottom" : "right"}
      size={phone ? "92%" : ENTRY_SHEET.width}
      classNames={{ content: "txnFormContent cb-entry", body: "txnFormInner" }}
    >
      <Drawer.Overlay backgroundOpacity={ENTRY_SHEET.overlay} color="#12161d" />
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {editing ? t("transactions.editTitle") : t("transactions.addTitle")}
          </Drawer.Title>
          <Group gap={4} wrap="nowrap">
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={ENTRY_SHEET.headerButton}
                  aria-label={t("templates.title")}
                >
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {!editing && templates.length > 0 && (
                  <>
                    <Menu.Label>{t("templates.apply")}</Menu.Label>
                    {templates.map((tpl) => (
                      <Menu.Item key={tpl.id} onClick={() => applyTemplate(String(tpl.id))}>
                        {tpl.name}
                      </Menu.Item>
                    ))}
                    <Menu.Divider />
                  </>
                )}
                <Menu.Item
                  leftSection={<IconDeviceFloppy size={15} />}
                  disabled={totalMinor === 0 && !isSplit}
                  onClick={() => {
                    const name = window.prompt(t("templates.namePrompt"));
                    if (name && name.trim()) saveTemplate.mutate(name.trim());
                  }}
                >
                  {t("templates.saveAs")}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconAdjustments size={15} />}
                  onClick={() => void customise()}
                >
                  {t("transactions.customiseFields")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Drawer.CloseButton aria-label={t("common.close")} />
          </Group>
        </Drawer.Header>
        <Drawer.Body>
          <Stack gap={ENTRY_SHEET.gap} mih="100%" onKeyDown={onEnter}>
            {/* Natural-language quick entry (only when AI is enabled). */}
            {aiEnabled && !editing && (
              <TextInput
                label={t("ai.quickEntry")}
                placeholder={t("ai.quickEntryPlaceholder")}
                value={quickText}
                onChange={(e) => setQuickText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (quickText.trim()) parse.mutate();
                  }
                }}
                rightSection={
                  <ActionIcon
                    variant="subtle"
                    aria-label={t("ai.quickEntry")}
                    loading={parse.isPending}
                    disabled={!quickText.trim()}
                    onClick={() => parse.mutate()}
                  >
                    <IconSparkles size={16} />
                  </ActionIcon>
                }
              />
            )}

            {/* The amount comes first and large: it is the one field every
                transaction has, and the one a reader checks before saving.
                Its sign is a switch inside it rather than a field of its own —
                typing + or − in front of the figure flips it too. */}
            <TextInput
              ref={amountRef}
              className="cb-amount"
              data-autofocus
              label={t("transactions.amount")}
              value={amount}
              onChange={(e) => onAmount(e.currentTarget.value)}
              inputMode="decimal"
              leftSectionWidth={ENTRY_SHEET.sign.section}
              leftSectionPointerEvents="all"
              leftSection={
                <UnstyledButton
                  className="cb-amount-sign"
                  aria-label={signLabel}
                  title={signLabel}
                  onClick={() => setDirection((d) => (d === "expense" ? "income" : "expense"))}
                  style={{
                    color: direction === "expense" ? "var(--cb-negative)" : "var(--cb-positive)",
                  }}
                >
                  {direction === "expense" ? "−" : "+"}
                </UnstyledButton>
              }
              rightSection={<Text size="xs">{current.currencyCode}</Text>}
            />
            {duplicates.length > 0 && (
              <Alert color="yellow">
                {t("transactions.duplicateWarning", { count: duplicates.length })}
              </Alert>
            )}
            {fieldRows("base")}

            {/* Everything else, one click away. Closed on a new entry; open on
                its own when the row being edited has any of it filled, so
                nothing already there is hidden from the person changing it.
                Which fields sit here is the reader's choice, in Settings. */}
            <Button
              variant="subtle"
              color="gray"
              fullWidth
              justify="space-between"
              aria-expanded={moreOpen}
              rightSection={
                <IconChevronDown
                  size={16}
                  style={{ transform: moreOpen ? "rotate(180deg)" : undefined }}
                />
              }
              onClick={() => setMoreOpen((v) => !v)}
            >
              {t("transactions.moreDetails")}
            </Button>
            <Collapse expanded={moreOpen}>
              <Stack gap={ENTRY_SHEET.gap}>
                {fieldRows("more")}
                <Switch
                  label={t("transactions.splitToggle")}
                  checked={isSplit}
                  onChange={(e) => setIsSplit(e.currentTarget.checked)}
                />
                {isSplit && (
                  <Stack gap="xs">
                    {splits.map((s, i) => (
                      <Group key={i} gap={ENTRY_SHEET.pairGap} wrap="nowrap">
                        <Select
                          placeholder={t("transactions.category")}
                          aria-label={t("transactions.category")}
                          data={categoryOptions}
                          value={s.categoryId}
                          onChange={(v) =>
                            setSplits((arr) =>
                              arr.map((x, j) => (j === i ? { ...x, categoryId: v } : x)),
                            )
                          }
                          searchable
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <TextInput
                          placeholder={t("transactions.amount")}
                          aria-label={t("transactions.amount")}
                          value={s.amount}
                          onChange={(e) =>
                            setSplits((arr) =>
                              arr.map((x, j) =>
                                j === i ? { ...x, amount: e.currentTarget.value } : x,
                              ),
                            )
                          }
                          w={110}
                        />
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={t("transactions.removeSplit")}
                          onClick={() => setSplits((arr) => arr.filter((_, j) => j !== i))}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    ))}
                    <Group justify="space-between">
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() =>
                          setSplits((arr) => [...arr, { categoryId: null, amount: "" }])
                        }
                      >
                        {t("transactions.addSplit")}
                      </Button>
                      {splitMismatch && (
                        <Text size="sm" c={errorColor}>
                          {t("transactions.splitMismatch")} (
                          <NumberFormatter
                            value={splitSumMinor / Math.pow(10, fd)}
                            decimalScale={fd}
                          />{" "}
                          /{" "}
                          <NumberFormatter
                            value={totalMinor / Math.pow(10, fd)}
                            decimalScale={fd}
                          />
                          )
                        </Text>
                      )}
                    </Group>
                  </Stack>
                )}
                {editing && !__DEMO__ && (
                  <AttachmentsField walletId={walletId} transactionId={editing.id} />
                )}
              </Stack>
            </Collapse>

            {/* The foot: the two actions, each with its key. "Save and add
                another" keeps the date — a run of entries is usually one
                receipt, one day — and, with the box on its left ticked, every
                other field too, for a run of similar ones. The box is a
                toggle joined to the button rather than a checkbox inside it:
                a control inside a button is one a click cannot tell apart. */}
            <Group justify="flex-end" mt="auto" pt={ENTRY_SHEET.footTop} className="cb-entry-foot">
              <Group gap={ENTRY_SHEET.footButtonsGap} wrap="nowrap">
                {!editing && (
                  <Button.Group>
                    <Tooltip label={t("transactions.keepFields")} openDelay={300}>
                      <Button
                        variant="default"
                        className="cb-keep-toggle"
                        aria-label={t("transactions.keepFields")}
                        aria-pressed={keepFields}
                        onClick={() => setKeepFields((v) => !v)}
                      >
                        {keepFields ? (
                          <IconSquareCheck size={17} color="var(--mantine-primary-color-filled)" />
                        ) : (
                          <IconSquare size={17} />
                        )}
                      </Button>
                    </Tooltip>
                    <Button
                      variant="default"
                      onClick={() => submit("new")}
                      loading={save.isPending && savingMode === "new"}
                      disabled={!canSave}
                      aria-keyshortcuts="Shift+Enter"
                    >
                      {t(
                        keepFields ? "transactions.saveAndKeep" : "transactions.saveAndAddAnother",
                      )}
                      <Keys keys="⇧↵" />
                    </Button>
                  </Button.Group>
                )}
                <Button
                  onClick={() => submit("close")}
                  loading={save.isPending && savingMode === "close"}
                  disabled={!canSave}
                  aria-keyshortcuts="Enter"
                >
                  {t("transactions.save")}
                  <Keys keys="↵" />
                </Button>
              </Group>
            </Group>
            <Text
              role="status"
              aria-live="polite"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
              }}
            >
              {savedMsg}
            </Text>
          </Stack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * A button's keyboard shortcut, drawn inside it. Hidden from assistive tech —
 * the button's aria-keyshortcuts says it, and its name stays just its label —
 * and hidden on a touch screen, which has no Enter to press.
 */
function Keys({ keys }: { keys: string }) {
  return (
    <span className="cb-keys" aria-hidden>
      {keys}
    </span>
  );
}

/**
 * The values a freshly opened form holds: the transaction being edited, the row
 * being duplicated, or the blank defaults for a new entry.
 *
 * It is one function because the values are needed twice — to seed the fields
 * and to remember what they were, for the unsaved-edits guard — and two copies
 * of this list drift. A new transaction pre-fills the account's default payment
 * mode; editing keeps the stored one (a picked payee's default still overrides).
 * A new entry, and a duplicate, start from the reader's default date and status.
 */
function initialValues(
  editing: Transaction | null,
  duplicate: Transaction | null | undefined,
  account: Account,
  fd: number,
  dc: string,
  startDate: string,
  startStatus: number,
): EntryValues {
  const e = editing ?? duplicate ?? null;
  return {
    date: e?.date ?? startDate,
    direction: (e?.amount ?? -1) < 0 ? "expense" : "income",
    amount: e ? minorToInput(Math.abs(e.amount), fd, dc) : "",
    paymentMode: String(e?.paymentMode ?? account.defaultPaymentMode),
    status: String(editing ? editing.status : startStatus),
    payeeId: e?.payeeId ? String(e.payeeId) : null,
    categoryId: e?.categoryId ? String(e.categoryId) : null,
    vehicleId: e?.vehicleId ? String(e.vehicleId) : null,
    memo: e?.memo ?? "",
    info: e?.info ?? "",
    tags: e?.tags ?? [],
    isSplit: e?.isSplit ?? false,
    splits:
      e?.splits?.map((s) => ({
        categoryId: s.categoryId ? String(s.categoryId) : null,
        amount: minorToInput(Math.abs(s.amount), fd, dc),
      })) ?? [],
  };
}

/** What the sheet's fields hold, in one object: seeded, reset, compared. */
interface EntryValues {
  date: string;
  direction: "expense" | "income";
  amount: string;
  paymentMode: string;
  status: string;
  payeeId: string | null;
  categoryId: string | null;
  vehicleId: string | null;
  memo: string;
  info: string;
  tags: string[];
  isSplit: boolean;
  splits: { categoryId: string | null; amount: string }[];
}

/**
 * Whether anything under More details holds a value, which decides whether it
 * opens with the sheet. The date and the account always hold one, so they never
 * count; the payment mode counts when it differs from the account's default.
 * The split is always under More details.
 */
function hasDetails(
  v: EntryValues,
  place: Record<EntryField, Placement>,
  defaultPaymentMode: number,
) {
  const filled: Record<EntryField, boolean> = {
    date: false,
    account: false,
    memo: v.memo !== "",
    paymentMode: v.paymentMode !== String(defaultPaymentMode),
    category: v.categoryId !== null,
    status: v.status !== "0",
    payee: v.payeeId !== null,
    info: v.info !== "",
    vehicle: v.vehicleId !== null,
    tags: v.tags.length > 0,
  };
  return (
    v.isSplit || (Object.keys(filled) as EntryField[]).some((f) => place[f] === "more" && filled[f])
  );
}
