import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from "react";

import { updateMe, type User } from "../api/client";
import { useSearchParams } from "react-router-dom";

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
  const [params, setParams] = useSearchParams();

  const markSeen = useMutation({
    mutationFn: () =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), tutorialSeen: true } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });

  // Run automatically the first time a user who hasn't seen it lands in the app,
  // and on demand when someone arrives from settings asking for it. The tour
  // points at things in the app's own shell, so it cannot run on the settings
  // screen — restarting it there is a trip back here.
  const asked = params.get("tour") === "1";
  const [decided, setDecided] = useState(false);
  if (user && !decided) {
    // Decided once, when the user arrives — during render, so the first frame of
    // the app already has the tour on it rather than showing the app and then
    // covering it.
    setDecided(true);
    if (asked || !user.preferences?.tutorialSeen) setRunning(true);
  }
  // Taking the marker back out of the URL is navigation, and stays in an effect.
  useEffect(() => {
    if (decided && asked) setParams({}, { replace: true });
  }, [decided, asked, setParams]);

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
