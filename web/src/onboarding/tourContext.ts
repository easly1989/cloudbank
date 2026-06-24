import { createContext, useContext } from "react";

export interface TourContextValue {
  /** Start (or restart) the onboarding tour. */
  start: () => void;
}

export const TourContext = createContext<TourContextValue | undefined>(undefined);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within an OnboardingTourProvider");
  return ctx;
}
