import { ActionIcon, Tooltip } from "@mantine/core";
import { IconHelp } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { useTour } from "./tourContext";
import type { TourId } from "./tours";

/**
 * The ? among a page's header actions: its tour, again, whenever asked. The
 * boards draw no such button; it is listed in docs/design/README.md. `round`
 * is the phone's version beside the title: the icon alone, with no frame, so
 * it reads as part of the title line. A touch screen still gives it the app's
 * 44px target (app.css); only the drawing is lighter.
 */
export function TourButton({
  id,
  size,
  round = false,
}: {
  id: TourId;
  size: number;
  round?: boolean;
}) {
  const { t } = useTranslation();
  const { start } = useTour();
  return (
    <Tooltip label={t("tours.replay")} openDelay={300}>
      <ActionIcon
        variant={round ? "subtle" : "default"}
        color={round ? "gray" : undefined}
        size={size}
        radius={round ? "xl" : undefined}
        aria-label={t("tours.replay")}
        data-tour-replay={id}
        onClick={() => start(id)}
      >
        <IconHelp size={round ? 20 : 18} />
      </ActionIcon>
    </Tooltip>
  );
}
