// PROTOTYPE (#595) — throwaway. Three ways to show six languages in the
// language selector, on the real login page and in Settings › General,
// switched by ?variant=A|B|C and the floating bar. Nothing here is saved: the
// choice lives in this component's state, and the app's own language is
// untouched (es/fr/de/pt-BR have no translations yet).
import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Group,
  Menu,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconCheck, IconChevronLeft, IconChevronRight, IconWorld } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

type Lang = { code: string; native: string; beta: boolean };

const LANGS: Lang[] = [
  { code: "en", native: "English", beta: false },
  { code: "it", native: "Italiano", beta: false },
  { code: "de", native: "Deutsch", beta: true },
  { code: "es", native: "Español", beta: true },
  { code: "fr", native: "Français", beta: true },
  { code: "pt-BR", native: "Português (Brasil)", beta: true },
];

// The invitation, in the language it invites: a German reader reads German.
const INVITE: Record<string, { text: string; link: string }> = {
  de: {
    text: "Diese Übersetzung ist neu. Wenn dir etwas falsch vorkommt, sag uns Bescheid.",
    link: "Korrektur vorschlagen",
  },
  es: {
    text: "Esta traducción es nueva. Si ves algo que no suena bien, avísanos.",
    link: "Sugerir una corrección",
  },
  fr: {
    text: "Cette traduction est nouvelle. Si quelque chose vous semble faux, dites-le-nous.",
    link: "Proposer une correction",
  },
  "pt-BR": {
    text: "Esta tradução é nova. Se algo parecer errado, avise a gente.",
    link: "Sugerir uma correção",
  },
};

const fixUrl = (code: string) =>
  `https://github.com/easly1989/cloudbank/issues/new?labels=translation&title=${encodeURIComponent(`[${code}] `)}`;

const byNative = (a: Lang, b: Lang) => a.native.localeCompare(b.native);
const find = (code: string) => LANGS.find((l) => l.code === code)!;

export const VARIANTS = ["A", "B", "C"] as const;
const NAMES: Record<string, string> = {
  A: "One list, beta badge",
  B: "Two groups",
  C: "Globe menu + cards",
};

export function usePrototypeVariant(): string | null {
  const [params] = useSearchParams();
  const v = params.get("variant");
  return import.meta.env.DEV && v && (VARIANTS as readonly string[]).includes(v) ? v : null;
}

function BetaBadge() {
  return (
    <Badge size="xs" variant="light" color="gray" radius="sm" tt="none" fw={500}>
      beta
    </Badge>
  );
}

function Invite({ code }: { code: string }) {
  const inv = INVITE[code];
  if (!inv) return null;
  return (
    <Text size="sm" c="dimmed">
      {inv.text}{" "}
      <Anchor href={fixUrl(code)} target="_blank" rel="noopener" size="sm">
        {inv.link}
      </Anchor>
    </Text>
  );
}

// --- The login page's compact switcher --------------------------------------

export function PrototypeLoginSwitcher({ variant }: { variant: string }) {
  const { i18n } = useTranslation();
  const [value, setValue] = useState(i18n.resolvedLanguage ?? "en");
  const it = i18n.resolvedLanguage === "it";

  if (variant === "C") {
    const names = new Intl.DisplayNames([i18n.resolvedLanguage ?? "en"], { type: "language" });
    return (
      <Menu position="bottom-end" width={240} withinPortal>
        <Menu.Target>
          <UnstyledButton aria-label="Language">
            <Group gap={6}>
              <IconWorld size={18} stroke={1.6} />
              <Text size="sm">{find(value).native}</Text>
            </Group>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          {[...LANGS.filter((l) => !l.beta), ...LANGS.filter((l) => l.beta).sort(byNative)].map(
            (l) => (
              <Menu.Item
                key={l.code}
                onClick={() => setValue(l.code)}
                rightSection={l.code === value ? <IconCheck size={14} /> : l.beta ? <BetaBadge /> : null}
              >
                <Text size="sm">{l.native}</Text>
                {l.code !== value && (
                  <Text size="xs" c="dimmed">
                    {names.of(l.code)}
                  </Text>
                )}
              </Menu.Item>
            ),
          )}
        </Menu.Dropdown>
      </Menu>
    );
  }

  const data =
    variant === "B"
      ? [
          { group: it ? "Complete" : "Complete", items: LANGS.filter((l) => !l.beta).map((l) => ({ value: l.code, label: l.native })) },
          { group: "Beta", items: LANGS.filter((l) => l.beta).sort(byNative).map((l) => ({ value: l.code, label: l.native })) },
        ]
      : [...LANGS].sort(byNative).map((l) => ({ value: l.code, label: l.native }));

  return (
    <Select
      aria-label="Language"
      size="sm"
      w={variant === "B" ? 190 : 210}
      allowDeselect={false}
      value={value}
      onChange={(v) => v && setValue(v)}
      data={data}
      rightSection={variant === "A" && find(value).beta ? <BetaBadge /> : undefined}
      rightSectionWidth={variant === "A" && find(value).beta ? 52 : undefined}
      renderOption={({ option }) => (
        <Group justify="space-between" w="100%" wrap="nowrap">
          <span>{option.label}</span>
          {variant === "A" && find(option.value).beta && <BetaBadge />}
        </Group>
      )}
    />
  );
}

