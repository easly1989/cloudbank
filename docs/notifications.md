# Notifications

CloudBank tells you when something needs you: a bank mailbox that stopped
working, bank mails no pattern could read, bills coming due. Every notice lands
in the bell in the page header, kept for 90 days. It can also reach you
somewhere else: push on a device, email, a Matrix room, Telegram, Discord,
Slack, or a webhook of your own, such as Home Assistant.

It lives in **Settings › Notifications**: a list of the channels, each with how
it stands and how many events it gets, and a page for each channel to connect
it and pick its events. The [demo](demo.md) has only the bell.

- [Channels](#channels)
- [Which events go where](#which-events-go-where)
- [When a delivery fails](#when-a-delivery-fails)
- [Confirming an address](#confirming-an-address)
- [Matrix](#matrix)
- [Telegram](#telegram)
- [Discord](#discord)
- [Slack](#slack)
- [The webhook](#the-webhook)
- [Home Assistant](#home-assistant)
- [For the administrator: the mail server](#for-the-administrator-the-mail-server)
- [For the administrator: a shared Matrix bot](#for-the-administrator-a-shared-matrix-bot)
- [For the administrator: a shared Telegram bot](#for-the-administrator-a-shared-telegram-bot)
- [Limits on the installation's own channels](#limits-on-the-installations-own-channels)

## Channels

- **Push on this device.** The browser's own notifications, switched on per
  device. On an iPhone, add CloudBank to the home screen first.
- **Email.** To the address you choose, which starts as your account's own. It
  shows up only once the administrator has
  [set up a mail server](#for-the-administrator-the-mail-server).
- **Matrix.** A message in a room of yours, from the installation's bot or from
  a bot of your own. See [Matrix](#matrix).
- **Telegram.** A message from the installation's bot or a bot of your own. See
  [Telegram](#telegram).
- **Discord** and **Slack.** A message in a channel, through its incoming
  webhook. See [Discord](#discord) and [Slack](#slack).
- **Webhook.** A POST with the event as JSON to a URL of yours: Home Assistant,
  n8n, a script. See [the webhook](#the-webhook).

Once saved, and [confirmed](#confirming-an-address) where it needs to be,
every channel has **Send a test**, which sends a notice at once and says how it
went.

## Which events go where

Each channel's page ends with **What arrives here**: a box for each event. The
boxes start on; untick the ones you do not want on that channel. A channel that
is not connected yet gets nothing, so its boxes wait until it is. Push is the
exception: it is switched on per device, and its boxes can be set before.

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

The channel's page, and its line in the list, keep the outcome: **Last delivered** with the time, or
**Last delivery failed** with the reason or the status code, until the next
delivery goes through. The bell has every notice whatever happened to the
other channels.

## Confirming an address

Email, and the installation's own Matrix and Telegram bots, send through
something the administrator runs. So that nobody can use them to write to
people who did not ask, an address gets nothing, not even a test, until you
show it is yours. Until then the channel reads **Waiting for its code**.

- **Email.** Saving an address mails it a 6-digit code: type it on the page
  and press **Confirm**.
- **Matrix, with the installation's bot.** The bot joins only a room it was
  invited to, then writes a 6-digit code in it. See [Matrix](#matrix).
- **Telegram, with the installation's bot.** No code to type: the link that
  opens Telegram carries it. See [Telegram](#telegram).

A code is good for 15 minutes and 5 tries. After that, or when it did not
arrive, **Send another**. A new address needs a new code; saving the same one
again does not.

A bot of your own, Discord, Slack and the webhook send through something of
yours, so they need no code.

## Matrix

CloudBank posts each notice as a message in one Matrix room, which any Matrix
app shows: Element, FluffyChat, Cinny. A room with only you and the bot works
best. Messages are sent unencrypted: in an encrypted room your app marks them
as such.

**The room ID.** CloudBank needs the room's ID, which starts with `!`, not its
address (`#name:server`). In Element: the room's **Settings › Advanced ›
Internal room ID**.

**With the installation's bot.** When the administrator has
[set one up](#for-the-administrator-a-shared-matrix-bot), the page offers
**CloudBank's bot** or **Your bot**. With CloudBank's, three steps:

1. Invite the bot the page names, such as `@cloudbank:example.org`, to the
   room.
2. Paste the room ID and press **Connect**. The bot joins only a room it has
   an invitation to: without one the page says so, and nothing is saved.
3. The bot joins and writes a 6-digit code in the room. Type it on the page
   and press **Confirm**.

**With a bot of your own.** Without a shared bot, or with **Your bot** picked,
the page asks for three things:

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

## Telegram

CloudBank sends each notice as a message from a Telegram bot, to your private
chat with it or to a group it is in.

**The chat ID**, with a bot of your own. A number: your own user ID for a private chat, or the group's
ID, which for a group starts with `-` (`-100…` for most). A public channel can
be given as `@name` instead, with the bot added to it as an administrator. To
learn your own ID, send `/my_id` to a bot such as `@get_id_bot` (a third-party
bot, not part of CloudBank); with a bot of your own you can also open
`https://api.telegram.org/bot<token>/getUpdates` after writing to it and read
`chat.id`.

**With the installation's bot.** When the administrator has
[set one up](#for-the-administrator-a-shared-telegram-bot), the page offers
**CloudBank's bot** or **Your bot**. With CloudBank's there is no chat ID to
find: press **Connect your chat**, then open Telegram with the button and
press **Start** in the chat with the bot. **Add to a group** does the same for
a group: Telegram asks which one and adds the bot to it. The link carries a
code good for 15 minutes; the page waits and shows the chat once it is
connected. A link that expired gives way to **New link**.

**With a bot of your own.** Without a shared bot, or with **Your bot** picked,
the page asks for the bot's token as well. Create the bot with Telegram's `@BotFather` (`/newbot`), which
replies with the token (`123456:ABC…`). Send your bot `/start`, then save the
chat ID and the token. The token is stored encrypted when the server has
`CB_SECRET_KEY` and never comes back to the page. Going back to CloudBank's bot
forgets it.

Two settings are optional, with either bot:

- **Topic ID.** In a group with topics, the topic the messages go to. It is the
  middle number of a message link copied in that topic
  (`https://t.me/c/<group>/<topic>/<message>`). Empty, they go to the group's
  General topic.
- **Send silently.** The messages arrive without a sound.

A refused token shows as **Last delivery failed: 401**; a 400 usually means a
wrong chat ID, and a 403 a bot you have not written to or have blocked.

## Discord

In Discord: **Server Settings › Integrations › Webhooks › New Webhook**, pick
the channel, then **Copy Webhook URL**. Paste it on the Discord page and save.

The URL is the key to post in that channel: CloudBank keeps it encrypted and
shows only its host. To change it, paste the new one. Deleting the webhook in
Discord shows as **Last delivery failed: 404**, a wrong one as **401**.

## Slack

Slack takes messages through an app with incoming webhooks:

1. At <https://api.slack.com/apps>, **Create New App › From scratch**, and pick
   the workspace.
2. **Incoming Webhooks** › switch them on › **Add New Webhook to Workspace**,
   and pick the channel.
3. Copy the webhook URL (`https://hooks.slack.com/services/…`) into the Slack
   page and save.

As with Discord, the URL is the key: CloudBank keeps it encrypted and shows only
its host. A revoked webhook shows as **Last delivery failed: 403** or **404**.

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

Both are needed. The Matrix page shows the bot's Matrix ID, read from the homeserver,
so people know whom to invite. It joins only a room it has a pending
invitation to, read with `/sync`, and proves the room with a code before it
posts anything else there.

## For the administrator: a shared Telegram bot

With a shared bot, people connect their chat with a link and need no bot of
their own. Create the bot with
`@BotFather` (`/newbot`) and set its token:

| Variable | Meaning |
| --- | --- |
| `CB_TELEGRAM_TOKEN` | The bot's token, `123456:ABC…`. |
| `CB_TELEGRAM_API` | Testing only: another Bot API root instead of `https://api.telegram.org`. Leave unset. |

The Telegram page shows the bot's `@username`, read from Telegram, and builds
the links that start it. CloudBank reads what is sent to the bot with
`getUpdates`, only while someone's page waits for a link to be used, so the bot
must not have a webhook set.

## Limits on the installation's own channels

Each person gets at most `CB_NOTIFY_HOURLY_LIMIT` notifications an hour (30
unless the administrator sets it; `0` turns the cap off) on each channel that
goes through the installation: email, and the shared Matrix and Telegram bots.
Tests and codes count too. Past the cap the rest wait for the next hour, and
the channel reads **Last delivery failed: hourly limit reached**, until the
next one goes through. A bot of your own, Discord, Slack and the webhook are not
capped.
