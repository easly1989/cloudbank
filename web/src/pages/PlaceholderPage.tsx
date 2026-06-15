import { Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

// Generic stub for routes whose feature ships in a later milestone.
export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t(titleKey)}</Title>
      <Text c="dimmed">Coming soon.</Text>
    </Stack>
  );
}
