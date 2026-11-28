# How fast is CloudBank? A baseline and targets

**Measured:** 2026-11-28, on CloudBank 3.14.0 (`main` at `2e8f174`), for #808.
**Scripts:** [`speed/`](speed/): `bench_api.py` times the API and samples memory,
`pages.mjs` times the main pages in a browser, `mem_probe.py` and
`mem_probes.sh` measure memory per endpoint. The 100k wallet comes from
[`sqlite-load/seed.py`](sqlite-load/seed.py).

## The question

Carlo wants CloudBank to feel fast, and Mongo and Redis came up. Before
changing anything: where does the time go on the pages people use every day,
how much memory does the server need, and which fixes would the numbers
justify? Mongo and Redis are out of scope, and SQLite stays
([sqlite-load-test.md](sqlite-load-test.md)).

## Conditions

These apply to every number below unless a line says otherwise.

- **Machine:** AMD Ryzen 9 5900X (12 cores), 32 GB RAM, Windows 11 Pro.
  Client and server run on the same machine over 127.0.0.1, so there is no
  network latency unless a profile adds it. Another Claude session was
  working on the same machine at the same time.
- **Server:** the native Windows binary built from this commit (Go 1.27.4,
  `modernc.org/sqlite` v1.62.0, chi v5.5.0). The SPA is embedded, as in the
  image. **No Docker is installed on this machine, so the memory figures are
  the Windows process's working set and private bytes, not a container's
  RSS.** The Go heap behaves the same on Linux, but the absolute numbers
  should be checked in the container before they become a limit.
- **Client:** Python 3.13.17 `urllib` for the API, Playwright 1.63.0 with
  Chromium 153 for the pages, at 1440×900.
- **Data:**
  - **demo**: the `demo` build's own seeded wallet (one year, four accounts),
    started with `POST /api/v1/demo/session`;
  - **100k**: `sqlite-load/seed.py 100000`, which gives 103k rows over ten
    years, six accounts and a first account ("Checking") holding about 57k
    rows. There are no planner statistics, as on a real install.
- **Lighthouse was not used.** It is not installed here, and the DevTools
  Lighthouse audit leaves out performance. `pages.mjs` measures the same
  things in the same browser instead:
  - **ready**: when the last wallet-scoped API response of the load arrived,
    from navigation start. This is when the page has its data;
  - **FCP and LCP**: from the browser's paint entries;
  - **long tasks**: main-thread time past 50 ms per task, summed over the load.
- **Profiles:**
  - **desktop**: this machine as it is;
  - **slow phone**: Lighthouse's mobile throttling, with a 4× CPU slowdown,
    150 ms RTT, 1.6 Mbit/s down and 750 kbit/s up.
- **Cold and warm loads:** a cold load starts from an empty HTTP cache with the
  service worker blocked. A warm load is the same page again in the same
  browser, with the assets cached. Each figure is the median of 3 runs.
- **Server timings:** p50 and p95 over 30 runs after one warm-up, with gzip as
  the SPA gets it.
- **Noise floor:** on this machine, about 1 call in 20 to even the cheapest
  endpoint takes 11–24 ms instead of under 1 ms. The cause is unconfirmed
  (Windows timer granularity is the likely one). A p95 under about 25 ms
  means "fast". Differences of ±15% are noise.
- **Single runs:** the page-to-page navigation and the idle tab figures come
  from one run each. Everything else is a median or a percentile.

## Results: the server

Times are p50 / p95 in ms. Sizes are KB, raw / gzip, on the 100k wallet.

