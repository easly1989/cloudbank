# Times the wallet's endpoints on the seeded load wallet.
# See ../sqlite-load-test.md for how to run it.
#   python bench.py [label]   → prints a table and writes out/results-<label>.json
import http.cookiejar, json, os, statistics, sys, threading, time, urllib.request

BASE = "http://127.0.0.1:8097"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
label = sys.argv[1] if len(sys.argv) > 1 else "run"
ids = json.load(open(os.path.join(OUT, "ids.json")))
creds = json.load(open(os.path.join(OUT, "creds.json")))
W = f"/api/v1/wallets/{ids['wid']}"
A = ids["accounts"][0]
H = {"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", "Accept-Encoding": "identity"}

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, headers=H,
                                 data=None if body is None else json.dumps(body).encode())
    t = time.perf_counter()
    with op.open(req, timeout=300) as r:
        raw = r.read()
    return (time.perf_counter() - t) * 1000, len(raw), raw


call("POST", "/api/v1/auth/login", creds)

R = "from=2016-01-01&to=2026-12-31"
CASES = [
    ("accounts", f"{W}/accounts"),
    ("register (57k rows)", f"{W}/transactions/register?accountId={A}"),
    ("transactions page 100", f"{W}/transactions?accountId={A}&limit=100"),
    ("search 'shop'", f"{W}/transactions/search?q=shop&limit=100"),
    ("review", f"{W}/transactions/review"),
    ("dashboard", f"{W}/dashboard"),
    ("stats by category, 10y", f"{W}/reports/statistics?groupBy=category&{R}"),
    ("stats by payee, 10y", f"{W}/reports/statistics?groupBy=payee&{R}"),
    ("stats by tag, 10y", f"{W}/reports/statistics?groupBy=tag&{R}"),
    ("trend month x category", f"{W}/reports/trend?bucket=month&breakdown=category&{R}"),
    ("balance month, all", f"{W}/reports/balance?bucket=month&{R}"),
    ("balance day, all", f"{W}/reports/balance?bucket=day&{R}"),
    ("cashflow 90d", f"{W}/reports/cashflow?accountId={A}&days=90"),
    ("uncleared", f"{W}/reports/uncleared"),
    ("budget report", f"{W}/budgets/report"),
    ("bills", f"{W}/bills"),
    ("tags manage", f"{W}/tags/manage"),
    ("payees", f"{W}/payees"),
    ("categories", f"{W}/categories"),
    ("category usage", f"{W}/categories/{ids['cats'][1]}/usage"),
    ("duplicates check", f"{W}/transactions/duplicates?accountId={A}&date=2026-09-01&amount=-1234"),
    ("export csv", f"{W}/export/csv?accountId={A}"),
    ("integrity", f"{W}/integrity"),
]

results = {}
print(f"{'endpoint':28} {'median':>9} {'max':>9} {'size':>10}")
for name, path in CASES:
    try:
        call("GET", path)  # warm
        runs = [call("GET", path) for _ in range(5)]
    except Exception as e:  # noqa: BLE001
        print(f"{name:28} ERROR {e}")
        continue
    ms = [r[0] for r in runs]
    results[name] = {"median": statistics.median(ms), "max": max(ms), "bytes": runs[0][1]}
    print(f"{name:28} {statistics.median(ms):8.1f}ms {max(ms):8.1f}ms {runs[0][1] / 1024:8.0f}KB")

# Writes: single inserts, alone and while 8 readers pull the register.
def writes(n):
    out = []
    for i in range(n):
        ms, _, raw = call("POST", f"{W}/transactions", {
            "accountId": A, "date": "2026-09-29", "amount": -1234, "payeeId": ids["payees"][0],
            "categoryId": ids["cats"][1], "memo": f"bench {i}"})
        out.append(ms)
        call("DELETE", f"{W}/transactions/{json.loads(raw)['id']}")
    return out

w = writes(20)
results["write alone"] = {"median": statistics.median(w), "max": max(w)}
print(f"{'write alone':28} {statistics.median(w):8.1f}ms {max(w):8.1f}ms")

stop = False
reader_ms = []
def reader():
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    while not stop:
        t = time.perf_counter()
        with o.open(urllib.request.Request(BASE + f"{W}/transactions/register?accountId={A}", headers=H), timeout=300) as r:
            r.read()
        reader_ms.append((time.perf_counter() - t) * 1000)
threads = [threading.Thread(target=reader) for _ in range(8)]
for t in threads: t.start()
time.sleep(1)
w = writes(20)
stop = True
for t in threads: t.join()
results["write under 8 readers"] = {"median": statistics.median(w), "max": max(w)}
results["register under 8 readers"] = {"median": statistics.median(reader_ms), "max": max(reader_ms), "n": len(reader_ms)}
print(f"{'write under 8 readers':28} {statistics.median(w):8.1f}ms {max(w):8.1f}ms")
print(f"{'register w/ 8 readers':28} {statistics.median(reader_ms):8.1f}ms {max(reader_ms):8.1f}ms  n={len(reader_ms)}")

json.dump(results, open(os.path.join(OUT, f"results-{label}.json"), "w"), indent=1)
