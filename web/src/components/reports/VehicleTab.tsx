import { Group, Select, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type VehicleReport,
  getVehicleReport,
  listCurrencies,
  listVehicles,
} from "../../api/client";
import { useDateFormat } from "../../dates";
import { formatMinor } from "../../money";
import { useWallet } from "../../wallet/WalletProvider";
import { baseFmt } from "./reportUtils";

export function VehicleTab() {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", walletId],
    queryFn: () => listVehicles(walletId),
    enabled: walletId > 0,
  });
  const currenciesQuery = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const base = (currenciesQuery.data ?? []).find((c) => c.isBase);

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["vehicle", walletId, vehicleId],
    queryFn: () => getVehicleReport(walletId, Number(vehicleId)),
    enabled: walletId > 0 && !!vehicleId,
  });
  const report: VehicleReport | undefined = query.data;
  const fmt = useMemo(() => baseFmt(report?.currency ?? base), [report?.currency, base]);

  const num = (v: number, digits = 1) =>
    v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  return (
    <Stack>
      <Group align="flex-end">
        <Select
          label={t("reports.vehicle")}
          placeholder={t("reports.pickVehicle")}
          data={(vehiclesQuery.data ?? []).map((v) => ({ value: String(v.id), label: v.name }))}
          value={vehicleId}
          onChange={setVehicleId}
          searchable
          clearable
          w={280}
        />
      </Group>

      {report && (
        <Group gap="xl">
          <Stat
            label={t("reports.distance")}
            value={`${num(report.totalDistance, 0)} ${t("reports.unitDistance")}`}
          />
          <Stat
            label={t("reports.volume")}
            value={`${num(report.totalVolume)} ${t("reports.unitVolume")}`}
          />
          <Stat
            label={t("reports.consumption")}
            value={`${num(report.avgConsumption)} ${t("reports.unitConsumption")}`}
          />
          <Stat label={t("reports.totalCost")} value={formatMinor(report.totalCost, fmt)} />
          <Stat
            label={t("reports.costPerDistance")}
            value={
              report.totalDistance > 0
                ? `${formatMinor(Math.round(report.totalCost / report.totalDistance), fmt)} / ${t("reports.unitDistance")}`
                : "—"
            }
          />
        </Group>
      )}

      {report && report.entries.length === 0 && vehicleId && (
        <Text c="dimmed">{t("reports.empty")}</Text>
      )}

      {report && report.entries.length > 0 && (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("transactions.date")}</Table.Th>
              <Table.Th ta="right">{t("reports.meter")}</Table.Th>
              <Table.Th ta="right">{t("reports.distance")}</Table.Th>
              <Table.Th ta="right">{t("reports.volume")}</Table.Th>
              <Table.Th ta="right">{t("reports.consumption")}</Table.Th>
              <Table.Th ta="right">{t("reports.amount")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {report.entries.map((e) => (
              <Table.Tr key={e.transactionId}>
                <Table.Td>{fmtDate(e.date)}</Table.Td>
                <Table.Td ta="right">{num(e.meter, 0)}</Table.Td>
                <Table.Td ta="right">{e.distance > 0 ? num(e.distance, 0) : "—"}</Table.Td>
                <Table.Td ta="right">
                  {e.partial ? (
                    <Text span c="dimmed">
                      {t("reports.partial")}
                    </Text>
                  ) : (
                    num(e.volume)
                  )}
                </Table.Td>
                <Table.Td ta="right">{e.consumption > 0 ? num(e.consumption) : "—"}</Table.Td>
                <Table.Td ta="right">{formatMinor(e.cost, fmt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
    </div>
  );
}
