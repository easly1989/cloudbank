# The live demo

**<https://p01--cloudbank--7dcjw6mlmtky.code.run/>**

The demo is there so you can decide whether to run CloudBank yourself without
installing anything first. It is a real CloudBank with made-up data. It forgets
you on purpose, so read the next few lines before you type anything you care
about into it.

## What you get

- **One button, no sign-up.** **Start the demo** makes an account on the spot:
  no username, email or password. You are signed straight in.
- **A year of made-up money.** A wallet called _Demo wallet_ with a checking
  account, savings, a credit card and cash, and a year of transactions: salary,
  rent, bills, groceries, a summer holiday, transfers between the accounts.
  Budgets, bills, scheduled transactions and two savings goals are set up
  already, so the dashboard, the reports and the Bills page have something to
  show.
- **Your own copy.** Nobody else sees your account, and you can change anything:
  add, edit and delete transactions, rearrange the dashboard, import a file.
- **Your language.** The data comes in English or Italian, from your browser's
  language.

## What is switched off, and why

These are not bugs, so please don't report them as bugs:

- **Bank sync talks to a pretend bank.** The demo reaches no real bank. Connect
  _Demo Bank_ on the Bank sync page and each sync makes up a few days of card
  payments, which then run through reconciliation and the Review page like the
  real thing. SimpleFIN, Enable Banking and Pluggy are not offered.
- **No attachments, no AI, no push notifications, no API tokens, no two-factor
  sign-in and no SSO.** Each of these needs something a throwaway account
  should not have: stored files, your API key, a device or an identity provider.
- **No restore, no administration.** You can download a backup or an `.xhb`
  export of your demo wallet, but not restore one. There is no People section
  and no admin account.
- **Limits.** At most 3 wallets, 5,000 transactions and 1 MB per upload. Going
  past one says so ("That is as much as the demo allows").
- **Getting in can be refused.** When too many demos are running, or several
  have been started from your address in the last hour, the front door asks you
  to try again later.

## When it forgets you

Your account and everything in it are deleted:

- **after 2 hours without use**,
- **every night at 03:00 UTC**, and
- **whenever the demo is updated**, which can happen at any time of day.

There is no way to keep a demo account, and no warning before one of these
happens. It says so three times: on the front door, in a notice that opens by
itself the first time you get in, and in a yellow band at the top of every
page. The band's **What's different here?** link opens the notice again.

## Next: run it for real

If you like what you see, CloudBank is one container and a volume. The
[quick start](../README.md#quick-start) gets you running in a couple of
minutes, and [Migrating from HomeBank](migrate-from-homebank.md) brings your
existing file over.

The demo itself is the `:demo` image. It is a different build from the one you
would install; see [Container images](../README.md#container-images-and-tag-convention)
before running it anywhere.
