import { Anchor, Group, Radio, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";

import { correctionUrl, languages, orderedLanguages, type Language } from "../i18n/languages";
import { useLanguageNames } from "../i18n/useLanguageNames";
import { BetaBadge } from "./LanguageSwitcher";

/**
 * Settings › General's language choice: one card per language across the
 * whole row (3 columns on desktop, 2 in between, 1 on a phone). The chosen
 * card, when its language is a beta, carries the invitation to correct it, in
 * that language (#595, #604).
 */
export function LanguageCards({
  label,
  value,
  onChange,
  list = languages,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
  /** The languages to offer; tests pass their own. */
  list?: readonly Language[];
}) {
  const nameIn = useLanguageNames();
  return (
    <Radio.Group label={label} value={value} onChange={onChange} style={{ gridColumn: "1 / -1" }}>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm" mt={6}>
        {orderedLanguages(list).map((l) => (
          <Radio.Card key={l.code} value={l.code} radius="md" p="sm">
            <Group wrap="nowrap" align="flex-start" gap="sm">
              <Radio.Indicator mt={2} />
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6}>
                  <Text size="sm" fw={600} lang={l.code}>
                    {l.name}
                  </Text>
                  {l.beta && <BetaBadge />}
                </Group>
                <Text size="xs" c="dimmed">
                  {nameIn(l.code)}
                </Text>
                {l.beta && l.code === value && l.correction && (
                  <Anchor
                    href={correctionUrl(l.code)}
                    target="_blank"
                    rel="noopener"
                    size="xs"
                    mt={4}
                    lang={l.code}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Group gap={4} wrap="nowrap" component="span">
                      {l.correction}
                      <IconExternalLink size={12} />
                    </Group>
                  </Anchor>
                )}
              </Stack>
            </Group>
          </Radio.Card>
        ))}
      </SimpleGrid>
    </Radio.Group>
  );
}
