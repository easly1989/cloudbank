import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import classes from "./FigureStrip.module.css";

/** How long each figure holds before the strip moves to the next. */
export const STEP_MS = 4000;

/**
 * A row of figures that keeps to one line (#503).
 *
 * When they fit, it is a plain row, as on a desktop. When they do not — three
 * balances on a phone, or the overview's five — it becomes a strip one figure
 * high that steps to the next figure every four seconds and starts over at the
 * end, with dots saying which one is showing. It steps rather than glides: a
 * number that is moving cannot be read.
 *
 * A finger on it stops it for as long as the page is open, and a swipe scrolls
 * it by hand; focus from the keyboard stops it too. With reduced motion asked
 * for, it never moves by itself and is simply a strip to scroll.
 *
 * Only a phone gets the strip. Wider screens wrap the figures onto a second
 * line as before: there is room for that, and nothing there should move.
 */
export function FigureStrip({
  children,
  gap = 24,
  align = "flex-start",
  style,
  label,
}: {
  children: ReactNode;
  gap?: number;
  align?: CSSProperties["alignItems"];
  style?: CSSProperties;
  /** What the figures are, for a screen reader. */
  label?: string;
}) {
  const { t } = useTranslation();
  const items = Children.toArray(children).filter(Boolean);
  const count = items.length;
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const [overflows, setOverflows] = useState(false);
  const [current, setShown] = useState(0);
  // The same index, for the timer, which must not restart on every step.
  const currentRef = useRef(0);
  const setCurrent = useCallback((i: number) => {
    currentRef.current = i;
    setShown(i);
  }, []);
  const [stopped, setStopped] = useState(false);

  // Whether the figures fit is measured, not guessed from the screen: two
  // short balances fit a phone, five long ones may not fit a narrow window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(phone && el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  }, [count, phone]);

  const figures = useCallback(() => Array.from(ref.current?.children ?? []) as HTMLElement[], []);

  const scrollToFigure = useCallback(
    (i: number, smooth: boolean) => {
      const el = ref.current;
      const all = figures();
      if (!el || !all[i]) return;
      el.scrollTo({
        left: all[i].offsetLeft - all[0].offsetLeft,
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [figures],
  );

  // Which figure is at the start of the strip, for the dots. At the far end
  // the last one counts as showing even though it cannot scroll to the start.
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) {
      setCurrent(count - 1);
      return;
    }
    const all = figures();
    const x = el.scrollLeft + (all[0]?.offsetLeft ?? 0);
    let best = 0;
    all.forEach((f, i) => {
      if (Math.abs(f.offsetLeft - x) < Math.abs(all[best].offsetLeft - x)) best = i;
    });
    setCurrent(best);
  };

  const moving = overflows && !stopped && !reduced && count > 1;
  useEffect(() => {
    if (!moving) return;
    const id = window.setInterval(() => {
      const el = ref.current;
      if (!el) return;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      const next = atEnd ? 0 : Math.min(currentRef.current + 1, count - 1);
      setCurrent(next);
      scrollToFigure(next, true);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [moving, count, scrollToFigure, setCurrent]);

  const stop = () => setStopped(true);

  return (
    <div className={classes.wrap} style={style}>
      <div
        ref={ref}
        className={classes.strip}
        data-wrap={!phone || undefined}
        data-ticker={overflows || undefined}
        data-moving={moving || undefined}
        style={{ gap, alignItems: align }}
        role={label ? "group" : undefined}
        aria-label={label}
        onPointerDown={stop}
        onTouchStart={stop}
        onWheel={stop}
        onFocus={stop}
        onScroll={onScroll}
      >
        {items}
      </div>
      {overflows && count > 1 && (
        <div className={classes.dots}>
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              className={classes.dot}
              data-on={i === current || undefined}
              aria-label={t("figureStrip.show", { n: i + 1, count })}
              aria-current={i === current || undefined}
              onClick={() => {
                stop();
                setCurrent(i);
                scrollToFigure(i, !reduced);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
