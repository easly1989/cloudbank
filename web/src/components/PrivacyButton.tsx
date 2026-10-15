import { ActionIcon, Tooltip } from "@mantine/core";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { togglePrivacy, usePrivacy } from "../privacy";

/**
 * The eye beside the ? in every page header but Settings' (#626): privacy mode
 * on and off for the whole app. It stays filled while the mode is on, so a
 * page with blurred figures says why. `round` is the phone's version on the
 * title line, drawn like the ? beside it.
 */
export function PrivacyButton({ size, round = false }: { size: number; round?: boolean }) {
  const { t } = useTranslation();
  const on = usePrivacy();
  const label = t(on ? "privacy.show" : "privacy.hide");
  return (
    <Tooltip label={label} openDelay={300}>
      <ActionIcon
        variant={on ? "filled" : round ? "subtle" : "default"}
        color={round && !on ? "gray" : undefined}
        size={size}
        radius={round ? "xl" : undefined}
        aria-label={label}
        aria-pressed={on}
        data-testid="privacy-toggle"
        onClick={togglePrivacy}
      >
        {on ? <IconEyeOff size={round ? 20 : 18} /> : <IconEye size={round ? 20 : 18} />}
      </ActionIcon>
    </Tooltip>
  );
}
