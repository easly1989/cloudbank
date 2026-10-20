import { ActionIcon, Anchor, Box, Group, Text } from "@mantine/core";
import { IconSparkles, IconThumbDown, IconThumbUp } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AI_SETTINGS_KEY, getAISettings } from "../api/ai";
import classes from "./AiBox.module.css";

export type Feedback = -1 | 0 | 1;

/**
 * The one frame for anything the AI wrote (#696), so it is never mistaken for
 * CloudBank's own figures: a label, what it was based on and when, the text,
 * "Why?" opening the numbers behind it, and a thumb up or down.
 */
export function AiBox({
  label,
  basis,
  title,
  children,
  why,
  feedback,
  onFeedback,
  motion,
  actions,
}: {
  label: string;
  basis: string;
  title?: string;
  children: ReactNode;
  why?: ReactNode;
  feedback?: Feedback;
  onFeedback?: (f: Feedback) => void;
  /** Overrides the saved setting, for the preview beside the switch. */
  motion?: boolean;
  /** Buttons on the left of the foot: a proposal's Later and Ignore. */
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: getAISettings });
  const moving = motion ?? settings.data?.motion ?? true;
  const [showWhy, setShowWhy] = useState(false);
  const grad = useId();
  const thumb = (f: Feedback) => onFeedback?.(feedback === f ? 0 : f);
  return (
    <Box
      component="section"
      className={classes.box}
      data-motion={moving ? undefined : "off"}
      aria-label={label}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap" mb={8}>
        <Group gap={6} wrap="nowrap">
          <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
            <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--cb-ai-a)" />
              <stop offset="1" stopColor="var(--cb-ai-b)" />
            </linearGradient>
          </svg>
          <IconSparkles size={16} color={`url(#${grad})`} aria-hidden />
          <span className={classes.label}>{label}</span>
        </Group>
        <Text size="xs" c="dimmed" ta="right">
          {basis}
        </Text>
      </Group>
      {title && (
        <Text fw={650} fz={15} mb={6}>
          {title}
        </Text>
      )}
      <Box className={classes.body} fz={14} lh={1.55}>
        {children}
      </Box>
      {showWhy && why && <Box className={classes.why}>{why}</Box>}
      {(why || onFeedback || actions) && (
        <Group justify="space-between" mt={8} gap="xs">
          <Group gap={4}>
            {actions}
            {why ? (
              <Anchor
                component="button"
                type="button"
                fz="xs"
                aria-expanded={showWhy}
                onClick={() => setShowWhy((v) => !v)}
              >
                {showWhy ? t("ai.box.hideWhy") : t("ai.box.why")}
              </Anchor>
            ) : (
              <span />
            )}
          </Group>
          {onFeedback && (
            <Group gap={2}>
              <ActionIcon
                variant={feedback === 1 ? "light" : "subtle"}
                color={feedback === 1 ? "blue" : "gray"}
                size="sm"
                aria-label={t("ai.box.useful")}
                aria-pressed={feedback === 1}
                onClick={() => thumb(1)}
              >
                <IconThumbUp size={15} />
              </ActionIcon>
              <ActionIcon
                variant={feedback === -1 ? "light" : "subtle"}
                color={feedback === -1 ? "blue" : "gray"}
                size="sm"
                aria-label={t("ai.box.notUseful")}
                aria-pressed={feedback === -1}
                onClick={() => thumb(-1)}
              >
                <IconThumbDown size={15} />
              </ActionIcon>
            </Group>
          )}
        </Group>
      )}
    </Box>
  );
}
