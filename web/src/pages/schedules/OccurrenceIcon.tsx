import { IconAlertCircle, IconCalendarEvent, IconRepeat } from "@tabler/icons-react";

import type { ScheduleOccurrence } from "../../api/client";
import { STATUS_ICONS } from "../../components/statusIcons";
import { useOccurrenceLabel } from "./labels";

/**
 * The icon for where an occurrence stands: not registered yet, late, or the
 * status of the transaction it became — the status picker's own icons, so a
 * reconciled bill wears the register's lock.
 */
export function OccurrenceIcon({
  o,
  size = 13,
  upcoming = false,
}: {
  o: ScheduleOccurrence;
  size?: number;
  /** In "Next up", a schedule that registers itself says so. */
  upcoming?: boolean;
}) {
  const label = useOccurrenceLabel()(o);
  if (o.state === "overdue") return <IconAlertCircle size={size} aria-label={label} />;
  if (o.state === "due")
    return upcoming && o.autoPost ? (
      <IconRepeat size={size} aria-label={label} />
    ) : (
      <IconCalendarEvent size={size} aria-label={label} />
    );
  const Status = STATUS_ICONS[o.status ?? 0] ?? STATUS_ICONS[0];
  return <Status size={size} aria-label={label} />;
}
