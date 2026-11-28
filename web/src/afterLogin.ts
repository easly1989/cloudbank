/** sessionStorage key: where the app goes once signed in again. A card that
 *  asks the user to sign in again (adding a passkey, #798) sets it, so they
 *  land back where they were rather than on the dashboard. */
export const AFTER_LOGIN = "cb-after-login";

/** The path to go to once signed in again, if it was asked for in the last
 *  10 minutes; it is read once. */
export function takeAfterLogin(): string | null {
  const raw = sessionStorage.getItem(AFTER_LOGIN);
  sessionStorage.removeItem(AFTER_LOGIN);
  try {
    const { path, at } = JSON.parse(raw ?? "") as { path?: string; at?: number };
    if (typeof path !== "string" || new URL(path, location.origin).origin !== location.origin)
      return null;
    return typeof at === "number" && Date.now() - at < 10 * 60_000 ? path : null;
  } catch {
    return null;
  }
}
