import type { QueryClient } from "@tanstack/react-query";

import { getMe, updateMe, type Preferences, type User } from "./auth";
import { ApiError } from "./core";

/** What one write changes: account fields, and the preferences to set. */
export interface MeChange {
  locale?: string;
  theme?: string;
  /** Merged over the stored preferences; a key set to undefined is removed. */
  preferences?: Partial<Preferences>;
}

const ME = ["me"];
/** How many times a refused write starts again from the stored preferences. */
const RETRIES = 3;
let queue: Promise<unknown> = Promise.resolve();

/** The tabs of this browser tell each other about every save (#576). */
const CHANNEL = "cloudbank-me";
let channel: BroadcastChannel | null | undefined;
function tabs(): BroadcastChannel | null {
  if (channel === undefined)
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  return channel;
}

const stale = (err: unknown) =>
  err instanceof ApiError && err.status === 409 && err.code === "stale_preferences";

/**
 * The one way the web writes the signed-in user's settings (#548).
 *
 * The server replaces the whole preferences object, so a write built from the
 * copy a page rendered with undoes whatever changed since: two saves in flight
 * together each lack the other's change, and the later one wins. Here writes
 * go one at a time, and each is built from the latest copy when its turn
 * comes, after the one before it has landed and updated the cache. A read of
 * /auth/me still in flight is cancelled first, so an answer from before a
 * write cannot put the cache back behind it.
 *
 * Another tab or device may have saved since this copy was read (#576). The
 * write says which revision it started from; the server refuses it when that
 * is no longer the stored one, and the change is made again over the stored
 * preferences. A saved write is announced to this browser's other tabs.
 */
export function saveMe(qc: QueryClient, change: MeChange): Promise<User> {
  const run = queue.then(async () => {
    for (let attempt = 0; ; attempt++) {
      await qc.cancelQueries({ queryKey: ME });
      const { preferences, ...account } = change;
      const current = qc.getQueryData<User>(ME);
      const revision = current?.preferencesRevision;
      const body = preferences
        ? {
            ...account,
            preferences: { ...(current?.preferences ?? {}), ...preferences },
            ...(typeof revision === "number" ? { preferencesRevision: revision } : {}),
          }
        : account;
      try {
        const user = await updateMe(body);
        await qc.cancelQueries({ queryKey: ME });
        qc.setQueryData(ME, user);
        tabs()?.postMessage(user);
        return user;
      } catch (err) {
        if (!stale(err) || attempt >= RETRIES) throw err;
        qc.setQueryData(ME, await getMe());
      }
    }
  });
  // A failed write rejects its own caller, and the next one still runs.
  queue = run.catch(() => undefined);
  return run;
}

/** saveMe for preferences alone. */
export const savePreferences = (qc: QueryClient, patch: Partial<Preferences>) =>
  saveMe(qc, { preferences: patch });

/**
 * Keeps this tab's copy of the settings in step with saves made in the other
 * tabs of this browser, as they happen rather than when this tab is next
 * focused. Only a newer copy of the same user is taken. Returns the cleanup.
 */
export function followOtherTabs(qc: QueryClient): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  // This tab's own saves arrive here too, already in the cache: not newer, so
  // left alone.
  const listen = new BroadcastChannel(CHANNEL);
  listen.onmessage = (e: MessageEvent<User>) => {
    const next = e.data;
    const current = qc.getQueryData<User | null>(ME);
    if (!next || !current || next.id !== current.id) return;
    if ((next.preferencesRevision ?? 0) <= (current.preferencesRevision ?? 0)) return;
    qc.setQueryData(ME, next);
  };
  return () => listen.close();
}
