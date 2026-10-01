import { Button, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  deleteVehicle,
  getVehicleReport,
  listCurrencies,
  listVehicles,
} from "../api/client";
import { useConfirm } from "../components/confirmContext";
import { PageHeader } from "../components/PageHeader";
import { baseFmt } from "../components/reports/reportUtils";
import { formatMinor, formatNumber } from "../money";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import { lastTwelveMonths } from "./categories/categoryTree";
import { useDayMonth } from "./categories/labels";
import { lineOf, reportLink, type VehicleLine } from "./vehicles/vehicleList";
import classes from "./vehicles/vehicles.module.css";
import { VehicleSheet } from "./vehicles/VehicleSheet";
import {
  VehiclePhoneList,
  VehiclesEmpty,
  VehiclesLine,
  VehicleTable,
} from "./vehicles/VehicleTable";
import type { VehicleActions, VehicleFormat } from "./vehicles/vehicleWords";

/**
 * Vehicles (#574): what each car, motorbike or van cost to run over the last
 * twelve months — fuel, kilometres, the cost of one, litres per 100 km — from
 * the fuel payments linked to it and the odometer and litres in their memos.
 * The figures come from the same report as the Reports page's Vehicle tab.
 */
export function VehiclesPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const today = useToday();
  const day = useDayMonth(today);
  const year = lastTwelveMonths(today);

  const currencies = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const fmt = useMemo(() => baseFmt(currencies.data?.find((c) => c.isBase)), [currencies.data]);
  const format: VehicleFormat = {
    money: (minor) => formatMinor(minor, fmt),
    num: (value, digits = 1) => formatNumber(value, digits, fmt),
    day,
    today,
  };

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", walletId],
    queryFn: () => listVehicles(walletId),
    enabled: walletId > 0,
  });
  const vehicles = useMemo(() => vehiclesQuery.data ?? [], [vehiclesQuery.data]);

  // Two reports a vehicle: the last twelve months for its figures, and every
  // fill ever for its latest ones and for what deleting it would unlink.
  const reports = useQueries({
    queries: vehicles.flatMap((v) => [
      {
        queryKey: ["vehicle", walletId, v.id, year.from, year.to],
        queryFn: () => getVehicleReport(walletId, v.id, year.from, year.to),
        enabled: walletId > 0,
      },
      {
        queryKey: ["vehicle", walletId, v.id, null, null],
        queryFn: () => getVehicleReport(walletId, v.id),
        enabled: walletId > 0,
      },
    ]),
  });
  const ready = reports.every((q) => !q.isPending);
  const lines = vehicles.map((v, i) => lineOf(v, reports[2 * i]?.data, reports[2 * i + 1]?.data));

  const [sheet, setSheet] = useState<{ open: boolean; id: number | null }>({
    open: false,
    id: null,
  });
  const sheetLine = lines.find((l) => l.vehicle.id === sheet.id) ?? null;
  const closeSheet = () => setSheet((s) => ({ ...s, open: false }));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["vehicles", walletId] });
    void qc.invalidateQueries({ queryKey: ["vehicle", walletId] });
  };
  const remove = useMutation({
    mutationFn: (id: number) => deleteVehicle(walletId, id),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const askDelete = async (l: VehicleLine) => {
    const ok = await confirm({
      title: t("vehicles.confirmDeleteTitle", { name: l.vehicle.name }),
      body:
        l.linked > 0
          ? t("vehicles.confirmDeleteBody", { count: l.linked })
          : t("vehicles.confirmDeleteNone"),
      confirmLabel: t("vehicles.menu.delete"),
      danger: true,
    });
    if (ok) {
      closeSheet();
      remove.mutate(l.vehicle.id);
    }
  };

  const actions: VehicleActions = {
    onOpen: (l) => setSheet({ open: true, id: l.vehicle.id }),
    onReport: (l) => navigate(reportLink(l.vehicle.id)),
    onDelete: (l) => void askDelete(l),
  };
  const openNew = () => setSheet({ open: true, id: null });

  if (!currentWallet) return null;

  const empty = vehiclesQuery.isSuccess && vehicles.length === 0;
  const listProps = { lines, format, actions };

  return (
    <Stack className={classes.page} gap="md">
      <PageHeader
        tour="vehicles"
        title={t("vehicles.title")}
        hint={t("vehicles.hint")}
        actions={
          !empty && (
            <Button onClick={openNew} data-tour="vehicles-add">
              {t("vehicles.add")}
            </Button>
          )
        }
      />

      {empty ? (
        <VehiclesEmpty onAdd={openNew} />
      ) : (
        vehicles.length > 0 &&
        ready &&
        (phone ? (
          <>
            <VehiclePhoneList {...listProps} />
            <VehiclesLine short />
          </>
        ) : (
          <>
            <VehicleTable {...listProps} />
            <VehiclesLine />
          </>
        ))
      )}

      <VehicleSheet
        opened={sheet.open}
        onClose={closeSheet}
        walletId={walletId}
        line={sheetLine}
        others={vehicles.filter((v) => v.id !== sheet.id).map((v) => v.name)}
        format={format}
        onSaved={invalidate}
        onReport={actions.onReport}
        onDelete={actions.onDelete}
      />
    </Stack>
  );
}
