// PROTOTYPE — throwaway mockup for the bank-mail reading feature. Not wired to
// anything: every value below is made up. Shown only with ?mock=mail on
// /settings/integrations; ?open=connect|editor and ?v=a|b pick what opens.
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Collapse,
  CopyButton,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBrandWindows,
  IconCheck,
  IconCopy,
  IconDots,
  IconExternalLink,
  IconGripVertical,
  IconMail,
  IconPlus,
  IconRefresh,
  IconServer,
  IconWand,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { SideSheet } from "../../components/SideSheet";
import { SettingsGroup } from "./SettingsLayout";

const params = new URLSearchParams(window.location.search);
export const mailMockOn = params.get("mock") === "mail";
const variant = params.get("v") === "a" ? "a" : "b";

const SENDER = "comunicazioni@intesasanpaolo.com";
const SAMPLE_PARTS: { text: string; field?: Field }[] = [
  { text: "Gentile cliente, ti informiamo che in data 10.15 è stato richiesto un pagamento di " },
  { text: "6,43", field: "amount" },
  { text: " EUR con la carta " },
  { text: "1234_*_*_5678" },
  { text: " presso " },
  { text: "Supermercato Demo 0042", field: "memo" },
  { text: ", - 10.15 ore 17:56" },
];
const SAMPLE = SAMPLE_PARTS.map((p) => p.text).join("");

type Field = "amount" | "memo" | "card";
const FIELD: Record<Field, { label: string; color: string }> = {
  amount: { label: "Importo", color: "teal" },
  memo: { label: "Memo", color: "blue" },
  card: { label: "Carta → conto", color: "grape" },
};

export function MailIngestMock() {
  const [connectOpen, setConnectOpen] = useState(params.get("open") === "connect");
  const [editorOpen, setEditorOpen] = useState(params.get("open") === "editor");
  return (
    <SettingsGroup
      title="Mail della banca"
      hint="Legge le notifiche dei pagamenti da una cartella della tua casella e le inserisce come Verificate, prima che la banca le riconcili."
    >
      <ConnectCard onMicrosoft={() => setConnectOpen(true)} />
      <MailboxCard onNewModel={() => setEditorOpen(true)} />
      <ConnectModal opened={connectOpen} onClose={() => setConnectOpen(false)} />
      <ModelSheet opened={editorOpen} onClose={() => setEditorOpen(false)} />
    </SettingsGroup>
  );
}

function ConnectCard({ onMicrosoft }: { onMicrosoft: () => void }) {
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group gap="xs">
          <IconMail size={18} />
          <Title order={5}>Collega una casella</Title>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Paper withBorder p="sm" radius="md">
            <Group gap="xs" mb={4}>
              <IconBrandWindows size={16} />
              <Text fw={600} size="sm">
                Microsoft
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              Outlook.com, Hotmail, Live. Accedi a Microsoft e autorizzi la sola lettura della
              posta: CloudBank non vede la tua password.
            </Text>
            <Button size="xs" onClick={onMicrosoft}>
              Accedi con Microsoft
            </Button>
          </Paper>
          <Paper withBorder p="sm" radius="md">
            <Group gap="xs" mb={4}>
              <IconServer size={16} />
              <Text fw={600} size="sm">
                Altra casella
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              Gmail, Libero, Virgilio, iCloud, Yahoo, Fastmail, Aruba: con una password per app, mai
              quella del tuo account.
            </Text>
            <Button size="xs" variant="default">
              Collega con IMAP
            </Button>
          </Paper>
        </SimpleGrid>
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} p="sm">
          <Text size="sm">
            Chi ottiene questo accesso può leggere <b>tutta</b> la casella, non solo la cartella che
            scegli: nessun provider permette di limitarlo. CloudBank legge una sola cartella e non
            modifica nulla, ma per il massimo isolamento usa una casella dedicata alle mail della
            banca. Se pensi che l&apos;accesso sia stato rubato, revocalo dal tuo account.
          </Text>
        </Alert>
      </Stack>
    </Card>
  );
}

