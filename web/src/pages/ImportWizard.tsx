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
import { IconAlertTriangle, IconFileImport } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  CSV_FIELDS,
  commitImport,
  listAccounts,
  listImportPlugins,
  previewCSV,
  previewOFX,
  previewPlugin,
  previewQIF,
  type Account,
  type CSVDateFormat,
  type CSVPreview,
  type CSVPreviewRow,
} from "../api/client";
import { formatMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";

type Format = "homebank" | "generic" | "qif" | "ofx" | "plugin";
type Phase = "source" | "map" | "review" | "done";

// Read a (binary) file as base64 for plugin uploads.
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const REQUIRED_FIELDS = ["date", "amount"];

export function ImportWizard() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  const pluginsQuery = useQuery({
    queryKey: ["importPlugins", walletId],
    queryFn: () => listImportPlugins(walletId),
    enabled: walletId > 0,
  });
  const plugins = pluginsQuery.data?.plugins ?? [];

  const [phase, setPhase] = useState<Phase>("source");
  const [format, setFormat] = useState<Format>("homebank");
  const [pluginId, setPluginId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
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
  const [updated, setUpdated] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const showMapping = format === "generic";

  const account = useMemo<Account | undefined>(
    () => accounts.find((a) => String(a.id) === accountId),
    [accounts, accountId],
  );
  const selectedPlugin = plugins.find((p) => p.id === pluginId);
  const fileAccept =
    format === "plugin"
      ? (selectedPlugin?.accept.join(",") ?? ".xlsx")
      : ".csv,.qif,.ofx,.qfx,text/csv,text/plain,application/x-ofx";

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

  // runPreview dispatches to the format-specific preview endpoint.
  const runPreview = (opts: { withMapping: boolean; rules: boolean }): Promise<CSVPreview> => {
    const acc = Number(accountId);
    if (format === "plugin") {
      return previewPlugin(walletId, {
        pluginId: pluginId ?? "",
        accountId: acc,
        content,
        applyRules: opts.rules,
      });
    }
    if (format === "qif") {
      return previewQIF(walletId, { accountId: acc, content, dateFormat, applyRules: opts.rules });
    }
    if (format === "ofx") {
      return previewOFX(walletId, { accountId: acc, content, applyRules: opts.rules });
    }
    return previewCSV(walletId, {
      accountId: acc,
      content,
      dialect: format === "generic" ? "generic" : "homebank",
      delimiter: format === "generic" ? delimiter : undefined,
      hasHeader: format === "generic" ? hasHeader : undefined,
      dateFormat,
      decimalChar: format === "generic" ? decimalChar : undefined,
      mapping: opts.withMapping ? mapping : undefined,
      applyRules: opts.rules,
    });
  };

  const preview = useMutation({
    mutationFn: runPreview,
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
          status: r.status,
          importRef: r.importRef,
          updateId: r.match === "update" ? r.matchId : undefined,
        }));
      return commitImport(walletId, Number(accountId), keep);
    },
    onSuccess: (res) => {
      setCreated(res.created);
      setUpdated(res.updated ?? 0);
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
    // Plugin uploads may be binary (e.g. .xlsx) → send base64; text formats as-is.
    if (format === "plugin") {
      void readAsBase64(file).then(setContent);
    } else {
      void file.text().then(setContent);
    }
  };

  const startFromSource = async () => {
    setError(null);
    if (showMapping) {
      // First pass: detect columns to drive the mapping step.
      const res = await preview.mutateAsync({ withMapping: false, rules: applyRules });
      setColumns(res.columns);
      setPhase("map");
      return;
    }
    const res = await preview.mutateAsync({ withMapping: false, rules: applyRules });
    setRows(res.rows);
    setPhase("review");
  };

  const previewToReview = async (rules: boolean) => {
    setError(null);
    const res = await preview.mutateAsync({ withMapping: showMapping, rules });
    setRows(res.rows);
    setPhase("review");
  };

  const toggleApplyRules = async (next: boolean) => {
    setApplyRules(next);
    await previewToReview(next);
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
  const stepIndex = { source: 0, map: 1, review: showMapping ? 2 : 1, done: 3 }[phase];

  return (
    <Stack>
      <Stepper active={stepIndex} size="sm">
        <Stepper.Step label={t("importCsv.steps.source")} />
        {showMapping && <Stepper.Step label={t("importCsv.steps.map")} />}
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
              value={format}
              onChange={(v) => {
                setFormat(v as Format);
                setContent("");
                setFileName(null);
              }}
              data={[
                { label: t("importCsv.format.homebank"), value: "homebank" },
                { label: t("importCsv.format.generic"), value: "generic" },
                { label: t("importCsv.format.qif"), value: "qif" },
                { label: t("importCsv.format.ofx"), value: "ofx" },
                ...(plugins.length > 0
                  ? [{ label: t("importCsv.format.bank"), value: "plugin" }]
                  : []),
              ]}
            />
            {format === "plugin" && (
              <Select
                label={t("importCsv.plugin")}
                placeholder={t("importCsv.pluginPlaceholder")}
                data={plugins.map((p) => ({ value: p.id, label: `${p.label} (${p.country})` }))}
                value={pluginId}
                onChange={(v) => {
                  setPluginId(v);
                  setContent("");
                  setFileName(null);
                }}
                searchable
              />
            )}
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
              accept={fileAccept}
              leftSection={<IconFileImport size={16} />}
              onChange={onPickFile}
              clearable
              disabled={format === "plugin" && !pluginId}
            />
            {format === "generic" && (
              <Group grow>
                <TextInput
                  label={t("importCsv.delimiter")}
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.currentTarget.value.slice(0, 1))}
                  maxLength={1}
                  w={80}
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
            {(format === "generic" || format === "qif") && (
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
                maw={220}
              />
            )}
            <Group justify="flex-end">
              <Button
                disabled={!content || !accountId || (format === "plugin" && !pluginId)}
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
                onClick={() => void previewToReview(applyRules)}
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
                          {r.match === "update" && (
                            <Badge color="teal" size="sm">
                              {t("importCsv.merge")}
                            </Badge>
                          )}
                          {r.match === "ambiguous" && (
                            <Badge color="gray" size="sm">
                              {t("importCsv.ambiguous")}
                            </Badge>
                          )}
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
              <Button variant="default" onClick={() => setPhase(showMapping ? "map" : "source")}>
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
            {updated > 0 && <Text>{t("importCsv.updatedCount", { count: updated })}</Text>}
            <Button variant="light" onClick={reset}>
              {t("importCsv.importAnother")}
            </Button>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
