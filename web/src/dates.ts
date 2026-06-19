// Date display helpers. Transaction dates are stored as ISO `YYYY-MM-DD`; the
// user's preference controls how they are rendered throughout the app.

import { useAuth } from "./auth/AuthProvider";

export const DATE_FORMATS = ["iso", "dmy", "mdy", "long"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Format an ISO `YYYY-MM-DD` date according to the given preference. */
export function formatDate(iso: string, fmt?: string): string {
  if (!iso || iso.length < 10) return iso;
  const [y, m, d] = iso.slice(0, 10).split("-");
  switch (fmt) {
    case "dmy":
      return `${d}/${m}/${y}`;
    case "mdy":
      return `${m}/${d}/${y}`;
    case "long":
      return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString();
    case "iso":
    default:
      return `${y}-${m}-${d}`;
  }
}

/** useDateFormat returns a formatter bound to the current user's preference. */
export function useDateFormat(): (iso: string) => string {
  const { user } = useAuth();
  const fmt = user?.preferences?.dateFormat;
  return (iso: string) => formatDate(iso, fmt);
}