function MailboxCard({ onNewModel }: { onNewModel: () => void }) {
  return (
    <Card withBorder>
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon variant="light" size={36} radius="md">
              <IconBrandWindows size={20} />
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Text fw={600} truncate data-cb-sensitive>
                notifiche.demo@example.com
              </Text>
              <Badge variant="light" size="sm">
                Microsoft
              </Badge>
            </div>
          </Group>
          <Group gap={4} wrap="nowrap">
            <Button
              size="xs"
              variant="default"
              leftSection={<IconRefresh size={14} />}
              visibleFrom="sm"
            >
              Controlla ora
            </Button>
            <ActionIcon variant="default" hiddenFrom="sm" aria-label="Controlla ora">
              <IconRefresh size={16} />
            </ActionIcon>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" aria-label="Altro">
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item>Pausa</Menu.Item>
                <Menu.Item>Accedi di nuovo</Menu.Item>
                <Menu.Item color="red">Scollega</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
        <Group gap={6} wrap="nowrap" align="baseline">
          <Box w={8} h={8} bg="teal" style={{ borderRadius: 4, flexShrink: 0 }} />
          <Text size="xs" c="dimmed">
            In ascolto · ultima mail oggi 17:56 · controllo completo alle 18:10
          </Text>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
          <Select
            label="Cartella"
            data={["Posta in arrivo", "Banca", "Archivio"]}
            defaultValue="Banca"
            size="sm"
          />
          <Select
            label="Interpretazione"
            data={[
              "Solo i modelli",
              "Prima i modelli, poi l'AI",
              "Prima l'AI, poi i modelli",
              "Solo l'AI",
            ]}
            defaultValue="Prima i modelli, poi l'AI"
            size="sm"
          />
          <Select
            label="Il testo dell'AI va in"
            data={["Memo", "Beneficiario"]}
            defaultValue="Memo"
            size="sm"
          />
        </SimpleGrid>
        <Text size="xs" c="orange">
          Con l&apos;AI il testo delle mail della banca va al provider AI che hai configurato
          (numeri di carta e IBAN oscurati), e l&apos;AI può sbagliare importi o conti.
        </Text>

        <Divider />

        <Group justify="space-between">
          <Text fw={600}>Modelli</Text>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={onNewModel}
          >
            Nuovo modello
          </Button>
        </Group>
        <Stack gap={0}>
          <ModelRow
            name="Pagamento con carta"
            detail={`${SENDER} · uscita · memo · Conto corrente`}
            count="14 mail negli ultimi 30 giorni"
          />
          <ModelRow
            name="Bonifico in arrivo"
            detail={`${SENDER} · entrata · memo · Conto corrente`}
            count="2 mail negli ultimi 30 giorni"
          />
        </Stack>

        <Divider />

        <Text fw={600}>Ultime mail</Text>
        <Stack gap={0}>
          <HistoryRow
            when="oggi 17:56"
            what="Pagamento con carta"
            result={
              <Group gap={6} wrap="wrap">
                <Badge color="teal" variant="light" size="sm">
                  Creata
                </Badge>
                <Anchor size="sm" data-cb-sensitive>
                  −6,43 € · Supermercato Demo 0042
                </Anchor>
              </Group>
            }
          />
          <HistoryRow
            when="oggi 09:12"
            what="Addebito SEPA"
            result={
              <Group gap={6} wrap="nowrap">
                <Badge color="yellow" variant="light" size="sm">
                  Non riconosciuta
                </Badge>
                <Anchor size="sm" onClick={onNewModel}>
                  Crea un modello da questa mail
                </Anchor>
              </Group>
            }
          />
          <HistoryRow
            when="ieri 20:41"
            what="Pagamento con carta"
            result={
              <Group gap={6} wrap="nowrap">
                <Badge color="gray" variant="light" size="sm">
                  Doppione
                </Badge>
                <Text size="sm" c="dimmed">
                  già nel registro
                </Text>
              </Group>
            }
          />
        </Stack>
      </Stack>
    </Card>
  );
}

