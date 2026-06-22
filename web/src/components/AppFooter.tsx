import { Anchor, Group, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getVersion } from "../api/client";

// AGPL-3.0 requires offering the running program's source; the footer links to
// it from every page. It also surfaces the build version and the API docs.
const SOURCE_URL = "https://github.com/easly1989/cloudbank";

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
    </Group>
  );
}
