import { createContext, useContext, useEffect } from "react";

import type { TourId } from "./tours";

export interface TourContextValue {
  /** Run a page's tour now: the ? in its header. */
  start: (id: TourId) => void;
  /** A page is on screen whose tour may be offered; returns its withdrawal. */
  request: (id: TourId) => () => void;
  /** Forget every tour seen, so each page offers its own again. */
  resetAll: () => void;
}

export const TourContext = createContext<TourContextValue | undefined>(undefined);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within an OnboardingTourProvider");
  return ctx;
}

/**
 * Say that this page is showing, so its tour is offered the first time. The
 * offer is withdrawn when the page goes, so it never appears over the next one.
 */
export function usePageTour(id: TourId | undefined) {
  const ctx = useContext(TourContext);
  useEffect(() => (id && ctx ? ctx.request(id) : undefined), [id, ctx]);
}
