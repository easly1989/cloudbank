import {
  ActionIcon,
  Button,
  Input,
  Menu,
  NumberInput,
  SegmentedControl,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDots } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  addCurrency,
  updateCurrency,
  type Currency,
  type CurrencyUpdate,
} from "../../api/client";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import classes from "./currencies.module.css";
import { formatProblem, inverseText, preview, symbolOf, type CurrencyRow } from "./currencyList";
import { CurrencyMenuItems, type CurrencyActions } from "./CurrencyTable";
import { useOrigin } from "./labels";

/** Select values for the thousands separator: "" cannot be one. */
const NONE = "none";
const DECIMALS = ["0", "1", "2", "3", "4"];

/**
 * A currency in the sheet beside the page (#558). A new one is picked from the
 * catalog, and its rate comes from the ECB at once. An existing one has its
 * rate against the base, with where it came from and the other way round, and
 * how its amounts look, with a preview. Make base and Delete wait in the
 * header's menu.
 */
export function CurrencySheet({
  opened,
  onClose,
  walletId,
  editing,
  row,
  base,
  catalog,
  day,
  onSaved,
  onAdded,
  actions,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  editing: Currency | null;
  row: CurrencyRow | null;
  base: Currency;
  /** The catalog's currencies not in the wallet yet, for a new one. */
  catalog: { value: string; label: string }[];
  day: (date: string) => string;
  onSaved: () => void;
  onAdded: (c: Currency) => void;
  actions: CurrencyActions;
}) {
  const { t } = useTranslation();
  const origin = useOrigin(day);
  const [code, setCode] = useState<string | null>(null);
  const [rate, setRate] = useState<number | string>("");
  const [symbol, setSymbol] = useState("");
  const [prefix, setPrefix] = useState(false);
  const [decimalChar, setDecimalChar] = useState(".");
  const [groupChar, setGroupChar] = useState(",");
  const [fracDigits, setFracDigits] = useState(2);

  // Seeded on opening, during render, so the sheet never shows a frame of the
  // currency before; the key is null while closed, so reopening starts afresh.
  const openKey = opened ? String(editing?.id ?? "new") : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      setCode(null);
      setRate(editing?.rate ?? "");
      setSymbol(editing?.symbol ?? "");
      setPrefix(editing?.symbolPrefix ?? false);
      setDecimalChar(editing?.decimalChar ?? ".");
      setGroupChar(editing?.groupChar ?? ",");
      setFracDigits(editing?.fracDigits ?? 2);
    }
  }

  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const add = useMutation({
    mutationFn: () => addCurrency(walletId, code!),
    onSuccess: onAdded,
    onError,
  });

  const fmt = { symbol, symbolPrefix: prefix, decimalChar, groupChar, fracDigits };
  const problem = formatProblem(fmt);
  const rateValue = typeof rate === "number" ? rate : Number(rate);
  const rateOk = !editing || editing.isBase || rateValue > 0;
  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const patch: CurrencyUpdate = {};
      // Only a changed rate is sent: each one sent is recorded as typed by you.
      if (!editing.isBase && rateValue !== editing.rate) patch.rate = rateValue;
      if (
        symbol !== editing.symbol ||
        prefix !== editing.symbolPrefix ||
        decimalChar !== editing.decimalChar ||
        groupChar !== editing.groupChar ||
        fracDigits !== editing.fracDigits
      )
        Object.assign(patch, fmt);
      if (Object.keys(patch).length > 0) await updateCurrency(walletId, editing.id, patch);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError,
  });

  // A separator this list does not name (one from a HomeBank file) stays offered.
  const withCurrent = (opts: { value: string; label: string }[], v: string) =>
    opts.some((o) => o.value === v) ? opts : [...opts, { value: v, label: `"${v}"` }];
  const markOptions = withCurrent(
    [
      { value: ".", label: t("currencies.sep.point") },
      { value: ",", label: t("currencies.sep.comma") },
    ],
    decimalChar,
  );
  const groupOptions = withCurrent(
    [
      { value: ".", label: t("currencies.sep.point") },
      { value: ",", label: t("currencies.sep.comma") },
      { value: " ", label: t("currencies.sep.space") },
      { value: "'", label: t("currencies.sep.apostrophe") },
      { value: NONE, label: t("currencies.sep.none") },
    ],
    groupChar === "" ? NONE : groupChar,
  );
  const decimalOptions = DECIMALS.includes(String(fracDigits))
    ? DECIMALS
    : [...DECIMALS, String(fracDigits)];

  const title = editing ? editing.name : t("currencies.addTitle");
  const subtitle = editing
    ? `${editing.isoCode} · ${
        row && row.accounts > 0
          ? t("currencies.sheet.usedBy", { count: row.accounts })
          : t("currencies.sheet.unused")
      }`
    : undefined;

  const rateLabel = editing ? `1 ${symbolOf(editing)} =` : "";
  // A currency with no rate says so above the field, not again under it.
  const note = row && !editing?.isBase && editing?.rateSource ? origin(row).text : "";

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="currency-sheet"
      title={title}
      subtitle={subtitle}
      headerActions={
        editing &&
        row && (
          <Menu position="bottom-end" withinPortal width={240}>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("currencies.actionsFor", { name: editing.name })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <CurrencyMenuItems row={row} actions={actions} withEdit={false} />
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("currencies.cancel")}
          </Button>
          {editing ? (
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!!problem || !rateOk}
            >
              {t("currencies.save")}
            </Button>
          ) : (
            <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!code}>
              {t("currencies.addButton")}
            </Button>
          )}
        </>
      }
    >
      {!editing ? (
        <Select
          label={t("currencies.sheet.currency")}
          description={t("currencies.sheet.addHint")}
          inputWrapperOrder={["label", "input", "description"]}
          placeholder={t("currencies.sheet.search")}
          data={catalog}
          value={code}
          onChange={setCode}
          searchable
          nothingFoundMessage={t("currencies.sheet.noMatch")}
          data-autofocus
        />
      ) : editing.isBase ? (
        <Text size="sm" c="dimmed">
          {t("currencies.sheet.isBase")}
        </Text>
      ) : (
        <>
          {!editing.rateSource && (
            <span className={`${classes.notice} ${classes.warn}`} data-testid="currency-no-rate">
              {t("currencies.addedNoRate", { code: editing.isoCode })}
            </span>
          )}
          <NumberInput
            label={t("currencies.sheet.rate")}
            description={[
              note && `${note}.`,
              t("currencies.sheet.rateHint"),
              inverseText(rateValue, editing, base) &&
                t("currencies.sheet.inverse", { text: inverseText(rateValue, editing, base) }),
            ]
              .filter(Boolean)
              .join(" ")}
            inputWrapperOrder={["label", "input", "description", "error"]}
            value={rate}
            onChange={setRate}
            min={0}
            decimalScale={6}
            decimalSeparator={base.decimalChar || "."}
            allowNegative={false}
            hideControls
            leftSection={<span className={classes.affix}>{rateLabel}</span>}
            leftSectionWidth={Math.max(44, rateLabel.length * 8 + 18)}
            rightSection={<span className={classes.affix}>{symbolOf(base)}</span>}
            classNames={{ input: classes.mono }}
            error={!rateOk ? t("currencies.sheet.rateMissing") : undefined}
            data-autofocus
          />
        </>
      )}
      {editing && (
        <div className={classes.format} data-testid="currency-format">
          <span className={classes.sectionLabel}>{t("currencies.sheet.format")}</span>
          <div className={classes.pair}>
            <TextInput
              label={t("currencies.sheet.symbol")}
              value={symbol}
              maxLength={8}
              onChange={(e) => setSymbol(e.currentTarget.value)}
            />
            <Input.Wrapper label={t("currencies.sheet.symbolGoes")}>
              <SegmentedControl
                fullWidth
                value={prefix ? "before" : "after"}
                onChange={(v) => setPrefix(v === "before")}
                data={[
                  { value: "before", label: t("currencies.sheet.before") },
                  { value: "after", label: t("currencies.sheet.after") },
                ]}
              />
            </Input.Wrapper>
          </div>
          <div className={classes.pair}>
            <Select
              label={t("currencies.sheet.decimalMark")}
              data={markOptions}
              value={decimalChar}
              onChange={(v) => v && setDecimalChar(v)}
              allowDeselect={false}
            />
            <Select
              label={t("currencies.sheet.thousands")}
              data={groupOptions}
              value={groupChar === "" ? NONE : groupChar}
              onChange={(v) => v !== null && setGroupChar(v === NONE ? "" : v)}
              allowDeselect={false}
              error={problem === "same" ? t("currencies.sheet.sameSeparator") : undefined}
            />
          </div>
          <div className={classes.pair}>
            <Select
              label={t("currencies.sheet.decimals")}
              data={decimalOptions}
              value={String(fracDigits)}
              onChange={(v) => v && setFracDigits(Number(v))}
              allowDeselect={false}
            />
          </div>
          <span className={classes.sectionLabel}>{t("currencies.sheet.preview")}</span>
          <span className={classes.preview} data-testid="currency-preview">
            <span dir="ltr">{problem ? "—" : preview(fmt)}</span>
          </span>
        </div>
      )}
    </SideSheet>
  );
}
