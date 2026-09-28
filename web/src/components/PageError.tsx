import { Anchor, Box, Button, Code, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconExclamationMark, IconExternalLink } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { SOURCE_URL } from "../aboutLinks";

// A blank issue, on purpose: the error text can carry the reader's own data (a
// payee, an amount), so nothing is filled in on their behalf.
const REPORT_URL = `${SOURCE_URL}/issues/new`;

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * What a page shows when it breaks while rendering (#518): what happened, that
 * nothing was lost, and the ways out. Inside the app the shell stays around it;
 * `fullPage` is for when the shell itself is what broke.
 */
export function PageError({ error, fullPage = false }: { error: unknown; fullPage?: boolean }) {
  const { t } = useTranslation();

  return (
    <Box
      role="alert"
      className="cb-page-error"
      mih={fullPage ? "100vh" : undefined}
      px={fullPage ? "md" : undefined}
      py={fullPage ? 48 : 24}
      maw={fullPage ? 600 : undefined}
      mx={fullPage ? "auto" : undefined}
    >
      <Stack gap={0} maw={520}>
        <ThemeIcon size={44} radius="xl" color="red" variant="light" aria-hidden>
          <IconExclamationMark size={24} stroke={2.5} />
        </ThemeIcon>
        <Title order={2} fz={22} fw={700} mt={16} mb={6}>
          {t("pageError.title")}
        </Title>
        <Text c="dimmed">{t("pageError.body")}</Text>
        <Code block mt={16} fz={12.5} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {describe(error)}
        </Code>
        <Group gap={10} mt={20}>
          <Button h={44} onClick={() => window.location.reload()}>
            {t("pageError.reload")}
          </Button>
          {/* With no shell left, "the dashboard" means loading the app again. */}
          {fullPage ? (
            <Button h={44} variant="default" component="a" href="/">
              {t("pageError.home")}
            </Button>
          ) : (
            <Button h={44} variant="default" component={Link} to="/">
              {t("pageError.home")}
            </Button>
          )}
        </Group>
        <Anchor
          href={REPORT_URL}
          target="_blank"
          rel="noreferrer"
          mt={16}
          fw={500}
          className="cb-page-error-report"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
        >
          {t("pageError.report")}
          <IconExternalLink size={14} />
        </Anchor>
      </Stack>
    </Box>
  );
}
