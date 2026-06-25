import { Box, Button, Group, Paper, Text } from "@mantine/core";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
const GAP = 12; // distance between the target and the card
const MARGIN = 12; // minimum distance from the viewport edge

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

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// Place the step card next to its target, choosing whichever side has room
// (below → above → right → left), then clamp it so the WHOLE card — and its
// buttons — always stay within the viewport and remain clickable. Centred when
// there's no target.
function cardPosition(rect: Rect | null, cardW: number, cardH: number): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxLeft = Math.max(MARGIN, vw - cardW - MARGIN);
  const maxTop = Math.max(MARGIN, vh - cardH - MARGIN);

  if (!rect) {
    return {
      top: clamp((vh - cardH) / 2, MARGIN, maxTop),
      left: clamp((vw - cardW) / 2, MARGIN, maxLeft),
    };
  }

  let top: number;
  let left: number;
  if (vh - (rect.top + rect.height) >= cardH + GAP + MARGIN) {
    // below
    top = rect.top + rect.height + GAP;
    left = rect.left;
  } else if (rect.top >= cardH + GAP + MARGIN) {
    // above
    top = rect.top - GAP - cardH;
    left = rect.left;
  } else if (vw - (rect.left + rect.width) >= cardW + GAP + MARGIN) {
    // right (e.g. a full-height sidebar target)
    left = rect.left + rect.width + GAP;
    top = rect.top;
  } else if (rect.left >= cardW + GAP + MARGIN) {
    // left
    left = rect.left - GAP - cardW;
    top = rect.top;
  } else {
    // no room on any side — overlay it but keep it fully on-screen below
    top = rect.top + rect.height + GAP;
    left = rect.left;
  }

  return { top: clamp(top, MARGIN, maxTop), left: clamp(left, MARGIN, maxLeft) };
}

export default function TourOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const current = TOUR_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TOUR_STEPS.length - 1;

  const next = () => (isLast ? onClose() : setStep((s) => s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Measure the target and the card on every step change, resize and scroll,
  // then compute a position that keeps the whole card on-screen. The card is
  // measured from its own ref, so its real height drives the clamping. The
  // timeout catches layout that settles a tick after the step changes.
  useLayoutEffect(() => {
    // Bring the target into view so both the spotlight and the card land in the
    // viewport (no-op for fixed header/sidebar targets already on screen).
    const el = current.target
      ? document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
      : null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });

    const measure = () => {
      const r = findRect(current.target);
      const card = cardRef.current;
      const cardW = card?.offsetWidth ?? CARD_WIDTH;
      const cardH = card?.offsetHeight ?? 220;
      setRect(r);
      setPos(cardPosition(r, cardW, cardH));
    };
    measure();
    const id = window.setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, current.target]);

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
        ref={cardRef}
        shadow="md"
        p="md"
        radius="md"
        withBorder
        style={{
          position: "fixed",
          width: CARD_WIDTH,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100vh - 24px)",
          overflowY: "auto",
          zIndex: 2001,
          // Hide until the first measurement so it never flashes off-screen.
          visibility: pos ? "visible" : "hidden",
          ...(pos ?? { top: 0, left: 0 }),
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
