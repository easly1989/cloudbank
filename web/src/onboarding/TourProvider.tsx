import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { updateMe, type Preferences, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { TourContext, type TourContextValue } from "./tourContext";
import { TourOffer } from "./TourOffer";
import { TOURS, toursSeen, type TourId } from "./tours";

// The visual overlay is loaded only when a tour actually runs, so the tour
// machinery stays out of the initial bundle.
const TourOverlay = lazy(() => import("./TourOverlay"));

// How long a page has to sit still — no dialog open, nothing loading, its
// first step's element present — before its tour is offered. An offer that
// arrives while the page is still assembling itself lands on the wrong thing.
const SETTLE_MS = 800;
const POLL_MS = 200;

function pageIsSettled(id: TourId): boolean {
  // Visible dialogs only: some modals stay mounted while closed, and their
  // roots are always in the page.
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  if ([...dialogs].some((d) => d.getClientRects().length > 0)) return false;
  if (document.querySelector("main .mantine-Loader-root")) return false;
  const first = TOURS[id].find((s) => s.target)?.target;
  return !first || !!document.querySelector(`[data-tour="${first}"]`);
}

/**
 * The page tours. Each covered page asks for its own when it shows
 * (usePageTour); the first time, a small card in the corner offers it, and
 * being offered is what counts as seen — the reader said yes, said no, or
 * walked away, and none of those wants the question again. The ? in the page's
 * header runs it any time after.
 */
export function OnboardingTourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState<TourId | null>(null);
  const [requested, setRequested] = useState<TourId | null>(null);
  const [offered, setOffered] = useState<TourId | null>(null);

  // Written from the latest copy of the preferences, not the one this render
  // saw: the reader may have changed another preference in between.
  const persist = useMutation({
    mutationFn: (patch: Partial<Preferences>) => {
      const latest = qc.getQueryData<User>(["me"])?.preferences ?? user?.preferences ?? {};
      return updateMe({ preferences: { ...latest, ...patch } });
    },
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });
  const { mutate } = persist;

  const seen = useMemo(() => toursSeen(user?.preferences), [user?.preferences]);
  const offersOn = user?.preferences?.tourOffers ?? true;

  // Offer the requested tour once the page has settled.
  useEffect(() => {
    if (!requested || running || offered || !offersOn || seen.includes(requested)) return;
    let stillFor = 0;
    const id = window.setInterval(() => {
      stillFor = pageIsSettled(requested) ? stillFor + POLL_MS : 0;
      if (stillFor < SETTLE_MS) return;
      window.clearInterval(id);
      setOffered(requested);
      mutate({ toursSeen: [...seen, requested], tutorialSeen: undefined });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [requested, running, offered, offersOn, seen, mutate]);

  const start = useCallback((id: TourId) => {
    setOffered(null);
    setRunning(id);
  }, []);

  const request = useCallback((id: TourId) => {
    setRequested(id);
    return () => {
      setRequested((r) => (r === id ? null : r));
      setOffered((o) => (o === id ? null : o));
    };
  }, []);

  const resetAll = useCallback(() => mutate({ toursSeen: [], tutorialSeen: undefined }), [mutate]);

  const value = useMemo<TourContextValue>(
    () => ({ start, request, resetAll }),
    [start, request, resetAll],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {offered && !running && (
        <TourOffer
          id={offered}
          steps={TOURS[offered].length}
          onAccept={() => start(offered)}
          onDecline={() => setOffered(null)}
        />
      )}
      {running && (
        <Suspense fallback={null}>
          <TourOverlay steps={TOURS[running]} onClose={() => setRunning(null)} />
        </Suspense>
      )}
    </TourContext.Provider>
  );
}