| Endpoint | demo | 100k | 100k size | Called by |
|---|---:|---:|---:|---|
| `dashboard` (all time, 12 months) | 2.6 / 18 | **255 / 274** | 3 / 1 | sidebar header, dashboard (both on every page) |
| `dashboard` (all time, 0 months) | 2.6 / 3 | **393 / 445** | 9 / 2 | dashboard widget |
| `dashboard` (default range) | 2.4 / 12 | **289 / 315** | 8 / 2 | dashboard widget |
| `accounts` | 1.8 / 17 | 76 / 79 | 3 / 1 | dashboard, register, scheduled |
| `transactions/review` | 1.6 / 16 | **246 / 271** | 112 / 14 | dashboard, only for its counts |
| `transactions/register` (first account) | 3.5 / 18 | **920 / 1005** | **19,432 / 2,076** | register |
| `transactions?limit=100` | 5.4 / 18 | 8.7 / 27 | 31 / 4 | (not used by the register page) |
| `budgets/report` (month) | 1.8 / 23 | 95 / 99 | 0 / 0 | dashboard, budget |
| reports: statistics, trend, balance (10 years) | 1–5 / ≤25 | 123–196 / 127–233 | ≤295 / ≤108 | reports (it opens on two one-month statistics calls, about 200 ms each on 100k, in the browser) |
| `search` | 2.4 / 16 | 184 / 204 | 34 / 4 | register search |
| `export/csv` | 2.8 / 19 | 905 / 1016 | 2,911 / 641 | export (not on a page load) |
| `integrity` | 1.3 / 23 | 163 / 206 | 123 / 53 | settings (not on a page load) |
| frame: `setup/status`, `auth/me`, `wallets`, `notifications`, `version` | ≤0.7 / ≤17 | ≤0.8 / ≤24 | <1 | every page (with `admin/updates`, `ai/settings`, `notifications/settings`) |
| bills, goals, schedules, templates, payees, categories, tags, vehicles, budgets, currencies | ≤1.3 / ≤23 | ≤1.3 / ≤27 | ≤12 / ≤2 | various |

**Against September.** `sqlite-load/bench.py`, unchanged, run on the same
100k wallet gives the register 888 ms (September: 1,045) and the export
678 ms (837). Some calls are slower than in September:

| Endpoint | September | Now |
|---|---:|---:|
| `dashboard`, no parameters | 183 ms | 247 ms |
| `budgets/report` | 67 ms | 108 ms |
| statistics by category, 10 years | 209 ms | 255 ms |
| review | 259 ms | 286 ms |

That is +10% to +60%, past the ±15% noise for three of them. Either these
endpoints have regressed since September, or the other session's load on the
machine slowed them (unconfirmed). Rerun on an idle machine before treating
it as a regression. The SPA's own `dashboard` calls carry other parameters
and cost 255–393 ms.

**No conditional responses.** No API response carries an `ETag`,
`Last-Modified` or `Cache-Control` header, and a GET with `If-None-Match`
answers 200 with the full body. The SPA shell and `sw.js` are `no-cache` but
also carry no validator, so they are downloaded in full every time (2 KB, not
a cost). Hashed assets are `immutable` and are never asked for twice.

### Under load

`bench_api.py` replays a dashboard load (19 calls, 6 at a time as a browser
does) for N simultaneous people, 4 loads each. It also runs September's 8
readers pulling the register for 20 s.

| Load | demo p50 / p95 | 100k p50 / p95 | Peak working set (demo / 100k) |
|---|---:|---:|---:|
| 1 person opens the dashboard | 25 / 30 ms | 630 / 639 ms | 53 / 120 MB |
| 10 people at once | 161 / 278 ms | 4.1 / 4.5 s | 148 / 635 MB |
| 25 people at once | 499 / 739 ms | 10.3 / 11.2 s | 242 / 1,377 MB |
| 8 readers on the register | 5 / 44 ms | 2.9 / 3.8 s | 339 / 1,026 MB |

The server idles at 27 MB right after start and about 100 MB after the first
requests. After the 100k load it held 629 MB for minutes: Go returns freed
memory slowly.

`mem_probes.sh` runs each endpoint alone on a fresh server: 25 clients, 100
calls in all, on the 100k wallet.

| Endpoint | Peak working set | Private | p50 under load | Wall time, 100 calls |
|---|---:|---:|---:|---:|
| `transactions/register` | **2,561 MB** | 2,612 MB | 12.3 s | 48.1 s |
| `dashboard` (all time, 12 months) | 444 MB | 509 MB | 2.1 s | 7.7 s |
| `dashboard` (all time, 0 months) | 440 MB | 515 MB | 4.6 s | 15.5 s |
| `dashboard` (default range) | 402 MB | 483 MB | 3.8 s | 16.7 s |
| `transactions/review` | 303 MB | 356 MB | 2.1 s | 8.2 s |
| `accounts` | 294 MB | 370 MB | 0.4 s | 1.6 s |

