# Notifications

CloudBank tells you when something needs you: a sign-in from a new device, a
bank sync that failed, a bank mailbox that stopped working, bills coming due,
a large expense or a low balance.
Every notice lands
in the bell in the page header, kept for 90 days. It can also reach you
somewhere else: push on a device, email, a Matrix room, Telegram, Discord,
Slack, ntfy, Gotify, or a webhook of your own, such as Home Assistant.

It lives in **Settings › Notifications**: a list of the channels, each with how
it stands and how many events it gets, and a page for each channel to connect
it and pick its events. The [demo](demo.md) has only the bell.

- [Channels](#channels)
- [Which events go where](#which-events-go-where)
- [Money](#money)
- [When notifications arrive](#when-notifications-arrive)
- [When a delivery fails](#when-a-delivery-fails)
- [Confirming an address](#confirming-an-address)
- [Matrix](#matrix)
- [Telegram](#telegram)
- [Discord](#discord)
- [Slack](#slack)
- [ntfy](#ntfy)
- [Gotify](#gotify)
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
- **ntfy** and **Gotify.** A push to your phone through ntfy, public or
  self-hosted, or through a Gotify server of yours. See [ntfy](#ntfy) and
  [Gotify](#gotify).
- **Webhook.** A POST with the event as JSON to a URL of yours: Home Assistant,
  n8n, a script. See [the webhook](#the-webhook).

Once saved, and [confirmed](#confirming-an-address) where it needs to be,
every channel has **Send a test**, which sends a notice at once and says how it
went.

## Which events go where

Each channel's page ends with **What arrives here**: a box for each event. The
boxes start on, except the [money events](#money) and the summaries, which start off; untick the ones you do not want on that channel. A channel that
is not connected yet gets nothing, so its boxes wait until it is. Push is the
exception: it is switched on per device, and its boxes can be set before.

| Event | What it means | It opens |
| --- | --- | --- |
| A sign-in from a new device | Someone signed in from a browser or system your account has not used before, such as Firefox on Windows, or a script. The first device of an account, and a browser update, are not announced. | Security |
| Two-factor authentication turned off | Your account signs in with the password alone from then on. | Security |
| A new API token | A token was created on your account, with its name and whether it can write. | Security |
| Bank sync fails | A scheduled [bank sync](bank-sync.md) did not go through. Told once, until a sync works again; a **Sync now** that fails is on screen already. Every member of the wallet hears of it. | Bank sync |
| Bank consent ending | A bank's PSD2 consent ends within a week and needs renewing. Told once per consent, to every member of the wallet. | Bank sync |
| A bank mailbox stops | CloudBank can no longer sign in to a [bank mail](bank-mails.md) mailbox, and it needs connecting again. | Bank mails |
| Bank mails not recognised | Mails arrive that no pattern can read. | Bank mails |
| Transactions to review | Transactions have waited on the Review page longer than you chose: 1, 3 (the default), 7 or 14 days, set under the event on any channel's page. Told once, and again only when more pass the wait. | Review |
| Bills coming due | Scheduled transactions due in the next three days, or already late. | Schedules |
| Large expense | An expense over the account's threshold. See [Money](#money). | The account's register |
| Low balance | An account's balance today went below its threshold. | The account's register |
| Budget at 80% and 100% | A category has used 80% of this month's budget, then all of it. | Budget |
| Goal reached or falling behind | A goal reached its target, or is behind the pace it needs. | Goals |
| Weekly summary | On Monday, for each wallet you hear from: money in and out last week, the week before, the three categories that took most, and the bills of the next 7 days. A week with nothing to tell sends nothing. | Reports |
| Monthly summary | On the 1st, the same for last month, without the bills. | Reports |
| AI report ready | Your AI wrote a scheduled report ([AI insights](pages.md#ai-insights)): the period and the wallet, never the amounts. Also when one was skipped at this month's AI limit. | The report, or Settings → AI |
| AI proposal ready | Your AI proposed budgets from what you really spend ([Budget](pages.md#budget)), found subscriptions to look at ([Schedules](pages.md#schedules)), savings ([AI insights](pages.md#ai-insights)), goals ([Goals](pages.md#goals)) or rules ([Rules](pages.md#rules)), once a month each. The wallet, never the amounts. | Budget, Schedules, AI insights, Goals or Rules |
| Unusual transaction | Your AI found an expense out of scale for its payee, a new payee with a large amount, or a double charge ([Review](pages.md#review)). On in the bell, off elsewhere. | The transaction in the register |
| A new CloudBank version | A newer release is out on the channel the server follows. Administrators only. | About |

The three security events always reach the bell, even with every other channel
turned off: a sign-in you did not make should not go unnoticed. Their other
channels can be turned off like any event's. No notice carries a full card
number or IBAN: a bank is named by the name you gave its connection.

## Money

The four money events start off on every channel: tick them in a channel's
page, in the **Money** group. Where and when they speak is set on **Settings ›
Notifications › Thresholds and wallets**, the row under the channels.

- **Large expense** and **Low balance** need a threshold per account, in the
  account's currency: **Expense over** and **Balance below**. An empty field
  announces nothing for that account. The account's minimum balance, if it has
  one, is shown as a suggestion in the empty field; it is not used until you
  type it.
- **Large expense** tells you about what you did not type yourself: what bank
  sync, a bank mail or an automatic schedule wrote, and what another member of
  the wallet entered. Your own entries and file imports are not announced.
  Expenses only, never money in.
- **Low balance** looks at today's balance, so a future-dated transaction does
  not count yet. It is told once when the balance goes below the threshold,
  and again only after it has gone back above.
- **Budget at 80% and 100%** is per category, for the current month: once at
  80% and once at 100%.
- **Goal reached** is told once. **Falling behind** compares what went in
  lately with what the goal needs each month, as the Goals page does; it is
  checked on the first of the month, at most once a month.

CloudBank looks at the money every five minutes, so a notice can arrive a few
minutes after the transaction. The administrator can change this with
`CB_MONEY_INTERVAL`, or turn these events off with `0`, along with
the review reminder and the summaries.

**Wallets.** Every event about a wallet (bills, bank sync, bank consent and the
money events) reaches you only from the wallets ticked here; all of them are
ticked to start. A wallet left out tells you nothing on any channel. Thresholds
and wallets are your own: another member of the wallet chooses for themselves.

**Amounts.** The bell always shows amounts. **Show amounts outside the app**
starts on; turned off, push, email and the chat channels say where something
happened, never how much: "Checking is below its threshold."

## When notifications arrive

The bell shows everything at once, always. Push, email and the chat channels
follow **Settings › Notifications › Timing**, the row under the channels:

- **Daily digest.** Each event can come **at once** or **in the digest**: the
  choice holds for push, email and chat together. At the digest time (08:00 to
  start) the events collected since the last one arrive as one message on each
  channel; a single event arrives as itself, and a day with none sends nothing.
  Security events always come at once. The weekly and monthly summaries come at
  the digest time.
- **Quiet hours.** Off to start; turned on, 22:00 to 07:00 unless you change
  it. Meanwhile push, email and chat hold what is not urgent and send it when
  the quiet hours end: one held event as itself, several as one message.
  Problems and security arrive anyway.

Times are in your time zone, which CloudBank takes from your browser each time
you open it; the page shows which one it uses.

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

A bot of your own, Discord, Slack, ntfy, Gotify and the webhook send through
something of yours, so they need no code.

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

## ntfy

[ntfy](https://ntfy.sh) delivers to its phone app whatever is published to a
topic you subscribe to.

1. **Server**: leave it empty for the public `ntfy.sh`, or give your own, such
   as `https://ntfy.example.org`. A server on your local network can only be
   saved by an administrator.
2. **Topic**: the name you subscribe to in the ntfy app. On `ntfy.sh` anyone
   who knows a topic can read it, so pick a long name that is hard to guess.
3. **Access token**, optional: for a server or a topic that needs one, an
   ntfy access token (`tk_…`). It is stored encrypted when the server has
   `CB_SECRET_KEY` and never comes back to the page.

A refused token shows as **Last delivery failed: 401** or **403**.

## Gotify

[Gotify](https://gotify.net) is a server of your own that pushes to its phone
app.

1. In Gotify, **Apps › Create application**, and copy its token.
2. In CloudBank, the **Server**, such as `https://gotify.example.org`, and the
   **Application token**. A server on your local network can only be saved by
   an administrator.

The token is stored encrypted when the server has `CB_SECRET_KEY` and never
comes back to the page. A refused one shows as **Last delivery failed: 401**.

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

To show CloudBank's numbers as sensors instead, such as the bills due this
week, see [CloudBank in Home Assistant](home-assistant.md).

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
next one goes through. A bot of your own, Discord, Slack, ntfy, Gotify and the
webhook are not capped.
