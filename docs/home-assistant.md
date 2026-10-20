# CloudBank in Home Assistant

Home Assistant can show a few of CloudBank's numbers as sensors: the bills that
are overdue or due this week, how much of this month's budget is left, and how
many transactions wait on Review. A dashboard card, or an automation that tells
you when a bill is late, then works like any other sensor.

To have CloudBank send you notices instead, such as a large expense the moment
it lands, see [Notifications › Home Assistant](notifications.md#home-assistant).

- [A token for Home Assistant](#a-token-for-home-assistant)
- [The sensors](#the-sensors)
- [Balances](#balances)
- [What the summary holds](#what-the-summary-holds)

## A token for Home Assistant

Home Assistant reads CloudBank with a personal API token, made in
**Settings › Security › Personal API tokens**:

1. **Create token**, named for example `Home Assistant`.
2. Leave **Access** on **Read-only**: Home Assistant only reads.
3. Copy the token. It is shown this once.

The token acts as you, so it reaches every wallet you belong to. Keep it in Home
Assistant's `secrets.yaml`, not in `configuration.yaml`, with the word `Bearer`
in front:

```yaml
# secrets.yaml
cloudbank_token: "Bearer cbp_paste-your-token-here"
```

Revoking the token in CloudBank stops the sensors at once; they show as
unavailable.

The sensors need the wallet's number. Every wallet you belong to is listed, with
its `id`, at `/api/v1/wallets`:

```sh
curl -H "Authorization: Bearer cbp_paste-your-token-here" https://cloudbank.example.com/api/v1/wallets
```

## The sensors

One request every 15 minutes feeds every sensor. Put this in
`configuration.yaml`, with your own address and wallet number in `resource`, and
restart Home Assistant:

```yaml
rest:
  - resource: "https://cloudbank.example.com/api/v1/wallets/1/summary"
    headers:
      Authorization: !secret cloudbank_token
    scan_interval: 900
    sensor:
      - name: "CloudBank overdue bills"
        unique_id: cloudbank_overdue_bills
        value_template: "{{ value_json.bills.overdue }}"
        state_class: measurement
      - name: "CloudBank bills this week"
        unique_id: cloudbank_bills_week
        value_template: "{{ value_json.bills.dueNext7Days }}"
        state_class: measurement
      - name: "CloudBank next bill"
        unique_id: cloudbank_next_bill
        value_template: "{{ value_json.bills.next.name if value_json.bills.next else 'None' }}"
      - name: "CloudBank next bill date"
        unique_id: cloudbank_next_bill_date
        device_class: date
        value_template: "{{ value_json.bills.next.date if value_json.bills.next else None }}"
      - name: "CloudBank budget left"
        unique_id: cloudbank_budget_left
        device_class: monetary
        unit_of_measurement: "EUR"
        value_template: "{{ value_json.budget.left }}"
      - name: "CloudBank budget used"
        unique_id: cloudbank_budget_used
        unit_of_measurement: "%"
        state_class: measurement
        value_template: "{{ value_json.budget.usedPercent }}"
      - name: "CloudBank to review"
        unique_id: cloudbank_to_review
        state_class: measurement
        value_template: >-
          {{ value_json.review.needsCategory + value_json.review.duplicates
             + value_json.review.unconfirmed }}
```

Set `unit_of_measurement` to your wallet's currency: it is the summary's
`currency`. Amounts come as plain numbers, `830.12`, so they need no template
to divide. CloudBank on the same network as Home Assistant can be reached by
its local address, such as `http://192.168.1.20:8080`; the token travels in the
clear over plain HTTP, so keep that to your own network.

## Balances

The summary leaves your balances out unless the address asks for them, so a
Home Assistant shared with the household does not show them by default. Add
`?balances=true` to `resource`, then a sensor for the total:

```yaml
      - name: "CloudBank balance"
        unique_id: cloudbank_balance
        device_class: monetary
        unit_of_measurement: "EUR"
        value_template: "{{ value_json.balances.total }}"
```

The total is the one the overview shows: open accounts, without those kept out
of the summary. Each of them is listed too, with its own currency, under
`balances.accounts`.

## What the summary holds

`GET /api/v1/wallets/{walletId}/summary` returns, for example:

```json
{
  "wallet": "Home",
  "currency": "EUR",
  "today": "2026-10-20",
  "bills": {
    "overdue": 1,
    "dueNext7Days": 1,
    "next": { "name": "Gym", "date": "2026-10-23", "amount": 39.00 },
    "totalDue": 989.00
  },
  "budget": {
    "month": "2026-10",
    "budgeted": 100.00,
    "spent": 120.00,
    "left": -20.00,
    "usedPercent": 120,
    "over": 1
  },
  "review": { "needsCategory": 1, "duplicates": 1, "unconfirmed": 0 }
}
```

- **bills**: the bills overdue, those due in the next 7 days, the next one not
  yet overdue (`null` when there is none), and the total still to pay, overdue
  included.
- **budget**: this month's spending in the categories with a budget, as positive
  amounts. `left` turns negative once past it; `over` counts the categories past
  theirs.
- **review**: what Review shows: bank rows without a category, possible
  duplicates, and rows read from bank mails that the bank has not booked yet.
- **balances**, only with `?balances=true`: `total` and `accounts`.

Amounts are in the wallet's currency, and dates are civil dates in UTC. The full
reference is in every CloudBank at `/api/docs`.