Each register response holds all 57k rows in memory, and `writeJSON`
(`internal/httpapi/router.go`) encodes them with `json.Encoder`, which
builds the whole 19 MB encoding before it writes any of it. 25 of them at
once need about 2.5 GB.

One person is a different case. A single client calling every endpoint in
turn, the register and the export included, peaks at 169 MB (100k) and
154 MB (demo). The 25-client figures are a stress case, not a typical
self-hosted load. The read pool has no
connection limit (`internal/store/store.go`), so 25 requests means 25 SQLite
connections running together on 12 cores.

## Results: the pages

Ready times are in ms, cold / warm. "API" is how many API calls a cold load
makes. "Assets" is the JS and CSS fetched on a cold load, gzipped.

| Page | Data | Desktop ready | Slow phone ready | Slow phone LCP (cold) | API | Assets |
|---|---|---:|---:|---:|---:|---:|
| Dashboard | demo | 518 / 468 | 6,840 / 1,730 | 3,964 | 25 | 775 KB |
| Dashboard | 100k | 1,077 / 772 | 6,900 / 1,964 | 6,404 | 27 | 778 KB |
| Register | demo | 493 / 446 | 5,788 / 1,866 | 3,920 | 23 | 544 KB |
| Register | 100k | **1,699 / 1,420** | **17,293 / 13,524** | **17,204** | 25 | 548 KB |
| Reports | demo | 460 / 384 | 5,994 / 1,437 | 3,988 | 16 | 718 KB |
| Reports | 100k | 621 / 407 | 5,927 / 1,447 | 5,696 | 16 | 721 KB |
| Budget | demo | 439 / 365 | 4,813 / 1,319 | 4,680 | 15 | 523 KB |
| Budget | 100k | 595 / 408 | 5,025 / 1,500 | 4,612 | 17 | 527 KB |
| Scheduled | demo | 448 / 382 | 5,203 / 1,532 | 4,852 | 16 | 532 KB |
| Scheduled | 100k | 561 / 430 | 4,975 / 1,279 | 4,752 | 15 | 535 KB |

Other measurements, on the same pages:

- **Long tasks** (slow phone, cold):
  - the 100k register blocks the main thread for 1.4 s, and its JS heap is
    61–69 MB;
  - the dashboard blocks it for 1.1 s (demo) and 1.5 s (100k);
  - the other pages block it for 0.46–0.70 s, with a heap of 12–22 MB.
- **Moving between pages** (100k, desktop, measured by clicking the sidebar):
  - the first load makes 28 API calls;
  - going to the register makes 10 more;
  - coming back to the dashboard makes 18 more.
  - On the demo the figures are 25, 12 and 16.
- **A tab left open for 2 minutes after loading:**

  | Page | Data | API calls | Downloaded |
  |---|---|---:|---:|
  | Dashboard | demo | 34 | 18 KB |
  | Dashboard | 100k | 34 | 80 KB |
  | Register | demo | 18 | 23 KB |
  | Register | 100k | 17 | **6,310 KB** |

  The 100k register downloaded its 2 MB register 3 times in those 2 minutes.

## The suspects

- **"The register sends 18 MB of JSON for 57k rows": confirmed.** It is now
  19.4 MB raw and 2.1 MB gzipped, and takes 920 ms on the server. The page
  filters on the client, so it always loads the whole account.
  - On a slow phone the page is ready after 17 s: the download, then parsing
    19 MB.
  - It is also the biggest memory cost on the server (2.5 GB under 25 clients).
  - The page fetches it again every 30 s while it stays open.
- **"No 304 responses": confirmed.** No API response carries a validator, so
  nothing can answer 304.
  - This matters because of the polling. `queryClient.ts` refetches 14 "live"
    query roots every 30 s: register, accounts, dashboard, review and others.
  - Every poll runs the full query and sends the full body, even when nothing
    changed.
- **"The dashboard fires many requests": confirmed.** A dashboard load makes
  25–28 API calls. Four of them are the `dashboard` endpoint: two identical
  calls and two other variants.
  - The query client sets no `staleTime`, so it is 0 for these queries
    (only `setup-status` in `App.tsx` sets one).
  - The sidebar header's query ends before the dashboard page mounts with the
    same key, and the call runs again. The likely cause is that a stale query
    refetches on mount (unconfirmed). The comment in `SidebarHead.tsx` says
    it "costs nothing", but it runs twice.
  - On 100k the four calls take about 1.2 s of server time. The full review
    list, 246 ms, is loaded only to count rows needing a category.
  - Requests run in parallel, so one person waits 630 ms. Ten at once wait 4 s.
