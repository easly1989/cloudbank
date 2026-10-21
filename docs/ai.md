# The AI, and what it sees

CloudBank can use an AI model of your choice to write reports, propose budgets
and point out what looks odd. It is off until you set it up, it uses your own
key, and every job says what it sends before you switch it on.

- [Setting it up](#setting-it-up)
- [What it does](#what-it-does)
- [What it sends](#what-it-sends)
- [What stays with you](#what-stays-with-you)
- [The monthly limit](#the-monthly-limit)

## Setting it up

In **Settings → AI**:

1. **Your provider.** Any service that speaks the OpenAI chat API: its address
   (such as `https://api.openai.com/v1`), the model, and your key. A model on
   your own network, such as Ollama or LM Studio, works too, but only an
   administrator can set an address on the local network.
2. **Switch it on**, then the jobs you want, one by one. Off, CloudBank sends
   nothing to any model.
3. **On which wallets.** The AI works only on the wallets you tick.

The live demo has no AI.

## What it does

CloudBank works out the numbers itself; the model only writes the words around
them. Everything the model wrote sits in the **AI box**, a frame with a slowly
changing border (still when your system asks for less motion, or when you turn
it off in Settings → AI). Its **Why?** shows the numbers it was given, and the
thumbs say whether it helped.

| Job | Where it shows |
| --- | --- |
| **Monthly reports**, and weekly or yearly ones if you tick them | [AI insights](pages.md#ai-insights), and a notification when one is written |
| **Budget proposals**: budgets from what you really spend | [Budget](pages.md#budget) and the overview |
| **Subscription proposals**: schedules that cost more, look doubled, or no longer appear in the bank | [Schedules](pages.md#schedules) |
| **Savings proposals**: categories grown lately | [AI insights](pages.md#ai-insights) and the overview |
| **Goal proposals**: goals behind, or with no date | [Goals](pages.md#goals) |
| **Rule proposals**: payees you always file under one category, a rule each | [Rules](pages.md#rules) |
| **Unusual transactions**: a payee far over its usual amount, a large new payee, a charge taken twice | [Review](pages.md#review), the overview and the bell |
| **Category suggestion** | The entry sheet |
| **Quick entry**: a sentence, or [text shared](pages.md#adding-from-your-phone) from your phone, turned into the fields | The entry sheet |
| **Bank mails**: the mails no pattern reads | [Bank mails](bank-mails.md) |

Nothing the AI proposes is saved by itself: **Apply** and the like open the
usual sheet, filled in, and you save it there.

## What it sends

Each job's switch says what it sends:

- **Monthly reports**: the month's totals by category, against the month before
  and your budgets, the three largest expenses (payee, amount and date) and next
  month's bills. Never the memos.
- **Budget, subscription, savings and goal proposals**: for each line proposed,
  its name and the figures behind the proposal. Never the transactions.
- **Rule proposals**: for each payee proposed, its name, its category and how
  many of its transactions have it. Never an amount, a memo or a date.
- **Unusual transactions**: for each expense flagged, the payee, the date and the
  amount, with the payee's usual amount. Never the memo.
- **Category suggestion**: the payee and the amount, with your categories.
- **Quick entry**: the sentence you write, with your categories, payees and tags.
- **Bank mails**: the mail's text, with card numbers and IBANs hidden first.

**What was sent**, at the foot of Settings → AI, lists the last 90 days word
for word.

## What stays with you

- **Your key** stays on the server: it is never sent back to the browser, and
  with `CB_SECRET_KEY` set it is stored encrypted
  ([Configuration](../README.md#configuration)).
- **What the AI writes is yours alone.** In a shared wallet the other members
  see none of your reports or proposals.
- **Notifications** about unusual transactions leave out the amount on push,
  email and chat when you chose to keep amounts out of them
  ([Notifications](notifications.md)).

## The monthly limit

**Requests a month** caps how many calls CloudBank makes for you. At the limit,
bank mails are no longer read by the AI, what you ask for yourself (Generate
now, a quick entry) asks before going past it, and reports that would come by
themselves are skipped; the bell says so once. The count starts again on the
first of the month.
