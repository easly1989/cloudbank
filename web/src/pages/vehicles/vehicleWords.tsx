import { useTranslation } from "react-i18next";

import type { VehicleLine } from "./vehicleList";
import classes from "./vehicles.module.css";

export interface VehicleActions {
  onOpen: (l: VehicleLine) => void;
  onReport: (l: VehicleLine) => void;
  onDelete: (l: VehicleLine) => void;
}

/** How the page writes money, numbers and days. */
export interface VehicleFormat {
  money: (minor: number) => string;
  num: (value: number, digits?: number) => string;
  day: (date: string) => string;
  today: string;
}

/** A memo token, as it is typed: the `<code>` of the translations. */
export const code = <code className={classes.code} />;

/** The figures as the rows and the sheet write them. */
export function useFigures({ money, num }: VehicleFormat) {
  const { t } = useTranslation();
  return {
    distance: (l: VehicleLine) => `${num(l.distance, 0)} ${t("reports.unitDistance")}`,
    perKm: (l: VehicleLine) => (l.perKm == null ? "—" : money(l.perKm)),
    per100: (l: VehicleLine) =>
      l.consumption > 0 ? `${num(l.consumption)} ${t("reports.unitVolume")}` : "—",
  };
}
