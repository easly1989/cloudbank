# Times the API the main pages call, on any running CloudBank, and samples the
# server process's memory while it does. See ../speed-baseline.md.
#   python bench_api.py <base> <label> <server-pid> [creds.json]
# mem_probe.py imports it for the login, the ids and the memory sampler.
# With no creds file it starts a demo session (demo build only). Writes
# out/api-<label>.json and prints a table.
import gzip, http.cookiejar, json, os, statistics, subprocess, sys, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE, label, PID = sys.argv[1], sys.argv[2], int(sys.argv[3])
CREDS = sys.argv[4] if len(sys.argv) > 4 else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
RUNS = int(os.environ.get("RUNS", 30))
H = {"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"}

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None, enc="gzip", extra=None):
    hdr = {**H, "Accept-Encoding": enc, **(extra or {})}
    req = urllib.request.Request(BASE + path, method=method, headers=hdr,
                                 data=None if body is None else json.dumps(body).encode())
    t = time.perf_counter()
    try:
        with op.open(req, timeout=300) as r:
            raw, headers, status = r.read(), r.headers, r.status
    except urllib.error.HTTPError as e:
        raw, headers, status = e.read(), e.headers, e.code
    ms = (time.perf_counter() - t) * 1000
    return ms, raw, headers, status


def body(raw, headers):
    return gzip.decompress(raw) if headers.get("Content-Encoding") == "gzip" else raw


# Memory of the server process (Windows: working set and private bytes).
def mem():
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         f"$p=Get-Process -Id {PID}; \"$($p.WorkingSet64) $($p.PeakWorkingSet64) $($p.PrivateMemorySize64)\""],
        capture_output=True, text=True).stdout.split()
    return {"ws": int(out[0]), "peakWs": int(out[1]), "private": int(out[2])}


class Sampler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.stop, self.peak = False, {"ws": 0, "private": 0}

    def run(self):
        while not self.stop:
            m = mem()
            self.peak = {k: max(self.peak[k], m[k]) for k in self.peak}
            time.sleep(0.25)


if CREDS:
    call("POST", "/api/v1/auth/login", json.load(open(CREDS)))
else:
    call("POST", "/api/v1/demo/session")
wid = json.loads(body(*call("GET", "/api/v1/wallets")[1:3]))[0]["id"]
W = f"/api/v1/wallets/{wid}"
accounts = json.loads(body(*call("GET", f"{W}/accounts")[1:3]))
# The register page opens on the first account, as the SPA does.
A = accounts[0]["id"]
cats = json.loads(body(*call("GET", f"{W}/categories")[1:3]))
C = cats[1]["id"] if len(cats) > 1 else cats[0]["id"]
today = time.strftime("%Y-%m-%d")
month = (time.strftime("%Y-%m-01"), today[:8] + "30")

