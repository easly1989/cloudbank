# Notification channels: library or direct implementation for a pure-Go AGPL server

**Research date:** 2026-10-18  
**Scope:** CloudBank already sends Web Push (VAPID) and wants a Notifications settings page where each user picks delivery channels: email over SMTP, ntfy, Gotify, a Telegram bot, Discord / Slack / Matrix webhooks, Pushover, Home Assistant, a generic webhook. The question is whether to adopt a multi-service Go library or write the senders ourselves. Constraints: pure Go (no cgo), AGPL-3.0 compatible licences, one Docker container, Go 1.27.2+ (as in `CLAUDE.md`).

What was run and what was only read: the GitHub facts below come from the GitHub API (`gh api`) on 2026-10-18. Two throwaway programs were built outside the repo with `CGO_ENABLED=0` on Go 1.27.0, windows/amd64, to measure dependency weight; a third sent to a local test server to see what shoutrrr's errors look like. Nothing was sent to a real service. The HTTP APIs of Telegram, Discord, Slack, Pushover and Matrix were **not** read; see "Left unconfirmed".

---

## Short answer

- **shoutrrr:** the original `containrrr/shoutrrr` is **dormant** (last release v0.8.0 on 2023-08-20; 11 commits since 2025-01-01, the last on 2026-05-09). The **active fork is `nicholas-fedor/shoutrrr`**: v0.22.0 on 2026-10-13, a release roughly every one to two weeks since September, MIT, pure Go, 30 services, covering every candidate channel. It is pre-1.0, has one dominant maintainer, and its API is still moving.
- **nikoksr/notify:** maintained (v1.6.0 on 2026-08-31, MIT, pure Go) but **has no ntfy, no Gotify and no Home Assistant**, its email service only exposes SMTP PLAIN auth, and it reports only the first error when several services fail.
- **SMTP:** `net/smtp` is **not adequate** on its own. It is frozen, has no LOGIN auth, no implicit TLS helper (port 465) and no dial timeout, and `SendMail` uses STARTTLS only if the server offers it. `wneessen/go-mail` (MIT, v0.8.1, 2026-07-09) covers all of that with two dependencies.
- **ntfy, Gotify, Home Assistant, generic webhook:** each is one authenticated HTTP POST with a JSON body. A direct implementation is a few dozen lines each.
- **Recommendation:** direct implementation behind a small sender interface, `go-mail` for SMTP. Details at the end.

---

## 1. shoutrrr

### Which repository is alive

| | `containrrr/shoutrrr` (original) | `nicholas-fedor/shoutrrr` (fork) |
|---|---|---|
| Relationship | Original | GitHub marks it "forked from containrrr/shoutrrr" |
| Archived | No | No |
| Latest release | `v0.8.0`, **2023-08-20** | `v0.22.0`, **2026-10-13** |
| Recent releases | none since v0.8.0 | v0.21.2 (2026-10-06), v0.21.1 (2026-09-22), v0.21.0 (2026-09-15), v0.20.0 (2026-09-08), v0.19.0 (2026-09-02) |
| Commits | 11 since 2025-01-01; latest 2026-05-09 (a fuzzing config and a docs fix) | pushed 2026-10-18 |
| Contributors | not counted | 30; the commit authors on the default branch are the maintainer plus bots (`renovate`, `github-actions`) |
| Licence | MIT | MIT |
| Go version | n/a | `go 1.27`, toolchain `go1.27.2`; README: "Shoutrrr follows the latest minor Go version" |