function ModelRow({ name, detail, count }: { name: string; detail: string; count: string }) {
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      py={8}
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
    >
      <IconGripVertical size={16} style={{ opacity: 0.45, flexShrink: 0, cursor: "grab" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={500}>
          {name}
        </Text>
        <Text size="xs" c="dimmed" truncate>
          {detail}
        </Text>
      </div>
      <Text size="xs" c="dimmed" visibleFrom="sm" style={{ flexShrink: 0 }}>
        {count}
      </Text>
    </Group>
  );
}

function HistoryRow({ when, what, result }: { when: string; what: string; result: ReactNode }) {
  return (
    <Group
      gap="xs"
      py={8}
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
      wrap="wrap"
    >
      <Text size="sm" c="dimmed" w={{ base: "100%", sm: 260 }}>
        {when} · {what}
      </Text>
      <div style={{ flex: 1, minWidth: 0 }}>{result}</div>
    </Group>
  );
}

function ConnectModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Accedi con Microsoft" centered size="md">
      <Stack gap="md">
        <Step n={1}>
          <Text size="sm">
            Apri la pagina di accesso di Microsoft, su questo o su un altro dispositivo.
          </Text>
          <Button
            size="xs"
            variant="default"
            mt={6}
            rightSection={<IconExternalLink size={14} />}
            component="a"
            href="#"
          >
            microsoft.com/devicelogin
          </Button>
        </Step>
        <Step n={2}>
          <Text size="sm">Inserisci questo codice:</Text>
          <Group gap="xs" mt={6}>
            <Code fz={22} fw={700} px="md" py={6} style={{ letterSpacing: 3 }}>
              K7QF-2MXP
            </Code>
            <CopyButton value="K7QF-2MXP">
              {({ copied, copy }) => (
                <ActionIcon variant="subtle" onClick={copy} aria-label="Copia il codice">
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              )}
            </CopyButton>
          </Group>
        </Step>
        <Step n={3}>
          <Text size="sm">
            Accedi con l&apos;account che riceve le mail della banca e autorizza CloudBank a{" "}
            <b>leggere la tua posta</b>. Nient&apos;altro: non può inviare, cancellare o spostare.
          </Text>
        </Step>
        <Group gap="xs" c="dimmed">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            In attesa dell&apos;autorizzazione · il codice scade tra 14:32
          </Text>
        </Group>
      </Stack>
    </Modal>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <Group gap="sm" align="flex-start" wrap="nowrap">
      <ThemeIcon size={24} radius="xl" variant="light">
        <Text size="xs" fw={700}>
          {n}
        </Text>
      </ThemeIcon>
      <div style={{ flex: 1 }}>{children}</div>
    </Group>
  );
}

function ModelSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      title="Nuovo modello"
      subtitle={variant === "a" ? "Variante A · modulo" : undefined}
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            Annulla
          </Button>
          <Button>Salva il modello</Button>
        </>
      }
    >
      {variant === "a" ? <EditorForm /> : <EditorHighlight />}
    </SideSheet>
  );
}

function Common() {
  return (
    <>
      <TextInput label="Nome" defaultValue="Pagamento con carta" />
      <TextInput label="Mittente" defaultValue={SENDER} />
    </>
  );
}

function Fixed() {
  return (
    <>
      <Select
        label="Conto"
        withAsterisk
        data={["Conto corrente", "Carta di credito", "Contanti"]}
        defaultValue="Conto corrente"
        description="Dove vanno le transazioni di questo modello."
      />
      <SimpleGrid cols={2} spacing="sm">
        <Select label="Direzione" data={["Uscita", "Entrata"]} defaultValue="Uscita" />
        <Select
          label="Tipo di pagamento"
          data={["Carta di debito", "Carta di credito", "Bonifico"]}
          defaultValue="Carta di debito"
        />
      </SimpleGrid>
      <Select
        label="Data"
        data={["Dalla mail (ora di arrivo)", "Dal testo"]}
        defaultValue="Dalla mail (ora di arrivo)"
      />
      <Switch label="Applica le regole di assegnazione" defaultChecked />
    </>
  );
}

function Preview() {
  return (
    <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-default-hover)">
      <Text size="xs" c="dimmed" mb={4}>
        Diventa
      </Text>
      <Group justify="space-between" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={500} truncate data-cb-sensitive>
            Supermercato Demo 0042
          </Text>
          <Text size="xs" c="dimmed">
            15/10/2026 · Conto corrente · Carta di debito · Spesa (da una regola)
          </Text>
        </div>
        <Stack gap={2} align="flex-end">
          <Text size="sm" fw={600} ff="monospace" c="red" data-cb-sensitive>
            −6,43
          </Text>
          <Badge size="xs" variant="light" color="teal">
            Verificata
          </Badge>
        </Stack>
      </Group>
    </Paper>
  );
}

