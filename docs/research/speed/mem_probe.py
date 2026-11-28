# How much memory one endpoint costs under concurrency: 25 clients call it 4
# times each, at once, on a freshly started server, while the server's working
# set is sampled. Start a new server for each endpoint: Go keeps freed heap
# for minutes, so a second probe on the same process would inherit the first.
# See ../speed-baseline.md.
#   python mem_probe.py <base> <server-pid> <creds.json> <endpoint-key>
import json, sys, time
from concurrent.futures import ThreadPoolExecutor

sys.argv = [sys.argv[0], sys.argv[1], "probe", sys.argv[2], sys.argv[3], sys.argv[4]]
KEY = sys.argv.pop()
import bench_api as b  # noqa: E402

path = {
    "dashboard-12m": f"{b.W}/dashboard?from=0001-01-01&to=9999-12-31&groupBy=category&ieMonths=12",
    "dashboard-0m": f"{b.W}/dashboard?from=0001-01-01&to=9999-12-31&groupBy=category&ieMonths=0",
    "dashboard-default": f"{b.W}/dashboard?groupBy=category&ieMonths=0",
    "accounts": f"{b.W}/accounts",
    "review": f"{b.W}/transactions/review",
    "register": f"{b.W}/transactions/register?accountId={b.A}",
}[KEY]

b.call("GET", path)
idle = b.mem()
s = b.Sampler(); s.start()
t = time.perf_counter()
with ThreadPoolExecutor(25) as ex:
    ms = list(ex.map(lambda _: b.call("GET", path)[0], range(100)))
wall = time.perf_counter() - t
s.stop = True; s.join()
print(json.dumps({"endpoint": KEY, "idleWsMB": round(idle["ws"] / 1048576), "peakWsMB": round(s.peak["ws"] / 1048576),
                  "peakPrivateMB": round(s.peak["private"] / 1048576), "p50": round(b.pct(ms, 50)),
                  "p95": round(b.pct(ms, 95)), "wallS": round(wall, 1)}))
