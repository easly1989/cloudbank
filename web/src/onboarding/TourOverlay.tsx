import { Box, Button, Group, Paper, Text } from "@mantine/core";
import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { TOUR_STEPS } from "./steps";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 320;
const SPOTLIGHT_PAD = 6;

// Locate the on-screen rectangle of a step's target, or null when it isn't
// rendered or is hidden (e.g. the sidebar inside a closed mobile drawer).
function findRect(target?: string): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

// Position the step card next to its target (below if there's room, else above),
// clamped to the viewport; centred when there's no target.
function cardPosition(rect: Rect | null): CSSProperties {
  if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  const margin = 8;
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - CARD_WIDTH - margin);
  const spaceBelow = window.innerHeight - (rect.top + rect.height);
  if (spaceBelow > 220) return { top: rect.top + rect.height + 12, left };
  return { bottom: window.innerHeight - rect.top + 12, left };
}

export default function TourOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const current = TOUR_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TOUR_STEPS.length - 1;

  const next = () => (isLast ? onClose() : setStep((s) => s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Measure the current target on step change, resize and scroll; the timeout
  // catches layout that settles a tick after the step changes.
  useLayoutEffect(() => {
    const measure = () => setRect(findRect(current.target));
    measure();
    const id = window.setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [current.target]);

  // Keyboard navigation (no dep array so the handlers always see fresh state).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return createPortal(
    <>
      {/* Click-blocker so the app underneath can't be interacted with mid-tour. */}
      <Box style={{ position: "fixed", inset: 0, zIndex: 1999 }} />
      {rect ? (
        <Box
          style={{
            position: "fixed",
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            borderRadius: 8,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
            border: "2px solid var(--mantine-primary-color-filled)",
            pointerEvents: "none",
            zIndex: 2000,
            transition: "all 150ms ease",
          }}
        />
      ) : (
        <Box
          style={{ position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.55)", zIndex: 2000 }}
        />
      )}
      <Paper
        shadow="md"
        p="md"
        radius="md"
        withBorder
        style={{
          position: "fixed",
          width: CARD_WIDTH,
          maxWidth: "calc(100vw - 16px)",
          zIndex: 2001,
          ...cardPosition(rect),
        }}
      >
        <Text fw={700} mb={4}>
          {t(current.titleKey)}
        </Text>
        <Text size="sm" c="dimmed">
          {t(current.bodyKey)}
        </Text>
        <Group justify="space-between" mt="md">
          <Button variant="subtle" color="gray" size="xs" onClick={onClose}>
            {t("tour.skip")}
          </Button>
          <Group gap="xs">
            {!isFirst && (
              <Button variant="default" size="xs" onClick={back}>
                {t("tour.back")}
              </Button>
            )}
            <Button size="xs" onClick={next}>
              {isLast ? t("tour.finish") : t("tour.next")}
            </Button>
          </Group>
        </Group>
        <Text size="xs" c="dimmed" ta="center" mt="xs">
          {step + 1} / {TOUR_STEPS.length}
        </Text>
      </Paper>
    </>,
    document.body,
  );
}
