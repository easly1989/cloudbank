// The Vehicles page's model (#574): what each vehicle cost to run over the last
// twelve months, read from the vehicle report its rows already have, and the
// fills ever linked to it. Pure: no React, no translations.
import type { Vehicle, VehicleEntry, VehicleReport } from "../../api/client";

/** How many fills the sheet lists, newest first. */
export const RECENT_FILLS = 5;

export interface VehicleLine {
  vehicle: Vehicle;
  /** Fills in the last twelve months, and what they add up to. */
  fills: number;
  /** Base currency minor units. */
  cost: number;
  /** Kilometres, from the odometer readings in the memos. */
  distance: number;
  /** Minor units a kilometre, rounded; null without a distance. */
  perKm: number | null;
  /** Litres per 100 km between full fills; 0 until two full fills in a row. */
  consumption: number;
  /** Every fill ever linked: what deleting the vehicle unlinks. */
  linked: number;
  /** The newest fills ever, newest first. */
  recent: VehicleEntry[];
}

export function lineOf(
  vehicle: Vehicle,
  year: VehicleReport | undefined,
  all: VehicleReport | undefined,
): VehicleLine {
  const fills = year?.entries.length ?? 0;
  const cost = year?.totalCost ?? 0;
  const distance = year?.totalDistance ?? 0;
  const entries = all?.entries ?? [];
  return {
    vehicle,
    fills,
    cost,
    distance,
    perKm: distance > 0 ? Math.round(cost / distance) : null,
    consumption: year?.avgConsumption ?? 0,
    linked: entries.length,
    recent: entries.slice(-RECENT_FILLS).reverse(),
  };
}

/** The newest fill ever, or null when nothing is linked yet. */
export const lastFill = (l: VehicleLine): VehicleEntry | null => l.recent[0] ?? null;

/** Whole days from one civil date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Where the Reports page shows the vehicle fill by fill. */
export const reportLink = (vehicleId: number) => `/reports?tab=vehicle&v=${vehicleId}`;
