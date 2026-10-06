import type { RegisterSWOptions } from "vite-plugin-pwa/types";

/** How often an open app asks the server whether a new build is out. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;

type Register = (options: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

export type AppUpdate = {
  subscribe: (listener: () => void) => () => void;
  /** A new build is ready and the person has not put it off. */
  visible: () => boolean;
  /** Switch to the new build: the page reloads. */
  update: () => void;
  /** Hide the notice until the next check. */
  later: () => void;
};

/**
 * Watches for a new build of the app and says so, instead of swapping it in
 * under an open page (#578). The new service worker waits until the person
 * chooses Update; nothing reloads by itself, so nothing typed is lost.
 *
 * An installed app on a phone stays in memory for days, so the check runs
 * every hour and whenever the app comes back to the foreground, not only when
 * a page is loaded by address.
 */
export function startAppUpdate(register: Register, win: Window = window): AppUpdate {
  const listeners = new Set<() => void>();
  let ready = false;
  let putOff = false;
  // Another tab chose Update first: the new build already runs this page's
  // service worker, and only a reload is left to do here.
  let activated = false;
  // This tab chose Update, so this tab is the one to reload.
  let chosen = false;
  let registration: ServiceWorkerRegistration | undefined;

  const emit = () => listeners.forEach((l) => l());
  const check = () => {
    // A notice put off comes back at the next check, still waiting.
    if (putOff) {
      putOff = false;
      emit();
    }
    registration?.update().catch(() => {
      // Offline, or the server is restarting: the next check tries again.
    });
  };

  const updateServiceWorker = register({
    onNeedRefresh() {
      ready = true;
      emit();
    },
    onNeedReload() {
      if (chosen) {
        win.location.reload();
        return;
      }
      // Not this tab's choice: keep what is on screen and leave the notice up.
      activated = true;
      ready = true;
      emit();
    },
    onRegisteredSW(_url, reg) {
      registration = reg;
      if (!reg) return;
      win.setInterval(check, CHECK_EVERY_MS);
      win.document.addEventListener("visibilitychange", () => {
        if (win.document.visibilityState === "visible") check();
      });
    },
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    visible: () => ready && !putOff,
    update() {
      chosen = true;
      if (activated) win.location.reload();
      else void updateServiceWorker();
    },
    later() {
      putOff = true;
      emit();
    },
  };
}

const RELOADED_AT = "cb-stale-chunk-reload";

/**
 * When a page's code cannot be loaded because a new build replaced it, reload
 * once onto the new build instead of showing the error (#578). The page never
 * opened, so there is no work on it to lose. A second failure within a few
 * seconds is a real one and reaches the error page, never a reload loop.
 */
export function reloadOnStaleChunk(win: Window = window, now = () => Date.now()) {
  win.addEventListener("vite:preloadError", (event) => {
    try {
      const last = Number(win.sessionStorage.getItem(RELOADED_AT) ?? 0);
      if (now() - last < 10_000) return;
      win.sessionStorage.setItem(RELOADED_AT, String(now()));
    } catch {
      // Without storage there is no guard against a loop: show the error.
      return;
    }
    event.preventDefault();
    win.location.reload();
  });
}
