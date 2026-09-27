import { Button, Group, Paper, Text } from "@mantine/core";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { TourId } from "./tours";

/**
 * The first-visit offer: a card in the corner, not a dialog. The page under it
 * stays usable — the reader came to do something, and a question that stands
 * in the way of it gets answered "no" without being read.
 */
export function TourOffer({
  id,
  steps,
  onAccept,
  onDecline,
}: {
  id: TourId;
  steps: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Paper
      component="section"
      className="cb-tour-offer"
      aria-labelledby={titleId}
      aria-live="polite"
      data-tour-offer={id}
      withBorder
      shadow="md"
      radius="md"
      p="md"
    >
      <Text id={titleId} fw={700} fz={15} mb={4}>
        {t(`tours.${id}.offer`)}
      </Text>
      <Text fz={13} c="dimmed">
        {t("tours.offerBody", { count: steps })}
      </Text>
      <Group justify="flex-end" gap="xs" mt="md">
        <Button variant="default" onClick={onDecline}>
          {t("tours.decline")}
        </Button>
        <Button onClick={onAccept}>{t("tours.accept", { count: steps })}</Button>
      </Group>
    </Paper>
  );
}

/**
 * Asked once, after the first offered tour the reader turns down or leaves
 * (#501): whether the other pages should stop offering theirs. Saying no page
 * by page was the only way before, and someone who does not want tours had to
 * say it on every page. The same corner card as the offer, for the same
 * reason: the page stays usable while it waits.
 */
export function TourSkipAsk({
  onOnlyThis,
  onSkipAll,
}: {
  onOnlyThis: () => void;
  onSkipAll: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Paper
      component="section"
      className="cb-tour-offer"
      aria-labelledby={titleId}
      aria-live="polite"
      data-tour-skip-ask
      withBorder
      shadow="md"
      radius="md"
      p="md"
    >
      <Text id={titleId} fw={700} fz={15} mb={4}>
        {t("tours.skipAsk.title")}
      </Text>
      <Text fz={13} c="dimmed">
        {t("tours.skipAsk.body")}
      </Text>
      <Group justify="flex-end" gap="xs" mt="md">
        <Button variant="default" onClick={onOnlyThis}>
          {t("tours.skipAsk.onlyThis")}
        </Button>
        <Button onClick={onSkipAll}>{t("tours.skipAsk.all")}</Button>
      </Group>
    </Paper>
  );
}
