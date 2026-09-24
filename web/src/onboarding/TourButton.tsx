import { ActionIcon, Tooltip } from "@mantine/core";
import { IconHelp } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { useTour } from "./tourContext";
import type { TourId } from "./tours";

/**
 * The ? among a page's header actions: its tour, again, whenever asked. The
 * boards draw no such button; it is listed in docs/design/README.md.
 */
export function TourButton({ id, size }: { id: TourId; size: number }) {
  const { t } = useTranslation();
  const { start } = useTour();
  return (
    <Tooltip label={t("tours.replay")} openDelay={300}>
      <ActionIcon
        variant="default"
        size={size}
        aria-label={t("tours.replay")}
        data-tour-replay={id}
        onClick={() => start(id)}
      >
        <IconHelp size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
