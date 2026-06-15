import { Badge, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getHealth } from "../api/client";

export function DashboardPage() {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });

  const statusBadge = () => {
    if (health.isLoading) return <Badge color="gray">{t("dashboard.checking")}</Badge>;
    if (health.data?.status === "ok") return <Badge color="teal">{t("dashboard.online")}</Badge>;
    return <Badge color="red">{t("dashboard.offline")}</Badge>;
  };

  return (
    <Stack>
      <Title order={2}>{t("dashboard.title")}</Title>
      <Text c="dimmed">{t("dashboard.welcome")}</Text>
      <Card withBorder maw={360}>
        <Group justify="space-between">
          <Text fw={500}>{t("dashboard.backendStatus")}</Text>
          {statusBadge()}
        </Group>
      </Card>
    </Stack>
  );
}