function EditorForm() {
  const [syntax, setSyntax] = useState("simple");
  return (
    <>
      <Common />
      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            Testo del modello
          </Text>
          <SegmentedControl
            size="xs"
            value={syntax}
            onChange={setSyntax}
            data={[
              { value: "simple", label: "Semplice" },
              { value: "regex", label: "Espressione regolare" },
            ]}
          />
        </Group>
        <Textarea
          autosize
          minRows={2}
          ff="monospace"
          value={
            syntax === "simple"
              ? "pagamento di {importo} EUR con la carta {carta} presso {testo}, -"
              : "pagamento di (?P<importo>[\\d.,]+) EUR con la carta \\S*?(?P<carta>\\d{4}) presso (?P<testo>.+?), -"
          }
          readOnly
        />
      </Stack>
      <Textarea label="Mail di prova" autosize minRows={3} defaultValue={SAMPLE} />
      <Stack gap={6}>
        <Text size="sm" fw={500}>
          Catture
        </Text>
        <Capture name="importo" value="6,43" target="Importo" />
        <Capture name="carta" value="5678" target="Conto (carta 5678 → Conto corrente)" />
        <Capture name="testo" value="Supermercato Demo 0042" target="Memo" />
      </Stack>
      <Fixed />
      <Preview />
    </>
  );
}

function Capture({ name, value, target }: { name: string; value: string; target: string }) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Code w={84} ta="center" style={{ flexShrink: 0 }}>{`{${name}}`}</Code>
      <div style={{ minWidth: 0 }}>
        <Text size="sm" data-cb-sensitive>
          {value}
        </Text>
        <Text size="xs" c="dimmed">
          va in <b>{target}</b>
        </Text>
      </div>
    </Group>
  );
}

function EditorHighlight() {
  const [advanced, setAdvanced] = useState(false);
  return (
    <>
      <Common />
      <Stack gap={6}>
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            Seleziona nella mail cosa prendere
          </Text>
          <Text size="xs" c="dimmed">
            mail di oggi 09:12
          </Text>
        </Group>
        <Paper withBorder p="sm" radius="md" style={{ lineHeight: 1.9 }}>
          <Text size="sm" component="div">
            {SAMPLE_PARTS.map((p, i) =>
              p.field ? (
                <Mark key={i} field={p.field}>
                  {p.text}
                </Mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </Text>
        </Paper>
        <Paper withBorder shadow="sm" p={6} radius="md" w="fit-content">
          <Group gap={4}>
            <Text size="xs" c="dimmed" px={4}>
              «Supermercato Demo 0042» è:
            </Text>
            {["Importo", "Memo", "Beneficiario", "Data", "Carta"].map((l) => (
              <Button key={l} size="compact-xs" variant={l === "Memo" ? "light" : "subtle"}>
                {l}
              </Button>
            ))}
          </Group>
        </Paper>
      </Stack>
      <Stack gap={6}>
        <Text size="sm" fw={500}>
          Campi
        </Text>
        {(["amount", "memo"] as Field[]).map((f) => (
          <Group key={f} gap="xs" wrap="nowrap">
            <Badge color={FIELD[f].color} variant="light" w={120}>
              {FIELD[f].label}
            </Badge>
            <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }} data-cb-sensitive>
              {SAMPLE_PARTS.find((p) => p.field === f)?.text}
            </Text>
          </Group>
        ))}
        <Text size="xs" c="dimmed">
          Più carte con la stessa mail su conti diversi? Seleziona le cifre della carta e scegli un
          conto per ognuna.
        </Text>
      </Stack>
      <Fixed />
      <Alert color="teal" variant="light" p="xs" icon={<IconWand size={16} />}>
        <Text size="sm">Provato sulle ultime mail di questo mittente: 14 su 15 corrispondono.</Text>
      </Alert>
      <Preview />
      <Anchor size="sm" onClick={() => setAdvanced((a) => !a)}>
        {advanced ? "Nascondi il modello" : "Avanzate: vedi e modifica il modello"}
      </Anchor>
      <Collapse expanded={advanced}>
        <Textarea
          autosize
          ff="monospace"
          readOnly
          value="pagamento di (?P<importo>[\d.,]+) EUR con la carta .*? presso (?P<testo>.+?), -"
        />
      </Collapse>
    </>
  );
}

function Mark({ field, children }: { field: Field; children: ReactNode }) {
  const c = FIELD[field].color;
  return (
    <Box
      component="span"
      px={4}
      py={1}
      style={{
        background: `var(--mantine-color-${c}-light)`,
        color: `var(--mantine-color-${c}-light-color)`,
        borderRadius: 4,
        fontWeight: 500,
      }}
      title={FIELD[field].label}
    >
      {children}
    </Box>
  );
}