R = "from=2016-01-01&to=2026-12-31"
CASES = [
    # What every page's frame asks for.
    ("setup status", "/api/v1/setup/status"),
    ("auth me", "/api/v1/auth/me"),
    ("wallets", "/api/v1/wallets"),
    ("notifications", "/api/v1/notifications"),
    ("version", "/api/v1/version"),
    # Dashboard.
    ("dashboard (all time, 12m)", f"{W}/dashboard?from=0001-01-01&to=9999-12-31&groupBy=category&ieMonths=12"),
    ("dashboard (all time, 0m)", f"{W}/dashboard?from=0001-01-01&to=9999-12-31&groupBy=category&ieMonths=0"),
    ("dashboard (default)", f"{W}/dashboard?groupBy=category&ieMonths=0"),
    ("accounts", f"{W}/accounts"),
    ("review", f"{W}/transactions/review"),
    ("bills", f"{W}/bills"),
    ("goals", f"{W}/goals"),
    ("schedules", f"{W}/schedules"),
    ("templates", f"{W}/templates"),
    ("payees", f"{W}/payees"),
    ("categories", f"{W}/categories"),
    ("tags", f"{W}/tags"),
    ("vehicles", f"{W}/vehicles"),
    # Register.
    ("register (first account)", f"{W}/transactions/register?accountId={A}"),
    ("transactions page 100", f"{W}/transactions?accountId={A}&limit=100"),
    ("search 'shop'", f"{W}/transactions/search?q=shop&limit=100"),
    # Budget.
    ("budgets", f"{W}/budgets?year={today[:4]}"),
    ("budget report (month)", f"{W}/budgets/report?from={month[0]}&to={month[1]}"),
    ("currencies", f"{W}/currencies"),
    # Reports (the 10-year ranges of the September test).
    ("stats by category, 10y", f"{W}/reports/statistics?groupBy=category&{R}"),
    ("stats by payee, 10y", f"{W}/reports/statistics?groupBy=payee&{R}"),
    ("trend month x category", f"{W}/reports/trend?bucket=month&breakdown=category&{R}"),
    ("balance month, all", f"{W}/reports/balance?bucket=month&{R}"),
    ("balance day, all", f"{W}/reports/balance?bucket=day&{R}"),
    ("cashflow 90d", f"{W}/reports/cashflow?accountId={A}&days=90"),
    ("uncleared", f"{W}/reports/uncleared"),
    ("category usage", f"{W}/categories/{C}/usage"),
    ("export csv", f"{W}/export/csv?accountId={A}"),
    ("integrity", f"{W}/integrity"),
]


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def main():
    results = {"memory idle": mem()}
    print(f"{'endpoint':28} {'p50':>8} {'p95':>8} {'max':>8} {'raw KB':>9} {'gzip KB':>8} etag")
    for name, path in CASES:
        _, raw, hd, st = call("GET", path)  # warm
        if st != 200:
            print(f"{name:28} HTTP {st}")
            results[name] = {"status": st}
            continue
        ms = [call("GET", path)[0] for _ in range(RUNS)]
        plain = call("GET", path, enc="identity")[1]
        results[name] = {"p50": pct(ms, 50), "p95": pct(ms, 95), "max": max(ms), "raw": len(plain),
                         "gzip": len(raw) if hd.get("Content-Encoding") == "gzip" else None,
                         "etag": hd.get("ETag"), "cache": hd.get("Cache-Control")}
        r = results[name]
        gz = f"{r['gzip'] / 1024:8.0f}" if r["gzip"] is not None else "       -"
        print(f"{name:28} {r['p50']:7.1f}ms {r['p95']:7.1f}ms {r['max']:7.1f}ms {len(plain) / 1024:9.0f} {gz} {'yes' if r['etag'] else 'no'}")

    # A conditional request with whatever validator the server gave (none so far).
    _, _, hd, _ = call("GET", f"{W}/accounts")
    _, _, _, st = call("GET", f"{W}/accounts", extra={"If-None-Match": hd.get("ETag") or '"x"'})
    results["conditional GET status"] = st
    print(f"conditional GET on accounts: HTTP {st}")
    results["memory after timings"] = mem()

    # Load 1: N people open the dashboard at once, each replaying the calls the
    # SPA makes on a dashboard load (in parallel, as the browser does).
    DASH = [p for n, p in CASES if n in (
        "setup status", "auth me", "wallets", "notifications", "version", "dashboard (all time, 12m)",
        "dashboard (all time, 0m)", "dashboard (default)", "accounts", "review", "bills", "goals",
        "schedules", "templates", "payees", "categories", "tags", "vehicles")]
    DASH += [f"{W}/budgets/report?from={month[0]}&to={month[1]}"]


    def dash_load(_):
        t = time.perf_counter()
        with ThreadPoolExecutor(6) as ex:  # a browser opens 6 connections per host
            list(ex.map(lambda p: call("GET", p), DASH))
        return (time.perf_counter() - t) * 1000


    for users in (1, 10, 25):
        s = Sampler(); s.start()
        with ThreadPoolExecutor(users) as ex:
            loads = list(ex.map(dash_load, range(users * 4)))
        s.stop = True; s.join()
        results[f"dashboard load x{users} users"] = {"p50": pct(loads, 50), "p95": pct(loads, 95), "max": max(loads),
                                                    "n": len(loads), "peak": s.peak}
        print(f"dashboard load, {users:2} users     {pct(loads, 50):7.1f}ms {pct(loads, 95):7.1f}ms {max(loads):7.1f}ms"
              f"  peak ws {s.peak['ws'] / 1048576:.0f} MB, private {s.peak['private'] / 1048576:.0f} MB")

    # Load 2: 8 readers pull the first account's register (the September test).
    stop = False
    reader_ms = []


    def reader():
        while not stop:
            reader_ms.append(call("GET", f"{W}/transactions/register?accountId={A}")[0])


    s = Sampler(); s.start()
    threads = [threading.Thread(target=reader) for _ in range(8)]
    for t in threads: t.start()
    time.sleep(20)
    stop = True
    for t in threads: t.join()
    s.stop = True; s.join()
    results["register x8 readers"] = {"p50": pct(reader_ms, 50), "p95": pct(reader_ms, 95), "max": max(reader_ms),
                                      "n": len(reader_ms), "peak": s.peak}
    print(f"register, 8 readers         {pct(reader_ms, 50):7.1f}ms {pct(reader_ms, 95):7.1f}ms {max(reader_ms):7.1f}ms"
          f"  n={len(reader_ms)} peak ws {s.peak['ws'] / 1048576:.0f} MB, private {s.peak['private'] / 1048576:.0f} MB")
    time.sleep(5)
    results["memory after load"] = mem()
    m = results["memory after load"]
    print(f"memory: idle ws {results['memory idle']['ws'] / 1048576:.0f} MB, after load ws {m['ws'] / 1048576:.0f} MB, "
          f"peak ws {m['peakWs'] / 1048576:.0f} MB")
    json.dump(results, open(os.path.join(OUT, f"api-{label}.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
