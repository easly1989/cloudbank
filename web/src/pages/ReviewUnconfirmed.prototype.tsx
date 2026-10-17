// PROTOTYPE (#660), throwaway: the "not confirmed by the bank" section of the
// review, in two variants, with invented rows. Shown only with
// ?mock=unconfirmed&v=a|b on /review. Not for main.
import { Box, Button, Card, Group, Select, Stack, Text } from "@mantine/core";
import { IconBuildingBank, IconGitMerge, IconMail, IconTrash } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { useState } from "react";

import type { Account } from "../api/client";
import { amountColor } from "../amountTone";
import { useDateFormat } from "../dates";
import { formatMinor } from "../money";

const RULE = "1px solid var(--mantine-color-default-border)";

function ago(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

interface Cand {
  id: number;
  date: string;
  amount: number;
  memo: string;
}
interface Row {
  id: number;
  days: number;
  date: string;
  amount: number;
  memo: string;
  category: string;
  cands: Cand[];
}

const ROWS: Row[] = [
  {
    id: 1,
    days: 7,
    date: ago(7),
    amount: -10000,
    memo: "Distributore Demo",
    category: "Auto › Carburante",
    cands: [
      { id: 11, date: ago(6), amount: -4000, memo: "PAGAMENTO POS DISTRIBUTORE DEMO VIA ROMA" },
      { id: 12, date: ago(5), amount: -2310, memo: "PAGAMENTO POS SUPERMERCATO DEMO" },
    ],
  },
  {
    id: 2,
    days: 9,
    date: ago(9),
    amount: -18000,
    memo: "Hotel Demo Firenze",
    category: "Viaggi",
    cands: [{ id: 21, date: ago(6), amount: -20540, memo: "HOTEL DEMO FIRENZE SRL" }],
  },
  { id: 3, days: 6, date: ago(6), amount: -3200, memo: "Ristorante Demo", category: "", cands: [] },
];

export function UnconfirmedPrototype({
  accounts,
  variant,
}: {
  accounts: Account[];
  variant: string;
}) {
  const fmtDate = useDateFormat();
  const acc = accounts.find((a) => a.type === "bank") ?? accounts[0];
  const fmt = {
    fracDigits: acc?.currencyFracDigits ?? 2,
    decimalChar: acc?.currencyDecimalChar ?? ",",
    groupChar: acc?.currencyGroupChar ?? ".",
    symbol: acc?.currencySymbol ?? "€",
    symbolPrefix: acc?.currencySymbolPrefix ?? false,
  };
  const money = (v: number) => formatMinor(v, fmt);
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const [pick, setPick] = useState<Record<number, string | null>>({});

  const head = (r: Row) => (
    <>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <IconMail size={15} style={{ flexShrink: 0, opacity: 0.6 }} />
          <Text size="sm" fw={600} truncate>
            {r.memo}
          </Text>
        </Group>
        <Text size="sm" fw={600} ff="monospace" c={amountColor(r.amount)} style={{ flexShrink: 0 }}>
          {money(r.amount)}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {fmtDate(r.date)} · {acc?.name} · dalla mail, {r.days} giorni fa
        {r.category ? ` · ${r.category}` : ""}
      </Text>
    </>
  );

  const remove = (
    <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />}>
      Elimina
    </Button>
  );

  return (
    <Card withBorder data-testid="review-unconfirmed">
      <Stack gap="sm">
        <Stack gap={4}>
          <Text fw={600}>Non confermate dalla banca ({ROWS.length})</Text>
          <Text size="sm" c="dimmed" maw={720}>
            Lette da una mail, dopo 5 giorni la banca non le ha ancora confermate. Spesso l'addebito
            vero è diverso: un distributore che blocca 100 € e ne addebita 40, un albergo, un
            pagamento in valuta. <b>Unisci</b> tiene importo, data e riferimento della banca, e
            memo, categoria e tag della mail.
          </Text>
        </Stack>

        {ROWS.map((r) =>
          variant === "b" ? (
            <Box key={r.id} pt="sm" style={{ borderTop: RULE }}>
              {head(r)}
              <Group mt={8} gap="xs" align="flex-end" wrap="wrap">
                {r.cands.length > 0 ? (
                  <>
                    <Select
                      label="Unisci con la riga della banca"
                      size="xs"
                      w={{ base: "100%", sm: 420 }}
                      allowDeselect={false}
                      value={pick[r.id] ?? String(r.cands[0].id)}
                      onChange={(v) => setPick((p) => ({ ...p, [r.id]: v }))}
                      data={r.cands.map((c) => ({
                        value: String(c.id),
                        label: `${fmtDate(c.date)} · ${c.memo} · ${money(c.amount)}`,
                      }))}
                    />
                    <Button size="xs" variant="light" leftSection={<IconGitMerge size={14} />}>
                      Unisci
                    </Button>
                  </>
                ) : (
                  <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                    Nessuna riga della banca vicina: se il pagamento non c'è stato, eliminala.
                  </Text>
                )}
                {remove}
              </Group>
              {r.cands.length > 0 &&
                (() => {
                  const c =
                    r.cands.find((x) => String(x.id) === pick[r.id]) ?? r.cands[0];
                  return (
                    <Text size="xs" c="dimmed" mt={6}>
                      Resterà {money(c.amount)} del {fmtDate(c.date)}, dalla banca, con memo «
                      {r.memo}»{r.category ? ` e categoria ${r.category}` : ""}.
                    </Text>
                  );
                })()}
            </Box>
          ) : (
            <Box key={r.id} pt="sm" style={{ borderTop: RULE }}>
              {phone ? (
                head(r)
              ) : (
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                  <Box style={{ flex: 1, minWidth: 0 }}>{head(r)}</Box>
                  {remove}
                </Group>
              )}
              {r.cands.length > 0 ? (
                <Stack gap={0} mt={8} ml={21}>
                  <Text size="xs" c="dimmed" mb={2}>
                    Righe della banca vicine
                  </Text>
                  {r.cands.map((c) => (
                    <Group
                      key={c.id}
                      gap={phone ? "4px 12px" : "sm"}
                      wrap={phone ? "wrap" : "nowrap"}
                      py={6}
                      style={{ borderTop: "1px dashed var(--mantine-color-default-border)" }}
                    >
                      <IconBuildingBank size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                      <Text size="xs" ff="monospace" style={{ flexShrink: 0 }}>
                        {fmtDate(c.date)}
                      </Text>
                      <Text
                        size="xs"
                        truncate={!phone}
                        style={
                          phone
                            ? { flexBasis: "100%", order: 5, paddingLeft: 26 }
                            : { flex: 1, minWidth: 0 }
                        }
                      >
                        {c.memo}
                      </Text>
                      <Text
                        size="xs"
                        ff="monospace"
                        fw={600}
                        c={amountColor(c.amount)}
                        style={{ flexShrink: 0, marginLeft: phone ? "auto" : undefined }}
                      >
                        {money(c.amount)}
                      </Text>
                      <Button
                        size="compact-xs"
                        variant="light"
                        leftSection={<IconGitMerge size={13} />}
                        style={{ flexShrink: 0 }}
                      >
                        Unisci
                      </Button>
                    </Group>
                  ))}
                </Stack>
              ) : (
                <Text size="xs" c="dimmed" mt={6} ml={21}>
                  Nessuna riga della banca vicina: se il pagamento non c'è stato, eliminala.
                </Text>
              )}
              {phone && <Box mt={4}>{remove}</Box>}
            </Box>
          ),
        )}
      </Stack>
    </Card>
  );
}
