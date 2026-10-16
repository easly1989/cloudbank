import type { IMAPSettings } from "../../api/client";

/**
 * The mail providers the IMAP connect form knows (#658): where their IMAP
 * server is, and the page of theirs that explains the app password. Each was
 * read from the provider's own help pages (docs/research/imap-mail-ingest.md).
 * "other" is a server typed by hand.
 */
export type ProviderId =
  "gmail" | "libero" | "virgilio" | "icloud" | "yahoo" | "fastmail" | "aruba" | "other";

export interface Provider {
  id: ProviderId;
  /** The provider's name; a brand, so the same in every language. */
  name: string;
  server: Omit<IMAPSettings, "username">;
  /** The provider's page on its app password, or on its mail settings. */
  help: string;
  /** Address domains that belong to it, to pick it from what is typed. */
  domains: string[];
}

export const PROVIDERS: Provider[] = [
  {
    id: "gmail",
    name: "Gmail",
    server: { host: "imap.gmail.com", port: 993, security: "tls" },
    help: "https://support.google.com/accounts/answer/185833",
    domains: ["gmail.com", "googlemail.com"],
  },
  {
    id: "libero",
    name: "Libero",
    server: { host: "imapmail.libero.it", port: 993, security: "tls" },
    help: "https://aiuto.libero.it/articolo/sicurezza/password-sicura-specifica-applicazioni-client/",
    domains: ["libero.it", "iol.it", "inwind.it", "blu.it"],
  },
  {
    id: "virgilio",
    name: "Virgilio",
    server: { host: "in.virgilio.it", port: 993, security: "tls" },
    help: "https://aiuto.virgilio.it/articolo/sicurezza/password-sicura-specifica-applicazioni-client/",
    domains: ["virgilio.it"],
  },
  {
    id: "icloud",
    name: "iCloud",
    server: { host: "imap.mail.me.com", port: 993, security: "tls" },
    help: "https://support.apple.com/102654",
    domains: ["icloud.com", "me.com", "mac.com"],
  },
  {
    id: "yahoo",
    name: "Yahoo",
    server: { host: "imap.mail.yahoo.com", port: 993, security: "tls" },
    help: "https://help.yahoo.com/kb/SLN15241.html",
    domains: ["yahoo.com", "yahoo.it", "ymail.com"],
  },
  {
    id: "fastmail",
    name: "Fastmail",
    server: { host: "imap.fastmail.com", port: 993, security: "tls" },
    help: "https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords",
    domains: ["fastmail.com", "fastmail.fm"],
  },
  {
    id: "aruba",
    name: "Aruba",
    server: { host: "imaps.aruba.it", port: 993, security: "tls" },
    help: "https://guide.aruba.it/hosting-e-domini/email/configurazione-posta/parametri-configurazione-posta",
    domains: ["aruba.it"],
  },
  {
    id: "other",
    name: "",
    server: { host: "", port: 993, security: "tls" },
    help: "",
    domains: [],
  },
];

export const providerById = (id: ProviderId) =>
  PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];

/** The domains of Outlook.com, which takes no app password: Microsoft's sign-in instead. */
const MICROSOFT_DOMAINS = [
  "outlook.com",
  "outlook.it",
  "hotmail.com",
  "hotmail.it",
  "live.com",
  "live.it",
  "msn.com",
];

const domainOf = (address: string) => address.trim().toLowerCase().split("@")[1] ?? "";

/** The provider an address belongs to, or null when its domain says nothing. */
export function providerForAddress(address: string): Provider | null {
  const d = domainOf(address);
  return d ? (PROVIDERS.find((p) => p.domains.includes(d)) ?? null) : null;
}

/** Whether an address is an Outlook.com one, which connects with Microsoft. */
export const isMicrosoftAddress = (address: string) =>
  MICROSOFT_DOMAINS.includes(domainOf(address));

/** The provider whose server these settings are, or "other". */
export function providerForServer(s: Pick<IMAPSettings, "host" | "port" | "security">): Provider {
  return (
    PROVIDERS.find(
      (p) =>
        p.id !== "other" &&
        p.server.host === s.host &&
        p.server.port === s.port &&
        p.server.security === s.security,
    ) ?? providerById("other")
  );
}