- **"The SPA bundle is too big": partly.** Before any page chunk loads, the
  shell is 1,520 KB raw and 422 KB gzipped.
  - It includes dnd-kit (20 KB gzipped), which only `NavLayoutEditor.tsx`
    imports, and a 144 KB shared chunk.
  - ECharts adds 194 KB gzipped to the dashboard and reports.
  - On top of that, the service worker precaches 118 files, 3.1 MB raw, on
    the first visit. The cold runs blocked it, so a real first visit
    downloads more than the table shows, though after the page has loaded.
  - On a slow phone, first paint takes about 4.0 s on every page, cold. That
    is the assets: the first API call only starts after 3.2 s.
  - Warm, first paint takes 0.9 s.
  - On desktop, assets are not the problem.

Two smaller findings:

- **Two round trips before any data.** Every load runs `setup/status` and
  `auth/me` together, then `wallets`, and only then a wallet query can start.
  That is about 0.35 s on the slow phone profile.
- **On the demo, `/api/v1/ai/settings` answers 404** (AI is off there), and
  TanStack's retry asks again 1 s later on every page.

## Proposed targets

These are for Carlo to confirm. They are measured on the 100k wallet, with the
conditions above and the same scripts.

| What | Now | Target |
|---|---:|---:|
| p95 of every API call a page load makes | 1,005 ms (register), 445 ms (dashboard), about 200 ms (reports' statistics) | **≤ 150 ms** |
| p95 of exports and integrity (not on a page load) | 1,016 ms | ≤ 1,000 ms (unchanged) |
| API calls per dashboard load | 27 | **≤ 12**, none repeated |
| Page ready, desktop, cold / warm, every main page | up to 1,699 / 1,420 ms | **≤ 800 / 500 ms** |
| Page ready, slow phone, cold / warm | up to 17.3 / 13.5 s | **≤ 5 / 2 s** |
| First paint, slow phone, cold | 4.0 s | ≤ 3 s |
| Shell JS + CSS, gzipped | 422 KB | ≤ 300 KB |
| Idle open tab, per minute | 3.2 MB (register) | ≤ 50 KB, with unchanged data answering 304 |
| Server memory, one person using every page | 169 MB | ≤ 256 MB |
| Server memory, 25 people loading pages at once | 1.4 GB (dashboard), 2.6 GB (register) | **≤ 512 MB** |
| Server memory, idle after use | 100 MB, 629 MB after load | ≤ 150 MB |

The memory ceiling is a working-set figure from Windows. It should be checked
with `docker stats` before it becomes the image's documented limit.

## Fixes the numbers justify, ranked by gain

1. **Page the register on the server.** Send a window of rows, with the
   running balance, the filters and the search applied in SQL, instead of the
   whole account (`transactions/register`, `TransactionsPage.tsx`).
   - The register page should drop from 17 s to under 5 s on a slow phone, and
     from 1.7 s to about 0.5 s on desktop.
   - It removes the 2.5 GB memory peak and the 6 MB of polling every
     2 minutes.
   - Biggest gain, and the biggest change.
2. **Conditional GETs from a wallet revision.** Keep a counter per wallet,
   bumped on every write, and send it as the `ETag` of wallet-scoped GETs. An
   unchanged `If-None-Match` then answers 304 before any query runs.
   - Polling becomes almost free for the server and the network.
   - It also helps the register before 1 lands.
   - The revision alone is not enough for everything: balances "today",
     the dashboard's ranges and the budget month move with the date, so
     their ETag must also carry the date.
3. **Stop the client refetching what it already has.**
   - Give `queryClient.ts` a `staleTime`: 30 s, the polling interval. The
     sidebar and the dashboard then share one `dashboard` call, and moving
     between pages stops refetching 10–18 calls.
   - Replace the 14 polled roots with one cheap poll of the wallet revision,
     and invalidate only when it changes.
4. **One cheap dashboard.**
   - One `dashboard` call per load instead of four. The sidebar needs only the
     totals and the accounts.
   - Counts for "needs attention" instead of the whole review list.
   - Look at why `dashboard` takes 255–393 ms and `accounts` 76 ms on 100k:
     both compute every balance from all rows, every time.
   - One person's dashboard load should go from 630 ms to about 250 ms, and
     10 people at once from 4 s to about 1.5 s.
   - Check the September comparison above on an idle machine first: if
     `dashboard` and `budgets/report` regressed, find the commit.
5. **Bound the server's memory.**
   - Cap the read pool at about the number of CPUs, so 25 requests queue
     instead of opening 25 connections.
   - Set `GOMEMLIMIT` in the image, from a container limit, so Go collects
     before it grows.
   - Needed for the 512 MB target whatever else lands.
6. **Make the reports' statistics cheaper.** A one-month statistics call
   costs about 200 ms on 100k, about the same as ten years, and the Reports
   page opens on two of them. This one is needed for the 150 ms target.
   Start by looking at its query plan.
7. **Trim the shell.**
   - Load dnd-kit with the navigation layout editor.
   - Find what the 144 KB shared chunk holds.
   - Import ECharts through `echarts/core` with only the charts used.
   - First paint on a slow phone, cold, should go from 4 s to about 3 s. It
     does nothing for warm loads or desktop.
8. **One bootstrap call** for setup status, user and wallets, instead of two
   steps in a row. It saves about 0.35 s on a slow phone, cold.
9. **Demo only:** don't ask for `ai/settings` when AI is off, or don't retry a
   404. It removes one request per page on the demo.

Rejected or not needed, by these numbers:
- **A different database or a cache server.** Every slow call is slow from
  sending or computing whole data sets. Another store would still do the same
  work.
- **Server-side caching of results.** The wallet revision of fix 2 gives most
  of the gain with none of the invalidation risk.

## Verdict

**The engine is not what makes CloudBank slow. What the app asks of it is.**
The fixes fall into three groups:
- sending less: the register window and conditional GETs;
- asking less often: `staleTime`, and one revision poll instead of 14;
- asking once: one dashboard call per load.

These fixes would bring every main page under 0.8 s cold on desktop and under
5 s on a slow phone, on a 100k wallet. A memory bound keeps the single
process safe under concurrency. Fixes 1–3 give most of the gain.

## Running it again

From `docs/research/`, on Windows with Git Bash. Each script writes to its own
`out/`, which git ignores.

```bash
# build both binaries (the demo needs a demo SPA build first)
mkdir -p sqlite-load/out speed/out
(cd ../../web && npm ci && npm run build)
(cd ../../server && go build -o ../docs/research/sqlite-load/out/cloudbank.exe ./cmd/cloudbank)
(cd ../../web && CB_DEMO=1 npm run build)
(cd ../../server && go build -tags demo -o ../docs/research/speed/out/cloudbank-demo.exe ./cmd/cloudbank)
(cd ../../web && npm run build)   # put the normal SPA back
git checkout -- ../../server/internal/webui/dist/.gitkeep   # the SPA build deletes it
(cd ../../e2e && npm ci)          # Playwright for pages.mjs

# the 100k wallet on :8097, the demo on :8098
(cd sqlite-load && CB_DATA_DIR=out/data CB_SECURE_COOKIES=false CB_ADDR=127.0.0.1:8097 out/cloudbank.exe &)
(cd speed && CB_DATA_DIR=out/demo-data CB_SECURE_COOKIES=false CB_DEMO_SESSIONS_PER_HOUR=100 CB_ADDR=127.0.0.1:8098 out/cloudbank-demo.exe &)
(cd sqlite-load && python seed.py 100000)

cd speed
python bench_api.py http://127.0.0.1:8097 100k <pid of :8097> ../sqlite-load/out/creds.json
python bench_api.py http://127.0.0.1:8098 demo <pid of :8098>
node pages.mjs http://127.0.0.1:8097 100k ../sqlite-load/out/creds.json
node pages.mjs http://127.0.0.1:8098 demo
ONLY=idle node pages.mjs http://127.0.0.1:8097 100k-idle ../sqlite-load/out/creds.json
# stop the :8097 server first: this starts its own, once per endpoint
bash mem_probes.sh
```

Get a server's PID in PowerShell with
`(Get-NetTCPConnection -LocalPort 8097 -State Listen).OwningProcess`.
Start each server fresh before `bench_api.py`, so that its idle memory figure
means idle.
