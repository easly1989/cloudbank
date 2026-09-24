import { Stack, Tabs } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { BalanceTab } from "../components/reports/BalanceTab";
import { StatisticsTab } from "../components/reports/StatisticsTab";
import { TrendTab } from "../components/reports/TrendTab";
import { VehicleTab } from "../components/reports/VehicleTab";
import { PageHeader } from "../components/PageHeader";

export function ReportsPage() {
  const { t } = useTranslation();
  return (
    <Stack>
      <PageHeader tour="reports" title={t("reports.title")} hint={t("reports.hint")} />
      <Tabs defaultValue="statistics">
        <Tabs.List data-tour="reports-tabs">
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
