import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FileInput,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertTriangle, IconFileSpreadsheet } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  CSV_FIELDS,
  commitCSV,
  listAccounts,
  previewCSV,
  type Account,
  type CSVDateFormat,
  type CSVDialect,
  type CSVPreviewRequest,
  type CSVPreviewRow,
} from "../api/client";
import { formatMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";

type Phase = "source" | "map" | "review" | "done";

const REQUIRED_FIELDS = ["date", "amount"];

export function ImportCsvWizard() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  const [phase, setPhase] = useState<Phase>("source");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dialect, setDialect] = useState<CSVDialect>("homebank");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [delimiter, setDelimiter] = useState(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [dateFormat, setDateFormat] = useState<CSVDateFormat>("");
  const [decimalChar, setDecimalChar] = useState(".");
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<CSVPreviewRow[]>([]);
  const [applyRules, setApplyRules] = useState(false);
  const [created, setCreated] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const account = useMemo<Account | undefined>(
    () => accounts.find((a) => String(a.id) === accountId),
    [accounts, accountId],
  );

  const fmtAmount = (minor: number) =>
    account
      ? formatMinor(minor, {
          fracDigits: account.currencyFracDigits,
          decimalChar: account.currencyDecimalChar,
          groupChar: account.currencyGroupChar,
          symbol: account.currencySymbol,
          symbolPrefix: account.currencySymbolPrefix,
        })
      : String(minor);

  const baseReq = (overrides: Partial<CSVPreviewRequest>): CSVPreviewRequest => ({
    accountId: Number(accountId),
    content,
    dialect,
    delimiter: dialect === "generic" ? delimiter : undefined,
    hasHeader: dialect === "generic" ? hasHeader : undefined,
    dateFormat,
    decimalChar: dialect === "generic" ? decimalChar : undefined,
    ...overrides,
  });

  const preview = useMutation({
    mutationFn: (req: CSVPreviewRequest) => previewCSV(walletId, req),
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  const commit = useMutation({
    mutationFn: () => {
      const keep = rows
        .filter((r) => r.include && !r.error)
        .map((r) => ({
          date: r.date,
          amount: r.amount,
          paymentMode: r.paymentMode,
          info: r.info,
          payee: r.payee,
          memo: r.memo,
          category: r.category,
          tags: r.tags,
        }));
      return commitCSV(walletId, Number(accountId), keep);
    },
    onSuccess: (res) => {
      setCreated(res.created);
      setPhase("done");
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  const onPickFile = (file: File | null) => {
    setFileName(file?.name ?? null);
    if (!file) {
      setContent("");
      return;
    }
    void file.text().then(setContent);
  };

  const startFromSource = async () => {
    setError(null);
    if (dialect === "generic") {
      // First pass: detect columns to drive the mapping step.
      const res = await preview.mutateAsync(baseReq({}));
      setColumns(res.columns);
      setPhase("map");
      return;
    }
    const res = await preview.mutateAsync(baseReq({ applyRules }));
    setRows(res.rows);
    setPhase("review");
  };

  const runPreviewWithMapping = async (rules: boolean) => {
    setError(null);
    const res = await preview.mutateAsync(baseReq({ mapping, applyRules: rules }));
    setRows(res.rows);
    setPhase("review");
  };

  const runPreviewHomebank = async (rules: boolean) => {
    setError(null);
    const res = await preview.mutateAsync(baseReq({ applyRules: rules }));
    setRows(res.rows);
  };

  const toggleApplyRules = async (next: boolean) => {
    setApplyRules(next);
    if (dialect === "generic") await runPreviewWithMapping(next);
    else await runPreviewHomebank(next);
  };

  const toggleRow = (i: number, include: boolean) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, include } : r)));

  const reset = () => {
    setPhase("source");
    setContent("");
    setFileName(null);
    setRows([]);
    setColumns([]);
    setMapping({});
    setCreated(0);
    setError(null);
  };

  const mappingValid = REQUIRED_FIELDS.every((f) => mapping[f] !== undefined);
  const includeCount = rows.filter((r) => r.include && !r.error).length;
  const stepIndex = { source: 0, map: 1, review: dialect === "generic" ? 2 : 1, done: 3 }[phase];

  return (
    <Stack>
      <Stepper active={stepIndex} size="sm">
        <Stepper.Step label={t("importCsv.steps.source")} />
        {dialect === "generic" && <Stepper.Step label={t("importCsv.steps.map")} />}
        <Stepper.Step label={t("importCsv.steps.review")} />
        <Stepper.Step label={t("importCsv.steps.done")} />
      </Stepper>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {error}
        </Alert>
      )}

      {phase === "source" && (
        <Card withBorder>
          <Stack>
            <SegmentedControl
              value={dialect}
              onChange={(v) => setDialect(v as CSVDialect)}
              data={[
                { label: t("importCsv.dialect.homebank"), value: "homebank" },
                { label: t("importCsv.dialect.generic"), value: "generic" },
              ]}
            />
            <Select
              label={t("importCsv.account")}
              placeholder={t("importCsv.accountPlaceholder")}
              data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
              value={accountId}
              onChange={setAccountId}
              searchable
            />
            <FileInput
              label={t("importCsv.file")}
              placeholder={fileName ?? t("importCsv.filePlaceholder")}
              accept=".csv,text/csv,text/plain"
              leftSection={<IconFileSpreadsheet size={16} />}
              onChange={onPickFile}
              clearable
            />
            {dialect === "generic" && (
              <Group grow>
                <TextInput
                  label={t("importCsv.delimiter")}
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.currentTarget.value.slice(0, 1))}
                  maxLength={1}
                  w={80}
                />
                <Select
                  label={t("importCsv.dateFormat")}
                  data={[
                    { value: "", label: t("importCsv.dates.auto") },
                    { value: "iso", label: "YYYY-MM-DD" },
                    { value: "dmy", label: "DD-MM-YYYY" },
                    { value: "mdy", label: "MM-DD-YYYY" },
                  ]}
                  value={dateFormat}
                  onChange={(v) => setDateFormat((v ?? "") as CSVDateFormat)}
                />
                <Select
                  label={t("importCsv.decimal")}
                  data={[
                    { value: ".", label: "1234.56" },
                    { value: ",", label: "1234,56" },
                  ]}
                  value={decimalChar}
                  onChange={(v) => setDecimalChar(v ?? ".")}
                />
                <Switch
                  label={t("importCsv.hasHeader")}
                  checked={hasHeader}
                  onChange={(e) => setHasHeader(e.currentTarget.checked)}
                  mt="lg"
                />
              </Group>
            )}
            <Group justify="flex-end">
              <Button
                disabled={!content || !accountId}
                loading={preview.isPending}
                onClick={() => void startFromSource()}
              >
                {t("importCsv.next")}
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      {phase === "map" && (
        <Card withBorder>
          <Stack>
            <Text size="sm" c="dimmed">
              {t("importCsv.mapHint")}
            </Text>
            {CSV_FIELDS.map((field) => (
              <Select
                key={field}
                label={t(`importCsv.fields.${field}`)}
                required={REQUIRED_FIELDS.includes(field)}
                clearable
                data={columns.map((c, i) => ({ value: String(i), label: c }))}
                value={mapping[field] !== undefined ? String(mapping[field]) : null}
                onChange={(v) =>
                  setMapping((m) => {
                    const next = { ...m };
                    if (v === null) delete next[field];
                    else next[field] = Number(v);
                    return next;
                  })
                }
              />
            ))}
            <Group justify="space-between">
              <Button variant="default" onClick={() => setPhase("source")}>
                {t("importCsv.back")}
              </Button>
              <Button
                disabled={!mappingValid}
                loading={preview.isPending}
                onClick={() => void runPreviewWithMapping(applyRules)}
              >
                {t("importCsv.preview")}
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      {phase === "review" && (
        <Card withBorder>
          <Stack>
            <Group justify="space-between">
              <Switch
                label={t("importCsv.applyRules")}
                checked={applyRules}
                onChange={(e) => void toggleApplyRules(e.currentTarget.checked)}
              />
              <Text size="sm" c="dimmed">
                {t("importCsv.willImport", { count: includeCount })}
              </Text>
            </Group>
            <Table.ScrollContainer minWidth={720}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th />
                    <Table.Th>{t("importCsv.fields.date")}</Table.Th>
                    <Table.Th>{t("importCsv.fields.payee")}</Table.Th>
                    <Table.Th>{t("importCsv.fields.category")}</Table.Th>
                    <Table.Th ta="right">{t("importCsv.fields.amount")}</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r, i) => (
                    <Table.Tr key={i} c={r.error ? "red" : undefined}>
                      <Table.Td>
                        <Checkbox
                          checked={r.include}
                          disabled={!!r.error}
                          onChange={(e) => toggleRow(i, e.currentTarget.checked)}
                        />
                      </Table.Td>
                      <Table.Td>{r.date || "—"}</Table.Td>
                      <Table.Td>{r.payee}</Table.Td>
                      <Table.Td>{r.category}</Table.Td>
                      <Table.Td ta="right">{r.error ? "—" : fmtAmount(r.amount)}</Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {r.duplicate && (
                            <Badge color="yellow" size="sm">
                              {t("importCsv.duplicate")}
                            </Badge>
                          )}
                          {r.ruleApplied && (
                            <Badge color="blue" size="sm">
                              {t("importCsv.rule")}
                            </Badge>
                          )}
                          {r.error && (
                            <Badge color="red" size="sm">
                              {r.error}
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Group justify="space-between">
              <Button
                variant="default"
                onClick={() => setPhase(dialect === "generic" ? "map" : "source")}
              >
                {t("importCsv.back")}
              </Button>
              <Button
                disabled={includeCount === 0}
                loading={commit.isPending}
                onClick={() => commit.mutate()}
              >
                {t("importCsv.import", { count: includeCount })}
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      {phase === "done" && (
        <Alert color="green" title={t("importCsv.done")}>
          <Stack align="flex-start">
            <Text>{t("importCsv.createdCount", { count: created })}</Text>
            <Button variant="light" onClick={reset}>
              {t("importCsv.importAnother")}
            </Button>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
