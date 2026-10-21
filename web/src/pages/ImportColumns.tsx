import { Anchor, Box, Group, Select, Text } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { CSV_FIELDS, type CSVMapping, type CSVProposal } from "../api/client";
import { AiBox } from "../components/AiBox";

// The generic CSV's map step (#709): one row per column of the file, with its
// first value and the field it fills; above it, the AI's reading of the file
// or the mapping the wallet remembers for these columns.

const ROW_RULE = "1px solid var(--mantine-color-default-border)";

type Mapping = Record<string, number>;

const dayMonth = (lang: string, iso?: string) =>
  new Intl.DateTimeFormat(lang, { day: "numeric", month: "long" }).format(
    iso ? new Date(iso) : new Date(),
  );

export function ImportColumns({
  columns,
  sample,
  mapping,
  proposed,
  phone,
  onChange,
}: {
  columns: string[];
  sample: string[];
  mapping: Mapping;
  proposed?: Mapping;
  phone: boolean;
  onChange: (m: Mapping) => void;
}) {
  const { t } = useTranslation();
  const fieldAt = (i: number) => Object.keys(mapping).find((f) => mapping[f] === i) ?? null;
  const options = CSV_FIELDS.map((f) => ({ value: f, label: t(`importCsv.fields.${f}`) }));
  // A field fills one column: picking it here takes it from any other.
  const pick = (i: number, field: string | null) => {
    const next: Mapping = {};
    for (const [f, c] of Object.entries(mapping)) if (c !== i && f !== field) next[f] = c;
    if (field) next[field] = i;
    onChange(next);
  };
  return (
    <Box>
      {columns.map((c, i) => {
        const field = fieldAt(i);
        const first = sample[i] ?? "";
        const value = (
          <Text fz={phone ? 12.5 : 13} c="dimmed" ff="monospace" truncate data-cb-sensitive>
            {first || "—"}
          </Text>
        );
        return (
          <Box
            key={i}
            py={8}
            data-testid="csv-column"
            style={{
              display: "grid",
              gridTemplateColumns: phone ? "minmax(0, 1fr) 150px" : "180px minmax(0, 1fr) 200px",
              gap: "4px 12px",
              alignItems: "center",
              borderTop: ROW_RULE,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <Text fz={14} fw={500} truncate>
                {c}
              </Text>
              {phone && value}
            </div>
            {!phone && value}
            <Select
              size="sm"
              aria-label={t("importCsv.fieldFor", { column: c })}
              placeholder={t("importCsv.notImported")}
              clearable
              data={options}
              value={field}
              onChange={(v) => pick(i, v)}
              leftSection={
                field && proposed?.[field] === i ? (
                  <IconSparkles
                    size={13}
                    color="var(--cb-ai-a)"
                    aria-label={t("importCsv.ai.mark")}
                  />
                ) : undefined
              }
            />
          </Box>
        );
      })}
    </Box>
  );
}

export function CsvProposalBox({ proposal, madeOn }: { proposal: CSVProposal; madeOn: string }) {
  const { t, i18n } = useTranslation();
  const m = proposal.mapping;
  const matched = CSV_FIELDS.filter((f) => m[f] !== undefined).map((f) =>
    t(`importCsv.fields.${f}`),
  );
  const missing =
    m.date === undefined ||
    (m.amount === undefined && m.debit === undefined && m.credit === undefined);
  const read = [
    proposal.dateFormat && t(`importCsv.ai.dates.${proposal.dateFormat}`),
    t(proposal.decimalChar === "," ? "importCsv.ai.decimalComma" : "importCsv.ai.decimalPoint"),
    t(proposal.invertAmount ? "importCsv.ai.signInverted" : "importCsv.ai.signKept"),
  ].filter(Boolean);
  return (
    <AiBox
      label={t("importCsv.ai.label")}
      basis={t("importCsv.ai.basis", { date: madeOn })}
      title={
        matched.length
          ? t("importCsv.ai.title", {
              fields: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(matched),
            })
          : t("importCsv.ai.noneMatched")
      }
    >
      <Text fz={14}>{read.join(" ")}</Text>
      {missing && (
        <Text fz={14} mt={4}>
          {t("importCsv.ai.missing")}
        </Text>
      )}
      <Text fz="xs" c="dimmed" mt={4}>
        {t("importCsv.ai.note")}
      </Text>
    </AiBox>
  );
}

export function RememberedBar({
  mapping,
  onForget,
}: {
  mapping: CSVMapping;
  onForget: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Group
      justify="space-between"
      gap="xs"
      px={14}
      py={10}
      data-testid="csv-remembered"
      style={{ border: "1px solid var(--cb-shell-card-border)", borderRadius: 10 }}
    >
      <Text fz={14}>
        {t("importCsv.remembered", { date: dayMonth(i18n.language, mapping.createdAt) })}
      </Text>
      <Anchor component="button" type="button" fz={14} onClick={onForget}>
        {t("importCsv.forget")}
      </Anchor>
    </Group>
  );
}
