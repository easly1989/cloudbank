import { useSyncExternalStore } from "react";

// Privacy mode (#626): for showing CloudBank to someone without showing what
// you earn and spend. It hides amounts, balances, totals, memos, notes and
// payees across the app, and leaves dates, categories, account names and the
// shape of every page legible, so whoever is looking still sees how it works.
//
// It is one class on <html>, not on the shell: modals, sheets and tooltips
// render in portals outside it, and they carry figures too. Each sensitive
// element carries `data-cb-sensitive`, and app.css blurs it under the class.
//
// It is remembered on this device until it is turned off — a page that reloads
// while the app is on show must not bring the figures back — and deliberately
// not in the server's preferences: being private on a laptop on show says
// nothing about the phone in your pocket.

const KEY = "cb.privacy";
const CLASS = "cb-private";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = read();
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.classList.toggle(CLASS, on);
}
apply();

export function setPrivacy(next: boolean) {
  on = next;
  try {
    if (next) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the mode still works until the page reloads.
  }
  apply();
  listeners.forEach((l) => l());
}

export const togglePrivacy = () => setPrivacy(!on);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePrivacy(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => on,
    () => false,
  );
}

/** Props that mark an element as sensitive: spread onto it. */
export const sensitive = { "data-cb-sensitive": true } as const;
