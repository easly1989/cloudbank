# CloudBank guides

The [wiki](https://github.com/easly1989/cloudbank/wiki) shows these same guides,
copied from `docs/` whenever they change. Corrections go to `docs/`, through a
pull request: an edit made in the wiki is overwritten.

## Start here

- [Getting started](getting-started.md): from a fresh install to your first
  transactions. The administrator, a wallet, accounts, categories, the entry
  sheet and reconciling.
- [Migrating from HomeBank](migrate-from-homebank.md): bring a HomeBank `.xhb`
  file across in one upload, and go back whenever you like.

## Using CloudBank

- [Using CloudBank, page by page](pages.md): what each page is for and what it
  can do.
- [Importing transactions](import.md): bank CSV, QIF, OFX and CAMT.053 files. The
  column mapping, the review, and what to do when rows come in wrong.
- [Automatic bank sync](bank-sync.md): connecting a bank through SimpleFIN,
  Enable Banking or Pluggy.
- [Bank mails](bank-mails.md): reading the bank's payment notices from a
  mailbox, with patterns you make by selecting text in a mail, or with the AI;
  and what happens when the bank's own row arrives.
- [Notifications](notifications.md): the bell, push, email, Matrix, Telegram, Discord, Slack, ntfy, Gotify and webhooks; which
  events go where, and connecting Home Assistant.
- [The AI, and what it sees](ai.md): setting up your own model, what each job
  does and sends, what stays with you, and the monthly limit.
- [CloudBank in Home Assistant](home-assistant.md): bills, this month's budget
  and Review as sensors, read with an API token; balances only if you ask.
- [Adding from your phone](pages.md#adding-from-your-phone): the home-screen
  shortcuts, sharing a bank's notification, and scanning a receipt.
- [Ask your data](pages.md#ai-insights): a question about your money, answered
  from CloudBank's own queries, with the numbers it used.
- [Schedules in your phone's calendar](pages.md#schedules): **Add to calendar**
  and how to subscribe on an iPhone, in Google Calendar or in Outlook.

## Running CloudBank

- [Backups, upgrades and restoring](backup.md): what each backup holds, a
  routine that works, upgrading, and getting it all back.
- [Reverse proxy and HTTPS](reverse-proxy.md): putting CloudBank behind Caddy
  or nginx.
- [Signing in with OIDC](sso.md): single sign-on through Authelia, Authentik,
  Keycloak or Google, next to passwords or in their place, and the recovery
  codes for when the provider does not answer.
- [Configuration](../README.md#configuration): every `CB_*` setting.
- [Container images](../README.md#container-images-and-tag-convention): which
  tag is stable and which is the nightly.
- [The live demo](demo.md): what it is, what it switches off, and when it
  forgets you.

## Extending CloudBank

- [Writing a bank import plugin](import-plugins.md): teach the importer a bank's
  own file format.
- **The API:** every running CloudBank serves its interactive reference at
  `/api/docs`.
- [Contributing](../CONTRIBUTING.md): running from source, and how changes are
  made.
- [Translation glossary](i18n/glossary.md): the words CloudBank uses in each
  language it speaks, and the style each translation follows.

Something missing or wrong? [Open an issue](https://github.com/easly1989/cloudbank/issues/new).
