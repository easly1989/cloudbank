import { SegmentedControl, Tooltip, VisuallyHidden } from "@mantine/core";
import {
  IconBan,
  IconBell,
  IconCheck,
  IconCircleDashed,
  IconLock,
  type Icon,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { STATUSES } from "../transactionEnums";

// One icon per reconcile status, in code order: none, cleared, reconciled,
// remind, void. The lock is the one the register already puts beside a
// reconciled row, so the two read as the same thing.
const STATUS_ICONS: Icon[] = [IconCircleDashed, IconCheck, IconLock, IconBell, IconBan];

/**
 * The status as a single choice drawn in icons. Each one is named for a screen
 * reader and on hover; the icons alone are the compact form the sheet asked for.
 */
export function StatusPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      className="cb-choice cb-status-picker"
      fullWidth
      aria-label={label ?? t("transactions.status")}
      value={value}
      onChange={onChange}
      data={STATUSES.map((s) => {
        const StatusIcon = STATUS_ICONS[s] ?? IconCircleDashed;
        const name = t(`status.${s}`);
        return {
          value: String(s),
          label: (
            <Tooltip label={name} openDelay={300}>
              <span className="cb-status-icon">
                <StatusIcon size={18} aria-hidden />
                <VisuallyHidden>{name}</VisuallyHidden>
              </span>
            </Tooltip>
          ),
        };
      })}
    />
  );
}
