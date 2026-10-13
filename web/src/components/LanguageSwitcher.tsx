import { Badge, Group, Menu, Text, UnstyledButton } from "@mantine/core";
import { IconCheck, IconWorld } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { languageOf, orderedLanguages } from "../i18n/languages";
import { useLanguageNames } from "../i18n/useLanguageNames";

/** The word "beta", the same in every language, in a small grey badge (#595). */
export function BetaBadge() {
  return (
    <Badge size="xs" variant="light" color="gray" radius="sm" tt="none" fw={500}>
      beta
    </Badge>
  );
}

/**
 * The language control of the pages before sign-in (sign-in, setup, demo): a
 * globe and the language's name, opening a menu of every language (#595).
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = languageOf(i18n.resolvedLanguage);
  const nameIn = useLanguageNames();

  return (
    <Menu position="bottom" width={240} withinPortal>
      <Menu.Target>
        <UnstyledButton aria-label={t("actions.language")} px={8} py={4}>
          <Group gap={6} wrap="nowrap">
            <IconWorld size={18} stroke={1.6} />
            <Text size="sm">{current.name}</Text>
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {orderedLanguages().map((l) => {
          const chosen = l.code === current.code;
          return (
            <Menu.Item
              key={l.code}
              aria-current={chosen || undefined}
              onClick={() => void i18n.changeLanguage(l.code)}
              rightSection={chosen ? <IconCheck size={14} /> : l.beta ? <BetaBadge /> : undefined}
            >
              <Text size="sm" lang={l.code}>
                {l.name}
              </Text>
              {!chosen && (
                <Text size="xs" c="dimmed">
                  {nameIn(l.code)}
                </Text>
              )}
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}
