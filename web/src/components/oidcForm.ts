import type { OidcSettings } from "../api/client";

/** What the single sign-on form holds while it is edited (#796). */
export interface OidcDraft {
  issuer: string;
  clientId: string;
  clientSecret: string;
  name: string;
  scopes: string;
  autoProvision: boolean;
  adminEmail: string;
}

export const draftFrom = (s: OidcSettings): OidcDraft => ({
  issuer: s.issuer,
  clientId: s.clientId,
  clientSecret: "",
  name: s.name,
  scopes: s.scopes,
  autoProvision: s.autoProvision,
  adminEmail: s.adminEmail,
});

/** What the save button does with this draft: turn SSO on, save it, or move
 *  to another provider; whether it can yet; and whether linked users lose
 *  their link on the way. */
export function saveAction(s: OidcSettings, d: OidcDraft) {
  const issuerChanged = s.source === "settings" && d.issuer.trim() !== s.issuer;
  const kind: "turnOn" | "save" | "changeProvider" = !s.enabled
    ? "turnOn"
    : issuerChanged
      ? "changeProvider"
      : "save";
  const ready =
    s.secretKey &&
    s.source !== "env" &&
    d.issuer.trim() !== "" &&
    d.clientId.trim() !== "" &&
    (d.clientSecret.trim() !== "" || s.hasSecret);
  return { kind, ready, warnLinks: issuerChanged && s.linkedUsers > 0 };
}

/** The host of an issuer address, for the row and the warning. */
export function issuerHost(issuer: string): string {
  try {
    return new URL(issuer).host || issuer;
  } catch {
    return issuer;
  }
}
