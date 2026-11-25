import { Button, Group, Text, ThemeIcon } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import type { AppUpdate } from "../appUpdate";
import classes from "./UpdateNotice.module.css";

const never = () => () => {};
const hidden = () => false;

// UpdateNotice says a new build is ready and lets the person choose when to
// switch (#578). It sits at the bottom left, over the page and clear of the
// side sheet, whose Save is at the bottom right; on a phone it spans the width.
export function UpdateNotice({ update }: { update: AppUpdate | null }) {
  const { t } = useTranslation();
  const visible = useSyncExternalStore(
    update?.subscribe ?? never,
    update?.visible ?? hidden,
    hidden,
  );
  const ref = useRef<HTMLDivElement>(null);
  const shown = !!update && visible;
  // The room the notice takes at the bottom of the screen (its height plus the
  // gap under it), so the page and the ledger can scroll their last lines clear.
  useEffect(() => {
    const el = ref.current;
    if (!shown || !el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => {
      root.setProperty("--cb-update-room", `${el.offsetHeight + 36}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty("--cb-update-room");
    };
  }, [shown]);
  if (!update || !visible) return null;

  return (
    <div ref={ref} className={classes.notice} role="status" aria-label={t("appUpdate.title")}>
      <ThemeIcon variant="light" radius="xl" size={28} className={classes.icon}>
        <IconRefresh size={16} />
      </ThemeIcon>
      <div>
        <Text fw={600} size="sm" lh="20px">
          {t("appUpdate.title")}
        </Text>
        <Text size="13px" lh="18px" c="dimmed">
          {t("appUpdate.body")}
        </Text>
        <Group gap={8} mt={10}>
          <Button size="xs" onClick={update.update}>
            {t("appUpdate.update")}
          </Button>
          <Button size="xs" variant="default" onClick={update.later}>
            {t("appUpdate.later")}
          </Button>
        </Group>
      </div>
    </div>
  );
}
