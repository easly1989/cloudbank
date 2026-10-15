# Reading bank notification emails over IMAP: which providers, which login, which Go library

**Research date:** 2026-10-15  
**Scope:** CloudBank is considering a feature that reads a user's bank notification emails over IMAP, server-side, with an app password (never the main password), limited to one folder or label, read-only. Which providers still accept that, what the ones that do not require, and which Go libraries could carry it (pure Go, AGPL-3.0 compatible).

Nothing here was run against a live mailbox. Every statement is read from the owner's own page, source or RFC; where a page is silent, the note says "unconfirmed".

---

## Short answer

**Can a user with an Outlook.com address use this with an app password? No, not on any footing we can rely on.** Microsoft ended Basic authentication for personal Outlook.com, Hotmail and Live accounts on **2024-09-16**, and Microsoft's own server-settings page for Outlook.com now lists **OAuth2 / Modern Auth as the only method** for IMAP. Microsoft's pages never say in so many words that app passwords stopped working for IMAP, and the Outlook.com settings page still tells users they "may need an app password". A Microsoft Q&A answer says they do not work for IMAP/POP after that date. So: treat Outlook.com as OAuth-only. Whether an app password still gets through is **unconfirmed** and should not be a design assumption.

**Which providers work with an app password** (all checked against the provider's own help pages):

| Provider | IMAP with an app password? | Notes |
|---|---|---|
| Gmail | **Yes**, with 2-Step Verification on | Google calls them "not recommended", but announces no deprecation. |
| Libero | **Yes** | The "Password Sicura" 16-character password. Plain password works if Password Sicura is off. |
| Virgilio | **Yes** | Same mechanism as Libero. |
| Aruba (ordinary mail) | **Plain password** | App passwords and OAuth are not mentioned for ordinary mailboxes. |
| Aruba PEC | **Yes** | With 2-step verification on, the client needs a dedicated "password per il programma di posta". |
| iCloud | **Yes, and only that** | App-specific password; needs two-factor authentication on the Apple Account. |
| Yahoo | **Yes** | Yahoo's IMAP page says to use an app password. |
| Fastmail | **Yes, and only that** | The main password does not work for external clients. |
| Proton | **No** | Not IMAP to Proton. Only through Proton Bridge, a desktop app on the user's machine. |
| Outlook.com / Hotmail / live.it | **No** | OAuth2 only. See section 1. |

**Two limits the "read-only, one folder" framing cannot get around.** None of these credentials is scoped to a folder or to read access. An app password is a second password to the whole mailbox; Microsoft's IMAP scope is `IMAP.AccessAsUser.All`; Google's is the full `https://mail.google.com/`. Fastmail scopes by data category (mail, contacts, calendars, files), not by folder or by read/write, and its page does not say whether IMAP can be made read-only. "One folder, read-only" is therefore a promise CloudBank keeps in its own client (EXAMINE, `BODY.PEEK`, one mailbox name), not something the provider enforces. That has to be said to the user.

**Library:** `emersion/go-imap` **v2** is the better base but is **still beta** (latest tag `v2.0.0-beta.8`, 2025-12-16); v1 is stable but frozen since 2022-05. Both are MIT, pure Go. Neither ships XOAUTH2; the SASL interface is five lines to implement, so it is a small gap. `emersion/go-message` (MIT) decodes MIME, quoted-printable and, with one blank import, all charsets.

---

## 1. Outlook.com / Hotmail / live.it (personal Microsoft accounts)

### What changed, and when

| Date | Event | Source |
|---|---|---|
| 2024-02-27 | Microsoft states it will "fully remove support for Basic authentication from Outlook.com" and that timelines will follow. Apps without OAuth keep working "until we announce our final deprecation dates". | [Support: Outlook and other apps are unable to connect to Outlook.com when using Basic authentication](https://support.microsoft.com/office/outlook-and-other-apps-are-unable-to-connect-to-outlook-com-f4202ebf-89c6-4a8a-bec3-3d60cf7deaef) |
| 2024-06-11 | End-of-support timeline communicated. | [Support: Modern Authentication methods now needed to continue syncing Outlook email in non-Microsoft email apps](https://support.microsoft.com/en-us/office/modern-authentication-methods-now-needed-to-continue-syncing-outlook-email-in-non-microsoft-email-apps-c5d65390-9676-4763-b41f-d7986499a90d) |
| end of 2024-06 | Accounts actively using Basic authentication are contacted by email. | same page |
| **2024-09-16** | "Basic Authentication no longer available to access any Outlook account." | same page |

The same page says to confirm that third-party apps "support Modern Authentication against EAS, POP, IMAP, and SMTP".

Microsoft's current Outlook.com server page: IMAP is `outlook.office365.com`, port 993, SSL/TLS, authentication **OAuth2/Modern Auth**; POP and SMTP likewise. It says Outlook.com "requires the use of Modern Auth / OAuth2", and that "POP & IMAP access is disabled by default" and must be switched on under Settings > Mail > Forwarding and IMAP. ([Support: POP, IMAP, and SMTP settings for Outlook.com](https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040), read 2026-10-15.)

### Do app passwords still work for IMAP?

Mixed evidence, and the contradiction is Microsoft's own:

- The settings page above lists only OAuth2, yet adds that the password field is the Microsoft account password and that a user "may need an app password" if it is not recognised or when adding the account to a smart device.
- The how-to page for app passwords does not mention IMAP or any deprecation. It names Xbox 360, Outlook 2010 and earlier, and the default Android mail app as examples, and says an app password is only needed if two-step verification is on. ([Support: How to get and use app passwords](https://support.microsoft.com/en-us/account-billing/how-to-get-and-use-app-passwords-5896ed9b-4263-e681-128a-a6f2979a7944))
- On Microsoft Q&A, an answer by an account labelled "Microsoft Community Technical Support Specialist" says that after 16 September "all authentication methods and passwords using imap/POP protocol will be invalid" (answer dated 2024-06-29), in reply to a question whether app passwords count as Basic authentication. That is a community-support answer, not a policy document. ([Microsoft Q&A: Are app passwords being discontinued?](https://learn.microsoft.com/en-us/answers/questions/4682437/are-app-passwords-being-discontinued))

**Reading:** the dated, official statements are about "Basic Authentication". An app password presented over IMAP `LOGIN`/`PLAIN` is Basic authentication on the wire, which is why the staff answer says it stops. Nobody at Microsoft has published a page saying "app passwords still work for IMAP". Unconfirmed on a live account; plan for OAuth.

### What a self-hosted app needs if it uses OAuth

Microsoft's own page says OAuth2 for IMAP/POP/SMTP "is available for both Microsoft 365 ... and Outlook.com users." ([Learn: Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth), page updated 2025-10-17.) From that page:

- **An application registration with Microsoft Entra is required.** ("To use OAuth, an application must be registered with Microsoft Entra.")
- **Scopes** (full resource URL needed): `https://outlook.office.com/IMAP.AccessAsUser.All`, plus `offline_access` for a refresh token ("Refresh tokens are long-lived").
- **Flows named:** authorization code, and device authorization grant (client credentials is documented too, but it is for Exchange Online tenants with an admin consent and a service principal, so it does not apply to a personal account).
- **IMAP login is SASL XOAUTH2:** `AUTHENTICATE XOAUTH2 base64("user=" + userName + ^A + "auth=Bearer " + accessToken + ^A + ^A)`. The page's capability sample advertises `AUTH=XOAUTH2`; it does not describe OAUTHBEARER.

**Device code flow works for personal accounts.** The protocol page lists `tenant` as `/common`, `/consumers` or `/organizations`, and says a personal-account user on `/common` or `/consumers` signs in again on the second device. The token request takes `grant_type`, `client_id` and `device_code`: **no client secret.** ([Learn: OAuth 2.0 device authorization grant](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), updated 2026-06-15.) The MSAL.NET page says device code needs a **public client** application, registered with the "treat application as a public client" switch on, and that it works with personal accounts through `/common` or `/consumers` since MSAL.NET 4.5. Its code sample still carries a stale comment about error AADSTS90133 saying `/common` and `/consumers` are unsupported; the protocol page above is the newer, authoritative one. ([Learn: Device code flow in MSAL.NET](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/desktop-mobile/device-code-flow)) The mutt project's `mutt_oauth2.py` uses exactly this shape against Outlook (`common` authorize, devicecode and token endpoints, scope `offline_access https://outlook.office.com/IMAP.AccessAsUser.All`, IMAP host `outlook.office365.com`, mechanism `XOAUTH2`). ([mutt_oauth2.py](https://gitlab.com/muttmua/mutt/-/raw/master/contrib/mutt_oauth2.py)) That is a working third-party implementation, not a Microsoft statement.

**Registration options** (the supported-account-types table): "Personal Microsoft accounts only" (`PersonalMicrosoftAccount`), or "Any Entra ID Tenant + Personal Microsoft accounts" (`AzureADandPersonalMicrosoftAccount`). ([Learn: Register an app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [Learn: Change the account types supported](https://learn.microsoft.com/en-us/entra/identity-platform/howto-modify-supported-accounts).) To register at all, the quickstart lists as prerequisites an Azure account with an active subscription and a workforce or external tenant (the free Default Directory will do).

**Refresh-token lifetime:** default **90 days** for scenarios other than single-page apps; each use returns a new refresh token, and the old one is not revoked, so the app must store the new one and delete the old. It can be revoked earlier (user revokes, admin revokes, password change for password-based tokens). ([Learn: Refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens), updated 2026-06-15.) Whether the 90 days slide with use or count from the first sign-in is not stated on that page; "replace themselves with a fresh token upon every use" suggests a rolling window, but that is an inference. A feature that polls daily keeps the chain alive; a self-hoster who is away for three months has to sign in again.

### Who registers the app?

Microsoft's pages do not decide this; it is a design choice with these documented consequences:

| | Project registers one app (client ID shipped in the image) | Each self-hoster registers their own |
|---|---|---|
| Secret needed | No: a public client with device code needs none, so only a client ID (not a secret) ships | No, same flow |
| Setup for the user | Click "sign in with Microsoft", enter a code | Create an Azure account, a tenant, an app registration, copy the client ID into `CB_*` config |
| Consent screen shows | The project's app name | The user's own app name |
| Risk | One shared client ID under the project's control; Microsoft could throttle or revoke it. | None shared. |
| Publisher verification | Not available to the project unless it has a Microsoft AI Cloud Partner Program account and registers the app with a work or school account. The page says "Apps that are registered by using a Microsoft account can't be publisher verified." | Not relevant |

Publisher verification matters less here than it would for an org-facing app: the documented restriction (November 2020) is about user consent in **organisational** tenants with risk-based step-up consent. The page says nothing about personal-account consent. ([Learn: Publisher verification overview](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview).) Whether an unverified multi-tenant app triggers any warning for a personal Microsoft account is **unconfirmed**.

---

## 2. Gmail

- **App passwords with IMAP when 2-Step Verification is on: still supported.** Google: "App passwords can only be used with accounts that have 2-Step Verification turned on." They are "not recommended and are unnecessary in most cases", and the page announces no deprecation. The option may be hidden if the 2SV uses only security keys, if Advanced Protection is on, or for work and school accounts. Each is a 16-character code; changing the Google Account password revokes them. ([Google Account Help: Sign in with app passwords](https://support.google.com/accounts/answer/185833))
- **The 2025 cut-off did not touch app passwords.** Google turned off "less secure apps" and password-based IMAP/SMTP/POP on **2025-03-14**; the transition page says legacy passwords stop working "with the exception of app passwords". ([Workspace knowledge: Transition from less secure apps to OAuth](https://knowledge.workspace.google.com/admin/sync/transition-from-less-secure-apps-to-oauth)) IMAP is "always on" for personal accounts since January 2025 (the enable/disable switch goes away). ([Gmail Help: Add Gmail to another email client](https://support.google.com/mail/answer/7126229))
- **If OAuth were chosen instead:** scope `https://mail.google.com/` with XOAUTH2 ([Gmail IMAP XOAUTH2 protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)); a Google Cloud project in "Testing" status issues refresh tokens that expire in **7 days**, and any token unused for six months dies ([Google OAuth 2.0 overview](https://developers.google.com/identity/protocols/oauth2#expiration)). That makes OAuth much heavier than an app password for a self-hoster.
- **Labels are exposed as IMAP folders.** "Gmail treats labels as folders for the purposes of IMAP." Built-in labels sit under a `[Gmail]` prefix (`[GoogleMail]` in some locales), found through `LIST` special-use attributes (`\All`, `\Sent`, `\Drafts`, `\Trash`, `\Flagged`, `\Important`). Examples use `/` as the hierarchy delimiter, so a user label `Banks` appears as the folder `Banks` and a nested one as `Parent/Child`; Google's page does not state the delimiter for user labels outright, so read it from the `LIST` response rather than hard-code it. Label names in `X-GM-LABELS` come as UTF-7 as appropriate. ([Gmail IMAP extensions](https://developers.google.com/gmail/imap/imap-extensions))
- **Not found on a Google page:** the per-label "Show in IMAP" switch. A label hidden there would not appear as a folder. Unconfirmed from a primary source; the connect step should list folders with `LIST` and let the user pick, instead of assuming a label exists.
- A message with several labels appears in each label's folder with a different UID in each. That follows from labels-as-folders; Google's page does not spell it out. Dedupe on `Message-ID`, not on UID.

---

## 3. Other providers common in Italy

| Provider | IMAP host:port | Login | Source |
|---|---|---|---|
| **Libero** (also iol.it, blu.it, inwind.it) | `imapmail.libero.it`:993, SSL/TLS | Full address plus account password; with "Password Sicura" on, the clients (Outlook, Mail on Mac, Thunderbird, phone apps) need a **16-character "Password Specifica per Applicazioni"** from the Account area, valid in all clients at once. OAuth: not mentioned. | [Libero: client IMAP e SMTP](https://aiuto.libero.it/articolo/mail/configurare-libero-mail-con-client-di-posta-imap-e-smtp/), [Libero: Password Sicura specifica per app e client](https://aiuto.libero.it/articolo/sicurezza/password-sicura-specifica-applicazioni-client/) |
| **Virgilio** (ordinary mail) | `in.virgilio.it`:993, SSL/TLS (the Samsung-app guide names `imapmail.virgilio.it` instead) | Same Password Sicura mechanism as Libero. OAuth: not mentioned. | [Virgilio: client IMAP e SMTP](https://aiuto.virgilio.it/articolo/mail/configurare-virgilio-mail-con-client-di-posta-imap-e-smtp/), [Virgilio: Password Sicura specifica](https://aiuto.virgilio.it/articolo/sicurezza/password-sicura-specifica-applicazioni-client/) |
| **Aruba**, domain mailbox | `imaps.aruba.it`:993 SSL/TLS (TLS 1.2 minimum); the IMAP add-on must be active on the domain | Full address plus password. App passwords, 2FA and OAuth: not mentioned. | [Aruba: Parametri di configurazione caselle di posta](https://guide.aruba.it/hosting-e-domini/email/configurazione-posta/parametri-configurazione-posta) |
| **Aruba**, free `@aruba.it` / `@technet.it` | `imap.aruba.it`:993 SSL/TLS | Full address plus password | same page |
| **Aruba PEC** | `imaps.pec.aruba.it`:993 SSL/TLS | Full PEC address plus password; with 2-step verification on, a dedicated **"password per il programma di posta"**, which cannot be changed but can be regenerated. Multi-user accounts use `multiutente/<mailbox>`. OTP and OAuth: not mentioned. | [Aruba: configurare la PEC su un programma di posta](https://guide.aruba.it/pec/configurazione-programmi-di-posta/client-posta-e-dispositivi-mobili) |
| **iCloud Mail** | `imap.mail.me.com`:993, SSL required | **App-specific password** (not the Apple Account password). Needs two-factor authentication on; up to 25 active; **changing the Apple Account password revokes all of them.** Username is usually the part before `@`; use the full address if that fails. | [Apple: iCloud Mail server settings](https://support.apple.com/en-us/102525), [Apple: App-specific passwords](https://support.apple.com/en-us/102654) |
| **Yahoo** | `imap.mail.yahoo.com`:993, SSL required | Full address plus an **app password** ("Generate App Password"). OAuth: not mentioned. | [Yahoo: IMAP settings](https://help.yahoo.com/kb/SLN4075.html), [Yahoo: app passwords](https://help.yahoo.com/kb/SLN15241.html) |
| **Fastmail** | `imap.fastmail.com`:993, SSL/TLS (not STARTTLS) | **App password only**; the main password gives "a password error" in external clients. Scope is by data category, default "Mail, Contacts & Calendars". OAuth: not mentioned. | [Fastmail: Server names and ports](https://www.fastmail.help/hc/en-us/articles/1500000278342-Server-names-and-ports), [Fastmail: App passwords](https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords) |
| **Proton** | No public IMAP. Via **Proton Mail Bridge**: IMAP/SMTP servers that run locally, on the user's computer | Bridge is "currently available only with a paid Proton Mail plan". Bridge's own host, port and generated password were not on the pages read: unconfirmed. | [Proton: Bridge](https://proton.me/support/protonmail-bridge-install), [Proton: paid-plan requirement](https://proton.me/support/imap-smtp-and-pop3-setup), [ProtonMail/proton-bridge README](https://github.com/ProtonMail/proton-bridge) |

Notes on the table:

- **Libero and Virgilio:** the vendor's pages say the app password is required "for apps and mail programs"; the plain-password parameters pages do not mention it. Both pages describe Password Sicura as a switch the user turns on, so a user with it off logs in with the account password. App passwords exist and are the documented route when the security option is on.
- **Proton Bridge** is a GUI app: its README says "When launched, Bridge will initialize local IMAP/SMTP servers and render its GUI" and that mail syncs "only ... when the Bridge is running". The Bridge CLI guide mentions a `-c` flag for a command-line mode, but only as a fallback when the GUI will not start; headless server use is not documented. Bridge is GPL-3.0 and runs on the user's machine, not next to CloudBank's container, so it is a poor fit for a one-container server and should be out of scope.
- Aruba PEC aside, none of the providers above document OAuth for IMAP. Only Gmail and Microsoft do.
- **PEC and bank notifications:** banks send ordinary email, not PEC, so Aruba PEC is likely irrelevant here; it is listed because the brief asked.

---

## 4. Go libraries

### emersion/go-imap: v1 against v2

| | v1 | v2 |
|---|---|---|
| Module | `github.com/emersion/go-imap` | `github.com/emersion/go-imap/v2` |
| Protocol | IMAP4rev1 (RFC 3501) | IMAP4rev2 (RFC 9051) |
| Status | Last tag `v1.2.1`, **2022-05-01**; last commit on the `v1` branch **2023-11-03** ("Fix possible panics"). README: "go-imap v2 is in development". | README: "still in development". Tags `v2.0.0-alpha.1` to `v2.0.0-beta.8`; pkg.go.dev shows "Stable version" unchecked. Latest tag `v2.0.0-beta.8`, **2025-12-16** (the GitHub release object was published 2026-02-07). The `v2` branch still takes commits: **2026-09-17** the latest read, parser and server fixes. |
| Licence | MIT | MIT |
| Pure Go, no cgo | Yes (`go.mod`: go-message, go-sasl, `x/text`) | Yes (`go.mod`: go-message v0.18.2, go-sasl) |
| Minimum Go | 1.13 | 1.18 |
| Auth | `Client.Authenticate(sasl.Client)` and `Login` | `Client.Authenticate(sasl.Client)`; SASL initial response used when the server advertises `SASL-IR` |
| Read-only open (EXAMINE) | `Select(name, readOnly bool)`; the doc says the server may open read-only even when `false` | `Select(mailbox, &imap.SelectOptions{ReadOnly: true})` sends `EXAMINE` |
| `BODY.PEEK` | `BodySectionName.Peek` (renders `BODY.PEEK[...]`) | `FetchItemBodySection{Peek: true}` |
| UIDs and UIDVALIDITY | `UidFetch`; `MailboxStatus.UidValidity` | `Fetch` with a `UIDSet`; `UIDSearch`; `SelectData.UIDNext`, `SelectData.UIDValidity` |
| IDLE | Not in the v1 client; `go-imap-idle` is a separate package, **archived** (last push 2021-09-07). The v1 README lists IDLE as built in, but the client commands read have no IDLE. | `Client.Idle()`, restarted automatically every 28 minutes; `UnilateralDataHandler` receives new-mail events |
| Dial helpers | `client.DialTLS` | `imapclient.DialTLS`, `DialStartTLS`, `DialInsecure`, `New`, `NewStartTLS` |

Sources: [go-imap README (v2)](https://github.com/emersion/go-imap/tree/v2), [README (v1 branch)](https://github.com/emersion/go-imap/tree/v1), [pkg.go.dev: go-imap/v2](https://pkg.go.dev/github.com/emersion/go-imap/v2), [imapclient/select.go](https://github.com/emersion/go-imap/blob/v2/imapclient/select.go), [imapclient/fetch.go](https://github.com/emersion/go-imap/blob/v2/imapclient/fetch.go), [imapclient/idle.go](https://github.com/emersion/go-imap/blob/v2/imapclient/idle.go), [v1 client/cmd_auth.go](https://github.com/emersion/go-imap/blob/v1/client/cmd_auth.go), [go-imap-idle](https://github.com/emersion/go-imap-idle), and the tag and release lists read through the GitHub API on 2026-10-15.

**Reading:** v2 is the active line and has the whole checklist built in (EXAMINE, PEEK, UID fetch, UIDVALIDITY, IDLE). The cost is its beta label: the README and pkg.go.dev both say the API is not final, so a pinned version and a thin wrapper inside `internal/` is the safe shape. v1 is stable but unmaintained for three years and needs an archived extension for IDLE. IDLE is optional anyway: a scheduled poll that fetches `UID > last seen` needs none of it.

### SASL: PLAIN yes, XOAUTH2 no

`emersion/go-sasl` (MIT, no tags, last commit 2024-10-20) implements ANONYMOUS, EXTERNAL, LOGIN, **PLAIN** and **OAUTHBEARER** (RFC 7628). **XOAUTH2 is not in it.** ([go-sasl README](https://github.com/emersion/go-sasl)) The `sasl.Client` interface is two methods, `Start() (mech string, ir []byte, err error)` and `Next(challenge []byte) ([]byte, error)`, so an XOAUTH2 client is a short type of our own: `Start` returns `"XOAUTH2"` and the `user=…^Aauth=Bearer …^A^A` bytes shown in section 1; `Next` answers an error challenge with an empty response. ([sasl.go](https://github.com/emersion/go-sasl/blob/master/sasl.go)) Microsoft's page describes only XOAUTH2, so OAUTHBEARER from go-sasl will not help for Outlook.com. Google's doc names XOAUTH2 for IMAP.

For app-password providers, `Client.Login` (or `sasl.NewPlainClient`) is enough. Always dial TLS (993) or STARTTLS; every provider above lists 993.

### MIME: emersion/go-message

MIT, pure Go, depends only on `golang.org/x/text` (BSD-3-Clause; the FSF lists both Expat and Modified BSD as GPL-compatible, [license list](https://www.gnu.org/licenses/license-list.html)). Latest tag `v0.18.2`, **2025-01-13**; last push 2025-02-16; not archived. Implements RFC 5322, RFC 2045/2046/2047 and RFC 2183. Its README lists: streaming API, "Automatic encoding and charset handling (to decode all charsets, add `import _ "github.com/emersion/go-message/charset"`)", and a `mail` subpackage for reading mail (headers, text and HTML parts, attachments). Without the `charset` blank import only a few charsets are decoded, so a bank mail in ISO-8859-1 or Windows-1252 would fail; the import is not optional for this feature. ([go-message README](https://github.com/emersion/go-message), [releases](https://github.com/emersion/go-message/releases)) go-imap v2's `go.mod` already requires go-message v0.18.2, so the two versions match.

### Licence fit

MIT is compatible with AGPL-3.0, and so is BSD-3 for `x/text`. Every module above is MIT or BSD-3. The one GPL piece found, Proton Bridge, would not be linked in, only talked to over local IMAP.

---

## 5. RFCs the design leans on

- Read-only select: `EXAMINE` ([RFC 3501 §6.3.2](https://www.rfc-editor.org/rfc/rfc3501.html#section-6.3.2); RFC 9051 keeps it).
- Fetch without setting `\Seen`: `BODY.PEEK[...]` ([RFC 3501 §6.4.5](https://www.rfc-editor.org/rfc/rfc3501.html#section-6.4.5)).
- Incremental sync: a UID is stable only while `UIDVALIDITY` is unchanged; if it changes, discard the stored cursor and rescan ([RFC 3501 §2.3.1.1](https://www.rfc-editor.org/rfc/rfc3501.html#section-2.3.1.1)).
- IDLE ([RFC 2177](https://www.rfc-editor.org/rfc/rfc2177.html)); the IMAP4rev2 spec is [RFC 9051](https://www.rfc-editor.org/rfc/rfc9051.html).
- SASL PLAIN ([RFC 4616](https://www.rfc-editor.org/rfc/rfc4616.html)), OAUTHBEARER ([RFC 7628](https://www.rfc-editor.org/rfc/rfc7628.html)). XOAUTH2 is not an RFC; Google's and Microsoft's pages above are its specification.

These section numbers were not re-opened during this research; they are from the RFC structure as published.

---

## Verdict

**An app-password IMAP ingest is viable for Gmail, Libero, Virgilio, Aruba, iCloud, Yahoo and Fastmail, and not viable for Outlook.com without OAuth.** Outlook.com users, a large share of personal mailboxes, need the OAuth2 device-code path: a public client with no secret, scopes `IMAP.AccessAsUser.All` and `offline_access`, a refresh token that is rotated on every use and lasts 90 days by default, and XOAUTH2 on the IMAP login. Someone has to own the Entra app registration. That is a decision for the maintainers, and it brings an Azure account, a client ID shipped in the image and a refresh token stored encrypted via `internal/secrets`.

**Suggested shape, if the feature goes ahead:**

1. **Ship app-password IMAP first** (`Login` over TLS on 993). It covers the providers in the short answer table and needs no registration anywhere.
2. **Library:** go-imap v2 pinned at a beta tag, behind a small interface in `internal/`, plus go-message with the `charset` import. Both MIT, pure Go.
3. **Be honest in the UI:** the provider's password cannot be limited to one folder or to read access. CloudBank restricts itself (EXAMINE, PEEK, one mailbox), and the user should be told that the credential can do more.
4. **Cursor:** `(UIDVALIDITY, last UID)` per folder; on a `UIDVALIDITY` change, rescan and dedupe on `Message-ID`. Gmail's one-message-many-folders makes UID alone unsafe if more than one label is ever read.
5. **List folders with `LIST`** and let the user choose; never assume a Gmail label is visible to IMAP.
6. **Outlook.com is a separate, later decision** (OAuth device code, an XOAUTH2 `sasl.Client` of our own, a registered app). If it is declined, say in the UI and docs that Outlook.com is not supported and why.
7. **Proton:** out of scope.

**Left unconfirmed:**
- Whether an Outlook.com app password is still accepted over IMAP on a live account.
- Whether the 90-day refresh-token window slides with use.
- Any consent-screen warning for an unverified app on a personal Microsoft account.
- Gmail's per-label "Show in IMAP" switch (no Google page found).
- Proton Bridge's local host, port and generated-password details, and headless operation.
- Whether Libero or Virgilio add OAuth.
- The RFC section numbers (cited from memory of the published structure; not re-opened).
