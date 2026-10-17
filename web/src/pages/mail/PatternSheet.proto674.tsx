// PROTOTYPE for #674, throwaway: never merged. Hardcoded panels that show two
// ways to make one pattern cover every variant of a bank's notice, switched by
// ?mock=674&v=a|b&s=1|2|3. Demo data only: the invented mails sent to the
// pretend mailbox by the mockup script.
import {
  Alert,
  Badge,
  Box,
  Button,
  CloseButton,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

export function mock674(): { v: string; s: number } | null {
  const q = new URLSearchParams(window.location.search);
  if (q.get("mock") !== "674") return null;
  return { v: q.get("v") ?? "a", s: Number(q.get("s") ?? 1) };
}

const CODE = {
  fontFamily: "var(--mantine-font-family-monospace)",
  fontSize: 12.5,
  background: "var(--mantine-color-default-hover)",
  borderRadius: 4,
  padding: "1px 5px",
  whiteSpace: "pre" as const,
};
const DIFF = {
  background: "var(--mantine-color-orange-light)",
  color: "var(--mantine-color-orange-light-color)",
  borderRadius: 3,
  padding: "0 2px",
  textDecoration: "underline wavy",
  textUnderlineOffset: 3,
};
const READ = {
  background: "var(--mantine-color-teal-light)",
  borderRadius: 3,
};

/** A visible space: the difference is often one. */
const Sp = () => (
  <span style={{ ...DIFF, textDecoration: "none", fontWeight: 600 }} title="uno spazio">
    ␣
  </span>
);

interface Row {
  when: string;
  ok: boolean;
  memo?: string;
  amount?: string;
  subject?: string;
  stop?: string;
  isNew?: boolean;
  open?: ReactNode;
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      {rows.map((r, i) => (
        <Box
          key={i}
          style={{ borderTop: i ? "1px solid var(--mantine-color-default-border)" : undefined }}
        >
          <UnstyledButton w="100%" px="sm" py={8}>
            <Group gap={8} wrap="nowrap" align="flex-start">
              {r.ok ? (
                <IconCheck size={16} color="var(--mantine-color-teal-6)" style={{ marginTop: 2 }} />
              ) : (
                <IconX size={16} color="var(--mantine-color-orange-6)" style={{ marginTop: 2 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6} wrap="nowrap" justify="space-between">
                  <Text size="sm" fw={500} truncate>
                    {r.ok ? r.memo : r.subject}
                  </Text>
                  {r.ok ? (
                    <Text size="sm" ff="monospace" c="red" style={{ flexShrink: 0 }}>
                      {r.amount}
                    </Text>
                  ) : r.open ? (
                    <IconChevronDown size={16} style={{ flexShrink: 0 }} />
                  ) : (
                    <IconChevronRight size={16} style={{ flexShrink: 0 }} />
                  )}
                </Group>
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    {r.when}
                  </Text>
                  {r.isNew && (
                    <Badge size="xs" variant="light" color="blue">
                      Nuova
                    </Badge>
                  )}
                  {!r.ok && (
                    <Text size="xs" c="orange.8" truncate>
                      {r.stop}
                    </Text>
                  )}
                </Group>
              </div>
            </Group>
          </UnstyledButton>
          {r.open && (
            <Box px="sm" pb="sm" pl={36}>
              {r.open}
            </Box>
          )}
        </Box>
      ))}
    </Paper>
  );
}

/** Where the pattern stops on the "effettuato" mail: at the card. */
function StopAtCard({ action }: { action: ReactNode }) {
  return (
    <Stack gap={8}>
      <Text size="xs" c="dimmed">
        Dove smette di corrispondere
      </Text>
      <Box
        p="xs"
        style={{
          fontSize: "var(--mantine-font-size-sm)",
          lineHeight: 1.8,
          background: "var(--mantine-color-default-hover)",
          borderRadius: 6,
        }}
      >
        …<span style={READ}>un pagamento di 41,00 EUR con la carta </span>
        <span style={DIFF}>1111_*_*_ 2222</span> presso FARMACIA DEMO .
      </Box>
      <Stack gap={4}>
        <Group gap={8} wrap="nowrap">
          <Text size="xs" c="dimmed" w={96} style={{ flexShrink: 0 }}>
            Lo schema cerca
          </Text>
          <span style={CODE}>1111_*_*_2222 presso</span>
        </Group>
        <Group gap={8} wrap="nowrap">
          <Text size="xs" c="dimmed" w={96} style={{ flexShrink: 0 }}>
            Questa mail ha
          </Text>
          <span style={CODE}>
            1111_*_*_
            <Sp />
            2222 presso
          </span>
        </Group>
      </Stack>
      {action}
    </Stack>
  );
}

/** Where it stops once the card is skipped: what follows the merchant. */
function StopAtEnding() {
  return (
    <Stack gap={8}>
      <Text size="xs" c="dimmed">
        Dove smette di corrispondere
      </Text>
      <Box
        p="xs"
        style={{
          fontSize: "var(--mantine-font-size-sm)",
          lineHeight: 1.8,
          background: "var(--mantine-color-default-hover)",
          borderRadius: 6,
        }}
      >
        …<span style={READ}>un pagamento di 41,00 EUR con la carta 1111_*_*_ 2222 presso </span>
        <span style={READ}>FARMACIA DEMO</span>
        <span style={DIFF}>␣.</span>
      </Box>
      <Stack gap={4}>
        <Text size="xs" c="dimmed">
          Dopo il commerciante:
        </Text>
        <Group gap={8} wrap="nowrap">
          <Text size="xs" c="dimmed" w={96} style={{ flexShrink: 0 }}>
            Lo schema cerca
          </Text>
          <span style={CODE}>, -</span>
        </Group>
        <Group gap={8} wrap="nowrap">
          <Text size="xs" c="dimmed" w={96} style={{ flexShrink: 0 }}>
            Questa mail ha
          </Text>
          <span style={CODE}>
            <Sp />.
          </span>
        </Group>
      </Stack>
      <Paper withBorder radius="md" p="xs" bg="var(--mantine-color-body)">
        <Text size="sm">La fine del commerciante cambia da una mail all&apos;altra.</Text>
        <Button
          mt={6}
          size="compact-sm"
          variant="light"
          leftSection={<IconWand size={14} />}
        >
          Accetta anche “ .”
        </Button>
      </Paper>
    </Stack>
  );
}

const READ_ROWS: Row[] = [
  { when: "oggi 17:56", ok: true, memo: "EDICOLA DEMO", amount: "-23,90 €" },
  { when: "oggi 08:12", ok: true, memo: "BAR DEMO", amount: "-12,50 €" },
];
const NEW_ROWS: Row[] = [
  { when: "oggi 12:30", ok: true, memo: "FARMACIA DEMO", amount: "-41,00 €", isNew: true },
  { when: "oggi 07:45", ok: true, memo: "PANETTERIA DEMO", amount: "-7,80 €", isNew: true },
  { when: "oggi 09:10", ok: true, memo: "CARBURANTI DEMO", amount: "-60,00 €", isNew: true },
];
const OTHER: Row = {
  when: "oggi 09:00",
  ok: false,
  subject: "Bonifico in arrivo",
  stop: "diversa dall'inizio: un altro tipo di avviso?",
};
const card = (open?: ReactNode, when = "oggi 12:30"): Row => ({
  when,
  ok: false,
  subject: "Pagamento con carta",
  stop: "si ferma alla carta",
  open,
});

/** Replaces the test line and its result. */
export function Proto674Test({ v, s }: { v: string; s: number }) {
  const done = (v === "a" && s >= 2) || (v === "b" && s >= 3);
  if (done) {
    return (
      <Stack gap="xs">
        <Alert color="teal" variant="light" p="xs" icon={<IconWand size={16} />}>
          <Text size="sm">Provato sulle ultime mail di questo mittente: 5 su 6 corrispondono.</Text>
        </Alert>
        <Text size="sm" fw={500}>
          Ora legge anche 3 mail che prima non leggeva: controllale
        </Text>
        <Rows rows={NEW_ROWS} />
        <Text size="sm" fw={500} mt={4}>
          Le altre mail provate
        </Text>
        <Rows rows={[...READ_ROWS, OTHER]} />
      </Stack>
    );
  }
  const action =
    v === "a" ? (
      <Stack gap={4}>
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconPlus size={14} />}
          style={{ alignSelf: "flex-start" }}
        >
          Segna i campi anche in questa mail
        </Button>
        <Text size="xs" c="dimmed">
          Lo schema terrà solo ciò che le mail segnate hanno in comune.
        </Text>
      </Stack>
    ) : (
      <Paper withBorder radius="md" p="xs" bg="var(--mantine-color-body)">
        <Text size="sm">La carta è scritta in due modi, e nessun campo la usa.</Text>
        <Button mt={6} size="compact-sm" variant="light" leftSection={<IconWand size={14} />}>
          Salta la carta
        </Button>
      </Paper>
    );
  const open = v === "b" && s === 2 ? <StopAtEnding /> : <StopAtCard action={action} />;
  const stop = v === "b" && s === 2 ? "si ferma dopo il commerciante" : "si ferma alla carta";
  return (
    <Stack gap="xs">
      <Alert color="yellow" variant="light" p="xs" icon={<IconWand size={16} />}>
        <Text size="sm">Provato sulle ultime mail di questo mittente: 2 su 6 corrispondono.</Text>
      </Alert>
      <Text size="sm" fw={500}>
        4 mail non sono lette: tocca una per vedere dove cambia
      </Text>
      <Rows
        rows={[
          { ...card(open), stop },
          { ...card(undefined, "oggi 07:45"), stop },
          { ...card(undefined, "oggi 09:10"), stop },
          OTHER,
          ...READ_ROWS,
        ]}
      />
    </Stack>
  );
}

/** Variant A, after a second mail: the samples the pattern is built from. */
export function Proto674Samples({ v, s }: { v: string; s: number }) {
  if (v !== "a" || s < 2) return null;
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        Mail di esempio
      </Text>
      <Group gap={6} wrap="nowrap">
        <SegmentedControl
          size="xs"
          value="2"
          data={[
            { value: "1", label: "1 · BAR DEMO" },
            { value: "2", label: "2 · FARMACIA DEMO" },
          ]}
          style={{ flex: 1 }}
        />
        <CloseButton size="sm" aria-label="Togli questa mail" />
      </Group>
      <Text size="xs" c="dimmed">
        Segna gli stessi campi in ogni mail: lo schema tiene ciò che hanno in comune.
      </Text>
    </Stack>
  );
}

/** Replaces the fields list in the later states. */
export function Proto674Fields({ v, s }: { v: string; s: number }) {
  if (v === "a" && s >= 2) {
    return (
      <Stack gap={6}>
        <Text size="sm" fw={500}>
          Campi
        </Text>
        {[
          ["Importo", "teal", "12,50", "41,00"],
          ["Note", "blue", "BAR DEMO", "FARMACIA DEMO"],
        ].map(([f, c, a, b]) => (
          <Group key={f} gap="xs" wrap="nowrap">
            <Badge color={c} variant="light" w={120} style={{ flexShrink: 0 }}>
              {f}
            </Badge>
            <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
              {a} <Text span c="dimmed">·</Text> {b}
            </Text>
          </Group>
        ))}
      </Stack>
    );
  }
  if (v === "b" && s >= 2) {
    return (
      <Stack gap={6}>
        <Text size="sm" fw={500}>
          Campi
        </Text>
        {[
          ["Importo", "teal", "12,50"],
          ["Note", "blue", "BAR DEMO"],
        ].map(([f, c, a]) => (
          <Group key={f} gap="xs" wrap="nowrap">
            <Badge color={c} variant="light" w={120} style={{ flexShrink: 0 }}>
              {f}
            </Badge>
            <Text size="sm">{a}</Text>
          </Group>
        ))}
        <Text size="sm" fw={500} mt={4}>
          Reso più tollerante
        </Text>
        <Group gap={6}>
          <Badge variant="outline" color="gray" rightSection={<IconX size={10} />} tt="none">
            Carta saltata
          </Badge>
          {s >= 3 && (
            <Badge variant="outline" color="gray" rightSection={<IconX size={10} />} tt="none">
              Fine del commerciante: “, -” o “ .”
            </Badge>
          )}
        </Group>
      </Stack>
    );
  }
  return null;
}
