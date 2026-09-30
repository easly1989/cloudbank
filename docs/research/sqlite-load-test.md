# SQLite under load: 100k transactions

**Measured:** 2026-09-29, on `modernc.org/sqlite` v1.59.0, Windows 11, one local server.
**Led to:** #541 → PR #542 (merged).
**Scripts:** [`sqlite-load/`](sqlite-load/) — `seed.py` builds the wallet, `bench.py` times it.

## The question

Is SQLite still the right store as a wallet grows, or does CloudBank need a
faster engine, a NoSQL store, or a choice of engines? Before answering, measure
where the time actually goes.

## The data

Invented data only, seeded by `sqlite-load/seed.py`:
- 103k transaction rows over ten years (2016-10 → 2026-09);
- six accounts; the busiest ("Checking") holds 55k rows;
- 60 categories (12 groups of 4), 400 payees, 30 tags;
- 3% transfers (two linked rows each), 3% splits, 10% tagged.

`bench.py` times 23 read endpoints: five runs after a warm-up, reporting the
median. It also times single writes, both alone and while 8 readers pull the
55k-row register. Responses are fetched with `Accept-Encoding: identity`, so the
sizes below are uncompressed.

## Results

"Before" is main before #542, on a database with no planner statistics, as a
real install has. "After" is #542.

| Endpoint | Before (ms) | After #542 (ms) | Response |
|---|---:|---:|---:|
| accounts | 75 | 78 | 3 KB |
| register (57k rows) | 973 | 1045 | 18.1 MB |
| transactions page 100 | 8 | 11 | 31 KB |
| search 'shop' | 187 | 201 | 34 KB |
| review | 405 | 259 | 111 KB |
| dashboard | 171 | 183 | 3 KB |
| stats by category, 10y | 198 | 209 | 1 KB |
| stats by payee, 10y | 132 | 130 | 20 KB |
| stats by tag, 10y | 91 | 103 | 1 KB |
| trend month x category | 191 | 204 | 13 KB |
| balance month, all | 376 | 127 | 11 KB |
| balance day, all | 412 | 169 | 295 KB |
| cashflow 90d | 301 | 8 | 2 KB |
| uncleared | 569 | 13 | 1 KB |
| budget report | 57 | 67 | 1 KB |
| tags manage | 33 | 38 | 1 KB |
| export csv | 3661 | 837 | 2.8 MB |
| integrity | 125 | 151 | 123 KB |
| write alone | 1 | 1 | |
| write under 8 readers | 3 | 3 | |
| register under 8 readers | 3656 | 3811 | |

Endpoints under 5 ms either way (bills, payees, categories, category usage, the
duplicate check) are left out of the table. Differences of ±15% between runs
are noise on this machine.

## What it showed

- **Writes are never the problem.** A write takes about 1 ms, and about 3 ms
  while 8 readers pull 18 MB registers: WAL plus the single-connection write
  pool keep them apart.
- **The slow reads came from one index.** `idx_transactions_account_date` did
  not cover the columns the reports read, so each row cost a table lookup.
  Migration 0036 makes it `(account_id, date, amount, status, wallet_id)`, and
  the balance report pins it with `INDEXED BY`.
- **The export ran a tags query per row.** It now reads through the register
  query, plus one tags query for the whole export. The output is
  byte-identical.
- **The duplicate finder** (which the review page uses) paired whole rows in Go.
  It now pairs light, index-only rows and loads only the rows that pair.
- **Nothing was compressed.** gzip cuts API responses 7–8× and the SPA from
  2.4 MB to 0.7 MB. It is applied only to API requests that carry
  `X-Requested-With` or a Bearer token, which keeps BREACH-style attacks out of
  reach.
- **The big register is size, not SQL:** 18 MB of JSON for 57k rows. Under 8
  concurrent readers it takes ~3.7 s each. Paging or trimming the payload would
  help there, not a different engine.

## Traps met along the way

- **Planner statistics change everything.** The first seed ended with
  `PRAGMA optimize`. With those statistics the planner chose plans up to 20×
  slower, and the first "before" numbers were badly inflated. CloudBank never
  runs `ANALYZE`, so users' databases have no statistics. The committed seed
  leaves them out.
- **Rejected after measuring:**
  - a wide index led by `wallet_id`, which slowed search, review and integrity
    2–10×;
  - rewriting the running balance with `LAG`/`LEAD`, which was slower on
    modernc than the `SUM() OVER` it replaced.

## Verdict

**Keep SQLite.** With the index fixed, every report on a 100k-row wallet
answers in 10–210 ms, and writes stay around 1 ms. The engine was never the
bottleneck. Alternatives looked at:
- a NoSQL store;
- an embedded KV store: Badger has no SQL and no secondary indexes, so every
  report would be rewritten by hand, and RocksDB needs cgo;
- a different SQLite build: see [turso-libsql.md](turso-libsql.md).

None of them would fix what the measurements found. The KV stores are listed
in #550 to be written up with numbers.

## Running it again

The test runs against a fresh server with its own data directory, which
`seed.py` fills.

```bash
mkdir -p docs/research/sqlite-load/out
cd server && go build -o ../docs/research/sqlite-load/out/cloudbank ./cmd/cloudbank
cd ../docs/research/sqlite-load
CB_DATA_DIR=out/data CB_SECURE_COOKIES=false CB_ADDR=127.0.0.1:8097 out/cloudbank &
python seed.py 100000
python bench.py before
```

`seed.py` sets up a throwaway admin (password in `out/creds.json`), then writes
the transactions straight into `out/data/cloudbank.db`. `bench.py <label>`
writes `out/results-<label>.json`.

To compare a change, run `bench.py` before and after, on the same seeded
database: stop the server, rebuild, and start it again on the same `out/data`.
Everything under `out/` stays out of git.
