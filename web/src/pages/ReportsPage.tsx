import { Stack, Tabs, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { BalanceTab } from "../components/reports/BalanceTab";
import { StatisticsTab } from "../components/reports/StatisticsTab";
import { TrendTab } from "../components/reports/TrendTab";
import { VehicleTab } from "../components/reports/VehicleTab";

export function ReportsPage() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t("reports.title")}</Title>
      <Tabs defaultValue="statistics">
        <Tabs.List>
          <Tabs.Tab value="statistics">{t("reports.statistics")}</Tabs.Tab>
          <Tabs.Tab value="trend">{t("reports.trend")}</Tabs.Tab>
          <Tabs.Tab value="balance">{t("reports.balance")}</Tabs.Tab>
          <Tabs.Tab value="vehicle">{t("reports.vehicle")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="statistics" pt="md">
          <StatisticsTab />
        </Tabs.Panel>
        <Tabs.Panel value="trend" pt="md">
          <TrendTab />
        </Tabs.Panel>
        <Tabs.Panel value="vehicle" pt="md">
          <VehicleTab />
        </Tabs.Panel>
        <Tabs.Panel value="balance" pt="md">
          <BalanceTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
