import type { QueryClient } from "@tanstack/react-query";

import { updateMe, type Preferences, type User } from "./auth";

/** What one write changes: account fields, and the preferences to set. */
export interface MeChange {
  locale?: string;
  theme?: string;
  /** Merged over the stored preferences; a key set to undefined is removed. */
  preferences?: Partial<Preferences>;
}

const ME = ["me"];
let queue: Promise<unknown> = Promise.resolve();

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
 */
export function saveMe(qc: QueryClient, change: MeChange): Promise<User> {
  const run = queue.then(async () => {
    await qc.cancelQueries({ queryKey: ME });
    const { preferences, ...account } = change;
    const body = preferences
      ? {
          ...account,
          preferences: { ...(qc.getQueryData<User>(ME)?.preferences ?? {}), ...preferences },
        }
      : account;
    const user = await updateMe(body);
    await qc.cancelQueries({ queryKey: ME });
    qc.setQueryData(ME, user);
    return user;
  });
  // A failed write rejects its own caller, and the next one still runs.
  queue = run.catch(() => undefined);
  return run;
}

/** saveMe for preferences alone. */
export const savePreferences = (qc: QueryClient, patch: Partial<Preferences>) =>
  saveMe(qc, { preferences: patch });
