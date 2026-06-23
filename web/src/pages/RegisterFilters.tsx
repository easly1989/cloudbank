import { Button, Card, Group, MultiSelect, Select, TextInput } from "@mantine/core";
import { IconFilterOff } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Category, Payee } from "../api/client";
import { type MoneyFormat } from "../money";
import { useAmountParser } from "../useAmountParser";
import { type DatePreset, type Filters, emptyFilters, isActive } from "./registerFilters";

const PRESETS: DatePreset[] = [
  "all",
  "thisMonth",
  "thisQuarter",
  "thisYear",
  "last30",
  "last90",
  "custom",
];
const STATUSES = [0, 1, 2, 3, 4];

function minorToInput(amount: number | null, fmt: MoneyFormat): string {
  if (amount === null) return "";
  const neg = amount < 0;
  const s = String(Math.abs(amount)).padStart(fmt.fracDigits + 1, "0");
  const intPart = s.slice(0, s.length - fmt.fracDigits) || "0";
  const frac = fmt.fracDigits > 0 ? fmt.decimalChar + s.slice(s.length - fmt.fracDigits) : "";
  return (neg ? "-" : "") + intPart + frac;
}

export function RegisterFilters({
  filters,
  onChange,
  payees,
  categories,
  tags,
  fmt,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  payees: Payee[];
  categories: Category[];
  tags: string[];
  fmt: MoneyFormat;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const fd = fmt.fracDigits;
  const dc = fmt.decimalChar;

  // Free-text/amount inputs keep a local draft so typing is smooth; they sync
  // down when the filters change externally (e.g. Clear).
  const [text, setText] = useState(filters.text);
  const [amin, setAmin] = useState(minorToInput(filters.amountMin, fmt));
  const [amax, setAmax] = useState(minorToInput(filters.amountMax, fmt));
  useEffect(() => setText(filters.text), [filters.text]);
  useEffect(() => setAmin(minorToInput(filters.amountMin, fmt)), [filters.amountMin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setAmax(minorToInput(filters.amountMax, fmt)), [filters.amountMax]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const amountToMinor = (v: string) => (v.trim() === "" ? null : parseAmount(v, fd, dc));

  return (
    <Card withBorder padding="xs">
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select
          label={t("filters.dateRange")}
          data={PRESETS.map((p) => ({ value: p, label: t(`filters.presets.${p}`) }))}
          value={filters.preset}
          onChange={(v) => onChange({ ...filters, preset: (v as DatePreset) ?? "all" })}
          allowDeselect={false}
          w={150}
        />
        {filters.preset === "custom" && (
          <>
            <TextInput
              type="date"
              label={t("filters.from")}
              value={filters.from}
              onChange={(e) => onChange({ ...filters, from: e.currentTarget.value })}
              w={150}
            />
            <TextInput
              type="date"
              label={t("filters.to")}
              value={filters.to}
              onChange={(e) => onChange({ ...filters, to: e.currentTarget.value })}
              w={150}
            />
          </>
        )}
        <Select
          label={t("transactions.status")}
          data={STATUSES.map((s) => ({ value: String(s), label: t(`status.${s}`) }))}
          value={filters.status === null ? null : String(filters.status)}
          onChange={(v) => onChange({ ...filters, status: v === null ? null : Number(v) })}
          clearable
          w={130}
        />
        <Select
          label={t("transactions.payee")}
          data={payees.map((p) => ({ value: String(p.id), label: p.name }))}
          value={filters.payeeId === null ? null : String(filters.payeeId)}
          onChange={(v) => onChange({ ...filters, payeeId: v === null ? null : Number(v) })}
          clearable
          searchable
          w={160}
        />
        <Select
          label={t("transactions.category")}
          data={categoryOptions}
          value={filters.categoryId === null ? null : String(filters.categoryId)}
          onChange={(v) => onChange({ ...filters, categoryId: v === null ? null : Number(v) })}
          clearable
          searchable
          w={170}
        />
        <MultiSelect
          label={t("transactions.tags")}
          data={tags}
          value={filters.tags}
          onChange={(v) => onChange({ ...filters, tags: v })}
          clearable
          searchable
          w={170}
        />
        <TextInput
          label={t("filters.amountMin")}
          value={amin}
          onChange={(e) => setAmin(e.currentTarget.value)}
          onBlur={() => onChange({ ...filters, amountMin: amountToMinor(amin) })}
          w={110}
        />
        <TextInput
          label={t("filters.amountMax")}
          value={amax}
          onChange={(e) => setAmax(e.currentTarget.value)}
          onBlur={() => onChange({ ...filters, amountMax: amountToMinor(amax) })}
          w={110}
        />
        <TextInput
          label={t("filters.search")}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onBlur={() => onChange({ ...filters, text })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onChange({ ...filters, text });
          }}
          w={180}
        />
        {isActive(filters) && (
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconFilterOff size={16} />}
            onClick={() => onChange(emptyFilters)}
          >
            {t("filters.clear")}
          </Button>
        )}
      </Group>
    </Card>
  );
}
