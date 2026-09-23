import { useEffect, useRef, useState } from "react";

// The two pieces of motion the style tile asks for, and the one rule they both
// follow: they explain a change that already happened, and they are skipped
// entirely for a reader who has asked for less movement.
//
// Nothing here animates on first render. A number that counts up the moment a
// page loads is decoration; a number that counts up when a filter changes is
// telling you the filter did something.

/** Whether the reader has asked the system for less movement. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** How long a figure takes to travel from its old value to its new one. */
export const COUNT_MS = 420;

/**
 * A number that counts from where it was to where it is.
 *
 * The tile asks for this when a filter changes, and the reason is that the
 * figure is the answer to the filter: seeing it move says "this changed because
 * of what you just did" in a way a figure that simply swaps does not.
 *
 * The first value is not animated — there is nothing to count from — and a
 * reader who has asked for less movement always gets the number itself.
 *
 * The target is adopted during render rather than in an effect, so the figure
 * never paints its destination for a frame before setting off for it.
 */
export function useCountUp(value: number, ms = COUNT_MS): number {
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState({ target: value, shown: value });

  if (state.target !== value) {
    // React's own pattern for adjusting state when a prop changes: it re-runs
    // this render before painting, so nothing flickers. `shown` deliberately
    // stays where it was — that is the value the count starts from.
    setState({ target: value, shown: reduced ? value : state.shown });
  }

  useEffect(() => {
    const origin = state.shown;
    const delta = value - origin;
    if (reduced || delta === 0) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // Ease out: most of the distance early, so the figure reads as settling
      // rather than as a progress bar.
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      setState({ target: value, shown: t < 1 ? Math.round(origin + delta * eased) : value });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Re-running on every `shown` would restart the count from wherever it got
    // to; the effect belongs to a change of target, and reads `shown` once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms, reduced]);

  return state.shown;
}

/** How long a newly saved row holds its tint. */
export const ARRIVAL_MS = 1000;

/** A row that was just saved, and when. */
export interface Arrival {
  id: number;
  /** A fresh stamp per save, so saving the same row twice marks it twice. */
  at: number;
}

/** A save, stamped so that re-saving the same row counts as a new arrival. */
export function arrival(id: number): Arrival {
  return { id, at: Date.now() };
}

/**
 * The id of the row that just arrived, for as long as it should be marked.
 *
 * A saved transaction lands wherever the date order puts it, which on a long
 * register can be nowhere near where the reader was looking. The tint says
 * "there it is" and then stops saying it, because a mark that stays is a mark
 * the reader has to learn to ignore.
 */
export function useArrival(mark: Arrival | null, ms = ARRIVAL_MS): number | null {
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!mark) return;
    timer.current = setTimeout(() => setClearedAt(mark.at), ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mark, ms]);

  return mark && clearedAt !== mark.at ? mark.id : null;
}
