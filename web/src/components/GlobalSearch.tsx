import {
  ActionIcon,
  Badge,
  Group,
  Kbd,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue, useDisclosure, useHotkeys } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { type Account, type SearchRow, listAccounts, searchTransactions } from "../api/client";
import { useDateFormat } from "../dates";
import { type MoneyFormat, formatMinor } from "../money";
import { amountColor, errorColor } from "../amountTone";

const MIN_CHARS = 2;

// The shortcut is shown, so it has to read the way that platform writes it.
const modKey =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

function accountFormat(a?: Account): MoneyFormat | undefined {
  if (!a) return undefined;
  return {
    fracDigits: a.currencyFracDigits,
    decimalChar: a.currencyDecimalChar,
    groupChar: a.currencyGroupChar,
    symbol: a.currencySymbol,
    symbolPrefix: a.currencySymbolPrefix,
  };
}

// GlobalSearch searches the whole wallet's register — memo, info, payee,
// category and tags — via the server endpoint. Selecting a hit opens that
// account's register with the query pre-applied, so the row lands in its ledger
// context. ⌘/Ctrl-K opens it from anywhere.
//
// The "sidebar" variant is a row rather than an icon: with no bar across the
// top of the window, a lone magnifying glass would be the only unlabelled
// control left, and a keyboard shortcut nobody is told about is not a feature.
export function GlobalSearch({
  walletId,
  variant = "icon",
}: {
  walletId: number;
  variant?: "icon" | "sidebar";
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fmtDate = useDateFormat();
  const [opened, { open, close }] = useDisclosure(false);
  const [text, setText] = useState("");
  const [debounced] = useDebouncedValue(text, 250);
  const q = debounced.trim();

  useHotkeys([["mod+K", () => open()]]);

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0 && opened,
  });
  const fmtByAccount = useMemo(() => {
    const m = new Map<number, MoneyFormat>();
    for (const a of accountsQuery.data ?? []) {
      const f = accountFormat(a);
      if (f) m.set(a.id, f);
    }
    return m;
  }, [accountsQuery.data]);

  const searchQuery = useQuery({
    queryKey: ["search", walletId, q],
    queryFn: () => searchTransactions(walletId, q, { limit: 50 }),
    enabled: walletId > 0 && opened && q.length >= MIN_CHARS,
  });
  const result = searchQuery.data;

  const go = (row: SearchRow) => {
    close();
    const params = new URLSearchParams({ account: String(row.accountId), q });
    navigate(`/transactions?${params.toString()}`);
  };

  const primaryText = (r: SearchRow) =>
    r.payeeName || r.memo || r.info || r.categoryName || t("search.untitled");
  const secondaryText = (r: SearchRow) => {
    const bits = [r.memo, r.categoryName].filter((s) => s && s !== r.payeeName);
    return bits.join(" · ");
  };

  return (
    <>
      {variant === "sidebar" ? (
        <UnstyledButton onClick={open} aria-label={t("search.open")} className="cb-search-row">
          <Group gap={8} wrap="nowrap">
            <IconSearch size={16} opacity={0.7} />
            <Text size="sm" c="dimmed" truncate style={{ flex: 1 }}>
              {t("search.open")}
            </Text>
            <Kbd size="xs">{modKey}K</Kbd>
          </Group>
        </UnstyledButton>
      ) : (
        <ActionIcon variant="subtle" color="gray" aria-label={t("search.open")} onClick={open}>
          <IconSearch size={20} />
        </ActionIcon>
      )}
      <Modal opened={opened} onClose={close} title={t("search.title")} size="lg">
        <Stack gap="sm">
          <TextInput
            data-autofocus
            autoFocus
            leftSection={<IconSearch size={16} />}
            rightSection={searchQuery.isFetching ? <Loader size="xs" /> : undefined}
            placeholder={t("search.placeholder")}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />

          {q.length < MIN_CHARS ? (
            <Text c="dimmed" size="sm">
              {t("search.hint", { n: MIN_CHARS })}
            </Text>
          ) : searchQuery.isError ? (
            <Text c={errorColor} size="sm">
              {t("search.error")}
            </Text>
          ) : result && result.rows.length === 0 ? (
            <Text c="dimmed" size="sm">
              {t("search.empty", { q })}
            </Text>
          ) : (
            result && (
              <>
                <Text c="dimmed" size="xs">
                  {t("search.count", { count: result.total })}
                </Text>
                <Stack gap={4} mah={440} style={{ overflowY: "auto" }}>
                  {result.rows.map((r) => {
                    const fmt = fmtByAccount.get(r.accountId);
                    return (
                      <UnstyledButton
                        key={`${r.accountId}:${r.id}`}
                        onClick={() => go(r)}
                        p="xs"
                        style={{ borderRadius: 8 }}
                        className="cb-search-hit"
                      >
                        <Group justify="space-between" wrap="nowrap" gap="sm">
                          <div style={{ minWidth: 0 }}>
                            <Group gap={6} wrap="nowrap">
                              <Text size="sm" fw={500} truncate>
                                {primaryText(r)}
                              </Text>
                              <Badge size="xs" variant="light" color="gray">
                                {r.accountName}
                              </Badge>
                            </Group>
                            <Text size="xs" c="dimmed" truncate>
                              {fmtDate(r.date)}
                              {secondaryText(r) ? ` · ${secondaryText(r)}` : ""}
                            </Text>
                          </div>
                          <Text size="sm" fw={500} c={amountColor(r.amount)}>
                            {fmt ? formatMinor(r.amount, fmt) : r.amount}
                          </Text>
                        </Group>
                      </UnstyledButton>
                    );
                  })}
                </Stack>
                {result.total > result.rows.length && (
                  <Text c="dimmed" size="xs">
                    {t("search.more", { count: result.total - result.rows.length })}
                  </Text>
                )}
              </>
            )
          )}
        </Stack>
      </Modal>
    </>
  );
}
