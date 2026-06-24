import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { TourContext } from "./tourContext";

// The visual overlay is loaded only when the tour actually runs, so the tour
// machinery stays out of the initial bundle.
const TourOverlay = lazy(() => import("./TourOverlay"));

// OnboardingTourProvider auto-runs the coachmark tour once per user (tracked
// server-side via preferences.tutorialSeen) and exposes start() so Settings can
// restart it. It renders no UI itself beyond the lazy overlay while running.
export function OnboardingTourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const autoStarted = useRef(false);

  const markSeen = useMutation({
    mutationFn: () =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), tutorialSeen: true } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });

  // Run automatically the first time a user who hasn't seen it lands in the app.
  useEffect(() => {
    if (!user || autoStarted.current) return;
    autoStarted.current = true;
    if (!user.preferences?.tutorialSeen) setRunning(true);
  }, [user]);

  const start = useCallback(() => setRunning(true), []);

  const close = useCallback(() => {
    setRunning(false);
    // Persist "seen" so the auto-run never fires again on any device; a manual
    // restart from Settings doesn't need to flip anything (it's already seen).
    if (!user?.preferences?.tutorialSeen) markSeen.mutate();
  }, [user, markSeen]);

  return (
    <TourContext.Provider value={{ start }}>
      {children}
      {running && (
        <Suspense fallback={null}>
          <TourOverlay onClose={close} />
        </Suspense>
      )}
    </TourContext.Provider>
  );
}
