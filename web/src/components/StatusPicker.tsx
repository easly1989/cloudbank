import { SegmentedControl, Tooltip, VisuallyHidden } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { STATUSES } from "../transactionEnums";
import { STATUS_ICONS } from "./statusIcons";

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
        const StatusIcon = STATUS_ICONS[s] ?? STATUS_ICONS[0];
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
