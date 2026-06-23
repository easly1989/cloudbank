import { Anchor, Group, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getVersion } from "../api/client";

// AGPL-3.0 requires offering the running program's source; the footer links to
// it from every page. It also surfaces the build version, the API docs, a
// donation link and a credit to HomeBank (the desktop app CloudBank ports).
const SOURCE_URL = "https://github.com/easly1989/cloudbank";
const DONATE_URL = "https://paypal.me/carloruggiero";
const HOMEBANK_URL = "http://homebank.free.fr";

export function AppFooter() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ["version"], queryFn: getVersion, staleTime: Infinity });

  return (
    <Group h="100%" px="md" gap="xs" justify="center">
      <Text size="xs" c="dimmed">
        {t("app.name")}
        {data?.version ? ` ${data.version}` : ""} · AGPL-3.0
      </Text>
      <Text size="xs" c="dimmed">
        ·
      </Text>
      <Anchor size="xs" href={SOURCE_URL} target="_blank" rel="noreferrer">
        {t("app.sourceCode")}
      </Anchor>
      <Text size="xs" c="dimmed">
        ·
      </Text>
      <Anchor size="xs" href="/api/docs" target="_blank" rel="noreferrer">
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
