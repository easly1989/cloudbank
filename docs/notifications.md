# Notifications

CloudBank tells you when something needs you: a bank mailbox that stopped
working, bank mails no pattern could read, bills coming due. Every notice lands
in the bell in the page header, kept for 90 days. It can also reach you
somewhere else: push on a device, email, a Matrix room, or a webhook of your
own, such as Home Assistant.

It lives in **Settings › Notifications**. The [demo](demo.md) has only the bell.

- [Channels](#channels)
- [Which events go where](#which-events-go-where)
- [When a delivery fails](#when-a-delivery-fails)
- [Matrix](#matrix)
- [The webhook](#the-webhook)
- [Home Assistant](#home-assistant)
- [For the administrator: the mail server](#for-the-administrator-the-mail-server)
- [For the administrator: a shared Matrix bot](#for-the-administrator-a-shared-matrix-bot)

## Channels

- **Push on this device.** The browser's own notifications, switched on per
  device. On an iPhone, add CloudBank to the home screen first.
- **Email.** To the address you choose, which starts as your account's own. It
  shows up only once the administrator has
  [set up a mail server](#for-the-administrator-the-mail-server).
- **Matrix.** A message in a room of yours, from the installation's bot or from
  a bot of your own. See [Matrix](#matrix).
- **Webhook.** A POST with the event as JSON to a URL of yours: Home Assistant,
  n8n, a script. See [the webhook](#the-webhook).

Every channel has **Send a test**, which sends a notice at once and says how it
went. Email, Matrix and the webhook join the events table once they are saved.

## Which events go where

The table under the channels has a row for each event and a box for each
channel. The boxes start on; untick the ones you do not want. A channel that
is not set up gets nothing, whatever its box says.

| Event | What it means |
| --- | --- |
| A bank mailbox stops | CloudBank can no longer sign in to a [bank mail](bank-mails.md) mailbox, and it needs connecting again. |
| Bank mails not recognised | Mails arrive that no pattern can read. |
| Bills coming due | Scheduled transactions due in the next three days, or already late. |

## When a delivery fails

A delivery that fails because the other end could not be reached, or answered
"busy" (a timeout, 408, 429 or a 5xx, or a mail server's temporary 4xx), is tried again after 1 minute, then 5
and 30 minutes, then 2 and 6 hours. The tries survive a restart. A refusal is
not tried again: credentials refused (401 or 403, or the mail server's 535),
or the message refused.

The channel's card keeps the outcome: **Last delivered** with the time, or
**Last delivery failed** with the reason or the status code, until the next
delivery goes through. The bell has every notice whatever happened to the
other channels.

## Matrix

CloudBank posts each notice as a message in one Matrix room, which any Matrix
app shows: Element, FluffyChat, Cinny. A room with only you and the bot works
best. Messages are sent unencrypted: in an encrypted room your app marks them
as such.

**The room ID.** CloudBank needs the room's ID, which starts with `!`, not its
address (`#name:server`). In Element: the room's **Settings › Advanced ›
Internal room ID**.

**With the installation's bot.** When the administrator has
[set one up](#for-the-administrator-a-shared-matrix-bot), the card names the
bot, such as `@cloudbank:example.org`. Invite it to the room, then paste the
room ID and save. The bot accepts the invitation the first time it posts, so
**Send a test** right away tells you it works.

**With a bot of your own.** Without a shared bot the card asks for three
things:

1. **Homeserver**: the address of the bot account's server, such as
   `https://matrix.org`. A homeserver on your local network can only be saved
   by an administrator.
2. **Room ID**, as above. Invite the bot account to the room; CloudBank
   accepts the invitation for it.
3. **The bot's access token.** Make a separate account for the bot rather than
   using your own: the token can do everything the account can. Sign in to it
   once in Element, copy the token from **Settings › Help & About ›
   Advanced › Access token**, then close that tab *without signing out*:
   signing out ends the token.

The token is stored encrypted when the server has `CB_SECRET_KEY`, and never
comes back to the page: to change it, type the new one over **Saved**.

A refused token shows as **Last delivery failed: 401**; a 403 means the bot
could not join the room, usually because it was not invited.

## The webhook

CloudBank sends a `POST` with `Content-Type: application/json`:

```json
{
  "event": "bills",
  "title": "2 bills due",
  "body": "Rent, Electricity",
  "path": "/schedules",
  "walletId": 1,
  "sentAt": "2026-10-18T07:30:00Z",
  "test": false
}
```

| Field | Meaning |
| --- | --- |
| `event` | `bills`, `mail_stopped` or `mail_unrecognized`, or `test` for **Send a test**; a new kind may be added. |
| `title`, `body` | The notice, in your language, as the bell shows it. |
| `path` | The CloudBank page it is about, to append to your CloudBank's address. |
| `walletId` | The wallet it is about, when there is one. |
| `sentAt` | When it was sent, UTC, RFC 3339. |
| `test` | `true` for **Send a test**. |

Any `2xx` answer counts as delivered; CloudBank never reads the body.

**The signing secret** is optional. With one, every request carries
`X-CloudBank-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body keyed
with the secret. Compute the same over the body you received and compare in
constant time to know the request came from your CloudBank.

The URL and the secret are stored encrypted when the server has
`CB_SECRET_KEY`. Settings shows only the URL's host and whether a secret is
set; to change either, type the new one over it.

**The local network.** A URL saved by a member must be on the public internet.
Only an administrator can save one on the local network, such as
`http://homeassistant.local:8123`, because a request from the server can reach
what the members' own browsers cannot.

## Home Assistant

Home Assistant receives it with a
[webhook trigger](https://www.home-assistant.io/docs/automation/trigger/#webhook-trigger).
Pick a long random webhook id: it is the only thing that guards the URL, since
Home Assistant cannot check the signature, so leave the secret empty.

```yaml
automation:
  - alias: "CloudBank notice to my phone"
    triggers:
      - trigger: webhook
        webhook_id: "cloudbank-replace-with-a-long-random-id"
        allowed_methods: [POST]
        local_only: true
    conditions:
      - condition: template
        value_template: "{{ not trigger.json.test }}"
    actions:
      - action: notify.mobile_app_my_phone
        data:
          title: "{{ trigger.json.title }}"
          message: "{{ trigger.json.body }}"
          data:
            url: "https://cloudbank.example.com{{ trigger.json.path }}"
```

In CloudBank the URL is `http://<home-assistant>:8123/api/webhook/<webhook id>`.
With `local_only: true`, Home Assistant accepts it only from your own network,
so an administrator saves it; drop the `test` condition while you try it out.

## For the administrator: the mail server

Email needs an SMTP server, set with these variables (see
[Configuration](../README.md#configuration)):

| Variable | Default | Meaning |
| --- | --- | --- |
| `CB_SMTP_HOST` | _(none)_ | The server. Without it, or without `CB_SMTP_FROM`, there is no email channel. |
| `CB_SMTP_PORT` | `587` | Its port. |
| `CB_SMTP_USERNAME`, `CB_SMTP_PASSWORD` | _(none)_ | The sign-in, when the server wants one. |
| `CB_SMTP_FROM` | _(none)_ | The sender address on every mail. |
| `CB_SMTP_TLS` | `starttls` | `starttls` (required, port 587), `tls` (port 465) or `none`, which sends the password unencrypted: only for a server on the same machine. |

A mail provider's app password works, such as Gmail's with two-step
verification on, and so does a transactional service such as Brevo or Mailgun.

## For the administrator: a shared Matrix bot

With a shared bot, people give only the room. Make an account for it on a
homeserver, get its access token as described [above](#matrix), and set:

| Variable | Meaning |
| --- | --- |
| `CB_MATRIX_HOMESERVER` | The bot's homeserver, such as `https://matrix.example.org`. It may be on the local network. |
| `CB_MATRIX_TOKEN` | The bot's access token. |

Both are needed. The card shows the bot's Matrix ID, read from the homeserver,
so people know whom to invite. The bot posts only in rooms it was invited to.
