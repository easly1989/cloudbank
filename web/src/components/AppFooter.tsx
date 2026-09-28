import { Anchor, Box, Collapse, Group, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconExternalLink } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  API_DOCS_URL,
  DONATE_URL,
  GUIDE_URL,
  HOMEBANK_URL,
  SOURCE_URL,
  useVersion,
} from "../aboutLinks";

/**
 * The footer. As a fixed bar (a mouse, a wide screen) its links fit one line.
 * At the end of the page on a touch screen (`compact`) they would wrap to three
 * lines of 44px targets, so there it is one line — the version and the licence,
 * and "Links", which opens them as a list, one per row (#513). The list stays
 * open until it is closed: the footer is mounted once, not per page.
 */
export function AppFooter({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const version = useVersion();
  const [open, setOpen] = useState(false);
  const label = `${t("app.name")}${version ? ` ${version}` : ""} · AGPL-3.0`;

  if (compact) {
    const links = [
      { href: GUIDE_URL, label: t("app.guide") },
      { href: SOURCE_URL, label: t("app.sourceCode") },
      { href: API_DOCS_URL, label: t("app.apiDocs") },
      { href: DONATE_URL, label: t("app.donate") },
      { href: HOMEBANK_URL, label: t("app.basedOn"), dimmed: true },
    ];
    return (
      <Box className="cb-footer-compact">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="xs" c="dimmed" truncate>
            {label}
          </Text>
          <UnstyledButton
            className="cb-footer-toggle"
            aria-expanded={open}
            aria-controls="cb-footer-links"
            onClick={() => setOpen((o) => !o)}
          >
            {t("app.links")}
            <IconChevronDown
              size={16}
              style={{
                transform: open ? "rotate(180deg)" : undefined,
                transition: "transform 150ms",
              }}
            />
          </UnstyledButton>
        </Group>
        <Collapse expanded={open}>
          <div id="cb-footer-links">
            {links.map((l) => (
              <Anchor
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                size="sm"
                c={l.dimmed ? "dimmed" : undefined}
                className="cb-footer-link"
              >
                <span style={{ flex: 1 }}>{l.label}</span>
                <IconExternalLink size={14} style={{ opacity: 0.6 }} />
              </Anchor>
            ))}
          </div>
        </Collapse>
      </Box>
    );
  }

  return (
    <Group h="100%" px="md" gap="xs" justify="center">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        ·
      </Text>
      <Anchor size="xs" href={GUIDE_URL} target="_blank" rel="noreferrer">
        {t("app.guide")}
      </Anchor>
      <Text size="xs" c="dimmed">
        ·
      </Text>
      <Anchor size="xs" href={SOURCE_URL} target="_blank" rel="noreferrer">
        {t("app.sourceCode")}
      </Anchor>
      <Text size="xs" c="dimmed">
        ·
      </Text>
      <Anchor size="xs" href={API_DOCS_URL} target="_blank" rel="noreferrer">
        {t("app.apiDocs")}
      </Anchor>
      <Text size="xs" c="dimmed">
        ·
      </Text>
      <Anchor size="xs" href={DONATE_URL} target="_blank" rel="noreferrer">
        {t("app.donate")}
      </Anchor>
      <Text size="xs" c="dimmed">
        ·
      </Text>
      <Anchor size="xs" c="dimmed" href={HOMEBANK_URL} target="_blank" rel="noreferrer">
        {t("app.basedOn")}
      </Anchor>
    </Group>
  );
}