// --- Settings › General -------------------------------------------------------

export function PrototypeSettingsLanguage({ variant, label }: { variant: string; label: string }) {
  const { i18n } = useTranslation();
  const [value, setValue] = useState(i18n.resolvedLanguage ?? "en");
  const it = i18n.resolvedLanguage === "it";
  const current = find(value);

  if (variant === "C") {
    const names = new Intl.DisplayNames([i18n.resolvedLanguage ?? "en"], { type: "language" });
    return (
      <Stack gap={8} style={{ gridColumn: "1 / -1" }}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Radio.Group value={value} onChange={setValue}>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
            {[...LANGS.filter((l) => !l.beta), ...LANGS.filter((l) => l.beta).sort(byNative)].map(
              (l) => (
                <Radio.Card key={l.code} value={l.code} radius="md" p="sm">
                  <Group wrap="nowrap" align="flex-start" gap="sm">
                    <Radio.Indicator mt={2} />
                    <Stack gap={2} style={{ flex: 1 }}>
                      <Group gap={6}>
                        <Text size="sm" fw={600}>
                          {l.native}
                        </Text>
                        {l.beta && <BetaBadge />}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {names.of(l.code)}
                      </Text>
                      {l.beta && l.code === value && (
                        <Anchor href={fixUrl(l.code)} target="_blank" rel="noopener" size="xs" mt={4}>
                          {INVITE[l.code].link}
                        </Anchor>
                      )}
                    </Stack>
                  </Group>
                </Radio.Card>
              ),
            )}
          </SimpleGrid>
        </Radio.Group>
      </Stack>
    );
  }

  if (variant === "B") {
    return (
      <Stack gap={8} style={{ gridColumn: "1 / -1", maxWidth: 560 }}>
        <Select
          label={label}
          maw={320}
          allowDeselect={false}
          value={value}
          onChange={(v) => v && setValue(v)}
          data={[
            { group: it ? "Complete" : "Complete", items: LANGS.filter((l) => !l.beta).map((l) => ({ value: l.code, label: l.native })) },
            { group: it ? "Beta, da migliorare insieme" : "Beta, help us improve them", items: LANGS.filter((l) => l.beta).sort(byNative).map((l) => ({ value: l.code, label: l.native })) },
          ]}
        />
        {current.beta && (
          <Alert variant="light" color="blue" radius="md" title={`${current.native} · beta`}>
            <Stack gap={6}>
              <Text size="sm">{INVITE[value].text}</Text>
              <Anchor href={fixUrl(value)} target="_blank" rel="noopener" size="sm" fw={500}>
                {INVITE[value].link}
              </Anchor>
            </Stack>
          </Alert>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap={6}>
      <Select
        label={label}
        allowDeselect={false}
        value={value}
        onChange={(v) => v && setValue(v)}
        data={[...LANGS].sort(byNative).map((l) => ({ value: l.code, label: l.native }))}
        rightSection={current.beta ? <BetaBadge /> : undefined}
        rightSectionWidth={current.beta ? 52 : undefined}
        renderOption={({ option }) => (
          <Group justify="space-between" w="100%" wrap="nowrap">
            <span>{option.label}</span>
            {find(option.value).beta && <BetaBadge />}
          </Group>
        )}
      />
      {current.beta && <Invite code={value} />}
    </Stack>
  );
}

// --- The floating switcher ------------------------------------------------------

export function PrototypeSwitcher({ current }: { current: string }) {
  const [params, setParams] = useSearchParams();
  const go = (step: number) => {
    const i = (VARIANTS.indexOf(current as (typeof VARIANTS)[number]) + step + VARIANTS.length) % VARIANTS.length;
    const next = new URLSearchParams(params);
    next.set("variant", VARIANTS[i]);
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <Group
      gap={4}
      style={{
        position: "fixed",
        left: "50%",
        bottom: 16,
        transform: "translateX(-50%)",
        zIndex: 10000,
        background: "#111",
        color: "#fff",
        borderRadius: 999,
        padding: "4px 8px",
        boxShadow: "0 4px 16px rgba(0,0,0,.3)",
      }}
      data-prototype-bar
    >
      <ActionIcon variant="subtle" color="gray.0" onClick={() => go(-1)} aria-label="Previous variant">
        <IconChevronLeft size={16} />
      </ActionIcon>
      <Text size="sm" fw={600} px={6}>
        {current} ({NAMES[current]})
      </Text>
      <ActionIcon variant="subtle" color="gray.0" onClick={() => go(1)} aria-label="Next variant">
        <IconChevronRight size={16} />
      </ActionIcon>
    </Group>
  );
}
