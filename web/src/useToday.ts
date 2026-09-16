// Reactive "today". Transaction dates are ISO `YYYY-MM-DD`, and several views
// split rows into past/today/future by comparing against today's civil date.
// Capturing that once at mount (`new Date()` in a `useMemo(..., [])`) means a
// page left open across midnight keeps treating the new day's rows as "future"
// until a manual reload. `useToday` recomputes the date whenever the tab is
// refocused or becomes visible again, and via a timer to the next midnight, so
// the roll-over is picked up without an F5.
import { useEffect, useState } from "react";

import { msUntilLocalMidnight, todayCivil } from "./civilDate";

/** Current civil date as ISO `YYYY-MM-DD`, in the user's own timezone. */
export const todayISO = todayCivil;

export function useToday(): string {
  const [today, setToday] = useState(todayISO);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const sync = () => {
      setToday((prev) => {
        const now = todayISO();
        return now === prev ? prev : now;
      });
      schedule();
    };
    // Re-arm a one-shot timer for just after the next *local* midnight (when the
    // civil date flips). Chained rather than a fixed interval so it never drifts.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(sync, msUntilLocalMidnight());
    };
    const onVisible = () => {
      if (!document.hidden) sync();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    schedule();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return today;
}