Sources: [containrrr/shoutrrr](https://github.com/containrrr/shoutrrr), [its commits](https://github.com/containrrr/shoutrrr/commits/main), [nicholas-fedor/shoutrrr](https://github.com/nicholas-fedor/shoutrrr), [fork releases](https://github.com/nicholas-fedor/shoutrrr/releases), [fork go.mod](https://github.com/nicholas-fedor/shoutrrr/blob/main/go.mod), [fork LICENSE.md](https://github.com/nicholas-fedor/shoutrrr/blob/main/LICENSE.md).

The fork's Go floor equals CloudBank's (1.27.2), so adopting it would not raise ours. The fork's README does not say why it forked; the evidence above (a dormant original, a weekly cadence in the fork) is the reason one would pick it.

### Services (fork, v0.22.0)

Bark, Discord, Generic, Google Chat, Gotify, Home Assistant, IFTTT, Join, Lark, Logger, Matrix, Mattermost, MQTT, Notifiarr, Ntfy, Opsgenie, PagerDuty, Pushbullet, Pushover, Rocket.Chat, Signal, Signalgrid, Slack, SMTP, Teams, Telegram, Twilio, WeCom, XMPP, Zulip. Every candidate channel in the brief is present. ([README, Supported Services](https://github.com/nicholas-fedor/shoutrrr#supported-services); service packages under [`pkg/services`](https://github.com/nicholas-fedor/shoutrrr/tree/main/pkg/services).)

### URL format

One URL string per target, scheme picks the service. From the fork's per-service docs ([docs/services](https://github.com/nicholas-fedor/shoutrrr/tree/main/docs/services)):

| Channel | Format |
|---|---|
| ntfy | `ntfy://host/topic?priority=..&tags=..&title=..`; `token=` query parameter, sent as `Authorization: Bearer` (the token wins over Basic auth) |
| Gotify | `gotify://host[/subpath]/<app token>?priority=..&title=..&disabletls=..`; `useheader=yes` sends the token in `X-Gotify-Key` instead of the query string |
| SMTP | `smtp://user:pass@host:port/?fromaddress=..&toaddresses=a,b&auth=Plain\|Login\|CRAMMD5\|OAuth2&encryption=Auto\|ImplicitTLS\|ExplicitTLS\|None&requirestarttls=yes` |
| Telegram | `telegram://<bot token>@telegram?chats=<id>[,<id>]` |
| Discord | `discord://<token>@<webhook id>[?thread_id=..]` |
| Slack | `slack://hook:<token>@webhook` (or a `xoxb` bot token) |
| Matrix | `matrix://[user:password@]host[:port]/[?rooms=..]` |
| Pushover | `pushover://shoutrrr:<api token>@<user key>/?devices=..` |
| Home Assistant | `homeassistant://<long-lived token>@host[:port][/base]?service=notify.mobile_app_<device>&disabletls=yes` |
| Generic webhook | `generic://host/path?...`, custom headers as `@Header=value` |

Reading: credentials live **inside the URL string**. A settings form would have to assemble and parse these strings, and store the result as one secret blob; the library exposes config introspection but CloudBank would still own the mapping from form fields to URL.

### How it reports delivery errors

From the fork's README ("Per-Target Errors") and v0.22.0 release notes:

- `Sender.Send` returns **one result per configured URL, in URL order**, `nil` on success. A failure is a `*types.TargetError` (fields `URL` = service ID such as `discord`, `Index`, `Err`), reachable with `errors.As`.
- v0.22.0: "Errors and logs no longer contain service URLs or credentials." and "fix(telegram): report failed requests instead of success". So **before v0.22.0 errors could leak credentials, and Telegram could report success on a failed request**. The first is fixed in the version a new adopter would take; it is also the kind of defect that argues for reading the code of whatever we adopt.
- `SendContext` takes a caller context; each service has a 10-second default send budget.
- Egress control: `SenderOptions{HTTPClient, DialContext}` lets the caller supply an HTTP client and dialer (the README's example blocks loopback, private and link-local addresses). This matters for a multi-user server where users type a host.

What an error looks like, run against a local server that always answers 403 (versions: fork v0.22.0):

```
ntfy: failed to send ntfy notification: server response: forbidden (0)
generic: failed to send notification to generic webhook: server returned unexpected response status code: 403 Forbidden
homeassistant: failed to send homeassistant notification: homeassistant API returned unexpected status: 403 Forbidden: {"error":"forbidden"}
```

All three were `*TargetError`. The credentials did not appear in the text. But the cause is a **string**: the HTTP status is not a field, so code that wants "401: disable this channel and tell the user" versus "503: retry later" must parse text. The Home Assistant error also echoes the response body. (Gotify rejected the fake token before sending, with `invalid gotify token`; its token has a fixed shape.)

### Dependency weight

Programs built with `CGO_ENABLED=0`, Go 1.27.0, windows/amd64, no `-ldflags`, so sizes are comparable with each other and not with the Linux image.

| Program | Binary |
|---|---|
| Baseline: `net/http` client + `net/smtp` | 8.8 MB |
| Imports root package `github.com/nicholas-fedor/shoutrrr` (all services registered) | **17.6 MB** (+8.8 MB), 306 packages including stdlib |

Importing the root package links every service. The non-stdlib modules that end up in the binary: `eclipse/paho.golang` (MQTT), `gorilla/websocket`, `mellium.im/{xmpp,sasl,xmlstream,reader}` (XMPP), `mattn/go-colorable`, and `golang.org/x/{crypto,net,sys,term,text}`. `go list -m all` shows 51 modules (it includes test and CLI modules such as cobra, viper, ginkgo that the library import does not link). Whether importing only the needed `pkg/services/...` packages avoids MQTT and XMPP was **not tested**.

Licences of the extra modules: `gorilla/websocket` BSD-2-Clause, `mellium/xmpp` BSD-2-Clause (GitHub API). `eclipse-paho/paho.golang` is dual **EPL-2.0 / EDL-1.0** per its [LICENSE](https://github.com/eclipse-paho/paho.golang/blob/master/LICENSE); EDL-1.0 is the BSD-3-Clause text, so it can be taken under that. That is my reading, not legal advice.

### Pure Go

No `import "C"` anywhere in the fork's or notify's checkouts (searched all `.go` files); both builds above succeeded with `CGO_ENABLED=0`.

---

## 2. Alternatives in Go

### nikoksr/notify

| | |
|---|---|
| Latest release | `v1.6.0`, **2026-08-31** (before it: v1.5.0 2025-12-15, v1.4.0 2025-12-11, v1.3.0 2025-01-15) |
| Activity | last commit 2026-10-12; 68 commits since 2026-01-01 |
| Licence | MIT |
| Go | `go 1.26.8` |
| Maintainers | README lists one: `@svaloumas` |
| Services | Amazon SES, SNS, Bark, DingTalk, Discord, Email, FCM, Google Chat, HTTP, Lark, Line, Mailgun, Mailtrap, Matrix, Teams, PagerDuty, Plivo, Pushover, Pushbullet, Reddit, Rocket.Chat, SendGrid, Slack, Syslog, Telegram, TextMagic, Twilio, Twitter, Viber, WeChat, Web Push; WhatsApp is marked not working |

Sources: [repo](https://github.com/nikoksr/notify), [releases](https://github.com/nikoksr/notify/releases), [go.mod](https://github.com/nikoksr/notify/blob/main/go.mod), [README services table](https://github.com/nikoksr/notify#supported-services).

Findings from reading the code:

- **No ntfy, no Gotify, no Home Assistant.** Three of the brief's channels are missing; the `http` service could stand in for them, which is no better than writing the POST ourselves.
- **Email is thin.** `service/mail` wraps `jordan-wright/email` and `net/smtp`; its only auth call is `AuthenticateSMTP`, which builds `smtp.PlainAuth`. ([service/mail/mail.go](https://github.com/nikoksr/notify/blob/main/service/mail/mail.go).)
- **Errors:** `Send` runs the services in an `errgroup.Group` and returns `errors.Join(ErrSendNotification, err)` where `err` is `eg.Wait()`, which is the **first** non-nil error only ([send.go](https://github.com/nikoksr/notify/blob/main/send.go); [errgroup docs](https://pkg.go.dev/golang.org/x/sync/errgroup#Group.Wait)). With three channels failing, the caller sees one. A per-user, per-channel "last delivery failed" indicator cannot be built on that without calling each service one at a time.
- **Dependencies:** the module graph is large (AWS SDK, Google API and gRPC, Firebase, mautrix, discordgo, slack-go, a 2018-era Telegram client `go-telegram-bot-api v4.6.4+incompatible`). A program importing only `discord, http, mail, matrix, pushover, slack, telegram`: **12.8 MB** (+4.0 MB over baseline), 93 non-stdlib packages, 159 modules in `go list -m all`. Smaller than shoutrrr's all-in import, but for fewer of the channels we need.

### Others

- `unraid/apprise-go` (BSD-2-Clause, "a Go port of Apprise", created 2026-01-25, latest `v0.3.3` 2026-09-01, 109 stars): CLI-first by its README, 0.x, nine months old. Its use as an importable library was not checked. Not a candidate yet. ([repo](https://github.com/unraid/apprise-go).)
- Searching GitHub for Go notification libraries (`gh search repos`, by stars) surfaces only `nikoksr/notify` and `containrrr/shoutrrr` as multi-service libraries; the rest are desktop-notification, filesystem-event or single-vendor packages. Python Apprise is not usable from Go.

---

## 3. SMTP in Go

### Is `net/smtp` enough?

Read from the standard library docs and source (Go 1.27.0, [pkg.go.dev/net/smtp](https://pkg.go.dev/net/smtp), [`smtp.go`](https://go.dev/src/net/smtp/smtp.go)):

| Need | `net/smtp` |
|---|---|
| Maintenance | Package doc: "The smtp package is frozen and is not accepting new features. Some external packages provide more functionality." |
| STARTTLS | `SendMail` calls `StartTLS` **only if the server advertises it**; there is no way to demand it through `SendMail`. Using `Client` directly, you can require it. |
| Implicit TLS (465) | `Dial` is a plain `net.Dial`. You must `tls.Dial` yourself and pass the connection to `NewClient`. |
| AUTH | Built in: `PlainAuth`, `CRAMMD5Auth`. **No LOGIN.** `PlainAuth` refuses to send credentials on a non-TLS connection unless the host is localhost. Anything else (LOGIN, XOAUTH2) is a custom `Auth`. |
| Timeouts | `Dial` has no timeout and the package takes no context. |
| MIME | "provide no support for DKIM signing, MIME attachments ... Higher-level packages exist outside of the standard library." You build headers, encoding and the multipart HTML/plain body yourself, and header injection is on you beyond the CR/LF check in `SendMail`. |

An adequate sender on `net/smtp` is therefore: our own dial with a timeout, a `tls.Dial` branch for 465, `StartTLS` required for 587, a LOGIN `Auth`, and our own message encoder. That is what a library is for.

### `wneessen/go-mail`

| | |
|---|---|
| Latest release | `v0.8.1`, **2026-07-09** (v0.8.0 2026-07-04, v0.7.3 2026-05-12, v0.7.2 2025-09-29); last push 2026-10-13 |
| Licence | MIT (SPDX header in `go.mod`) |
| Dependencies | `golang.org/x/crypto`, `golang.org/x/text` only; `go 1.26.0` |
| Auth | CRAM-MD5, LOGIN, PLAIN, NTLM, SCRAM-SHA-1/256 (+PLUS), XOAUTH2 |
| TLS | implicit TLS (`WithSSLPort`, port 465), STARTTLS with policies (`TLSMandatory` and others), context-aware dialing, custom dial function |
| Message | RFC 5322 address validation, Message-ID/Date headers, HTML plus plain alternative, attachments, DKIM |
| Stability | 0.x; the API has changed across minors, so pin a version |

Sources: [repo](https://github.com/wneessen/go-mail), [README features](https://github.com/wneessen/go-mail#features), [go.mod](https://github.com/wneessen/go-mail/blob/main/go.mod), [releases](https://github.com/wneessen/go-mail/releases), `go doc` of `TLSPolicy`, `WithSSLPort` and `SMTPAuthType` at v0.8.1. Whether it is "the norm" is not something a primary source can state; what the sources show is that it is the actively maintained, dependency-light option that covers the gaps above, and that both `notify` and `shoutrrr` ship their own SMTP code instead.

---

## 4. ntfy and Gotify HTTP publish APIs

**ntfy** ([Publishing](https://docs.ntfy.sh/publish/); server repo [binwiederhier/ntfy](https://github.com/binwiederhier/ntfy), Apache-2.0, latest `v2.31.1` on 2026-10-17). Publish with `PUT` or `POST` to `https://<host>/<topic>`; the body is the message (`curl -d "text" host/topic`). Title, priority, tags and click URL travel as headers (`Title`/`X-Title`, `Priority` 1 to 5 with 3 default, `Tags` comma-separated, `Click`), or as JSON: `POST` to the **root URL** (not the topic URL) with `{"topic": "...", "message": "...", "title": "...", "tags": ["a","b"], "priority": 4, "click": "https://..."}`; only `topic` is required, `message` defaults to `triggered`. JSON also takes `actions` (up to three buttons), `markdown`, `icon`, `attach`, `delay`. Authentication on protected topics: `Authorization: Bearer tk_<token>` for an access token, `Authorization: Basic ...` for user and password, or either as the `?auth=` query parameter; the docs warn to use HTTPS because Basic is not encryption. A successful publish returns the message as JSON including its `id`. Messages over 4096 bytes are turned into an attachment file. The pages read do not list HTTP error codes or the error body shape: unconfirmed.

**Gotify** ([Push messages](https://gotify.net/docs/pushmsg), [Message extras](https://gotify.net/docs/msgextras), [OpenAPI `docs/spec.json`](https://github.com/gotify/server/blob/master/docs/spec.json); server repo [gotify/server](https://github.com/gotify/server), MIT, latest `v3.1.1` on 2026-09-15). `POST https://<host>/message` with an **application token** (created per app in the web UI or via `POST /application`). The docs show the `X-Gotify-Key: <token>` header; the OpenAPI spec also lists `?token=` and `Authorization: Bearer` for application tokens (client tokens work on the same endpoint in the spec, which is a different credential with read access, so an app token is the right one to store). Fields: `message` (required; Markdown allowed per the spec), `title`, `priority` (integer; unset uses the application's default), `extras` (JSON object). A click URL is `extras["client::notification"].click.url`, honoured by the Android app since v2.0.10; Markdown rendering is `extras["client::display"].contentType = "text/markdown"`. The docs' examples send form fields; the spec declares `application/json`. Documented responses: 200, 400, 401, 403. The numeric meaning of priorities is on a Message Priority page that could not be fetched: unconfirmed.

Judging a direct implementation: both are one request with one auth header, one JSON body, one status check. ntfy's only trap is root URL for JSON versus topic URL for plain; Gotify's is using an application token. Neither needs an SDK.

---

## 5. Home Assistant

Two documented routes, from the Home Assistant docs:

**A. REST API with a long-lived access token.** The user creates a token on their profile (Security); CloudBank calls `POST https://<ha>/api/services/notify/mobile_app_<device_id>` with `Authorization: Bearer <token>` and a JSON body such as `{"message": "...", "title": "...", "data": {...}}`. The documented statuses are 200, 400, 401, 404, 405, 500 and 503. `<device_id>` is the device name with spaces and non-alphanumerics turned into underscores, visible in the Companion App section of HA's settings. The Companion docs list `title` and `message` (at least `message` is required), and the tap target as `data.url` on iOS and `data.clickAction` on Android. Nothing on the pages read says the token can be limited to notifications: unconfirmed, and the REST page says every request needs an access token. Sources: [REST API](https://contributors.home-assistant.io/core/internals/rest-api/) (the old `developers.home-assistant.io/docs/api/rest/` URL redirects there), [Companion: basic notifications](https://companion.home-assistant.io/docs/notifications/notifications-basic/). This is also what shoutrrr's `homeassistant://` service does (`POST /api/services/{domain}/{service}`, Bearer token); its own docs say webhook triggers are not part of it ([docs](https://github.com/nicholas-fedor/shoutrrr/blob/main/docs/services/push/homeassistant/index.md)).

**B. Webhook trigger automation.** The user writes one automation with a `webhook` trigger and a `webhook_id`, whose action calls `notify.mobile_app_<device>` using the posted fields; CloudBank POSTs to `https://<ha>/api/webhook/<webhook_id>` (PUT recommended; JSON needs `Content-Type: application/json` and arrives as `trigger.json`). No token: "Webhook endpoints don't require authentication, other than knowing a valid webhook ID", so the ID is a secret and HA's docs say to make it unique and hard to guess and not to use webhooks for safety-sensitive actions. `local_only` limits callers to the local network (and Nabu Casa cloud webhooks); the docs imply it is on by default, and the source confirms `config.get(CONF_LOCAL_ONLY, True)` ([trigger docs](https://www.home-assistant.io/docs/automation/trigger/#webhook-trigger), [`webhook/trigger.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/webhook/trigger.py)). A CloudBank container outside the user's LAN therefore needs `local_only: false` or Nabu Casa.

**Simplest:** A, because the user only creates a token and picks a device, with no automation to write. **Least privilege:** B, because what leaks if CloudBank's database is read is one webhook URL that can fire one automation, not an account-wide API token. B needs nothing HA-specific in CloudBank: it is the generic webhook channel, so the HA entry on the settings page can be a documentation snippet plus a preset. If the generic channel supports a custom header and a JSON template, A also fits it.

---

## Verdict

**Write the senders ourselves, behind one small interface in `internal/`, and use `go-mail` for SMTP.**

Why:

1. **Most of the channels are one HTTP request.** ntfy, Gotify, a generic webhook, Home Assistant (either route) and, as far as the shoutrrr docs show, Discord, Slack, Telegram and Pushover are each a JSON `POST` with a token. (The last four are not confirmed against their own docs.) A library adds a URL-string config layer on top of requests we would write in an afternoon each. Matrix needs a login and idempotent transaction IDs and can wait.
2. **The one hard channel, SMTP, has a good small library** (`go-mail`: MIT, two dependencies, implicit TLS, mandatory STARTTLS, LOGIN, contexts).
3. **We need typed delivery results.** The settings page should show "last delivery failed: 401" per channel and stop retrying a dead token. shoutrrr gives a string; notify gives the first error only. With our own senders the status code is a field.
4. **We keep the egress policy.** Users type hosts (ntfy, Gotify and Home Assistant are usually on a LAN, so a blanket private-range block is wrong). One `http.Client` of ours, with a per-channel allow rule and timeouts, is the single place to decide that. shoutrrr's fork allows injecting a client, so this is not unique to a direct build, but with a direct build there is nothing to wire around.
5. **Config as fields, secrets through `internal/secrets`.** A form maps to token / host / topic fields; no credentials-in-a-URL blob to build and parse.
6. **Weight and risk.** No new dependency but `go-mail`. The fork is the better of the two libraries and is the fallback if the channel list grows to the long tail (Teams, PagerDuty, Zulip, Signal ...): pin the exact tag, import only the service packages used, and wrap it behind the same interface. `nikoksr/notify` is the worse fit (missing ntfy, Gotify and Home Assistant; first-error-only; heavy graph). Upstream `containrrr/shoutrrr` is dormant.

**Left unconfirmed:**
- The HTTP APIs of Telegram, Discord, Slack, Pushover and Matrix (not read; shoutrrr's docs were used only for their URL formats).
- Whether importing only some `pkg/services/...` packages avoids linking MQTT and XMPP.
- ntfy's error status codes and error body, and Gotify's numeric priority meanings.
- Whether a Home Assistant long-lived token can be scoped.
- Binary sizes on linux/amd64 with the production build flags (measured on windows/amd64, unstripped).
- Whether `unraid/apprise-go` can be imported as a library.
- That EDL-1.0 satisfies AGPL compatibility for `paho.golang` (my reading; not legal advice).
