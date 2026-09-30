# Load-test seed: the wallet's structure through the API, then N transactions
# straight into SQLite (the API would take hours for 100k). Invented data only.
# See ../sqlite-load-test.md for how to run it.
#   python seed.py [N]
import http.cookiejar, json, os, random, secrets, sqlite3, sys, urllib.request
from datetime import date, timedelta

BASE = "http://127.0.0.1:8097"
# Everything a run writes (the database, the throwaway login, the results)
# stays in out/, which git ignores.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
DB = os.path.join(OUT, "data", "cloudbank.db")
N = int(sys.argv[1]) if len(sys.argv) > 1 else 100_000
rnd = random.Random(42)

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
    )
    with op.open(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


# A throwaway admin for a local test instance; kept next to the data it opens.
pw = secrets.token_urlsafe(18)
call("POST", "/api/v1/setup", {"username": "load", "email": "load@example.test", "password": pw})
with open(os.path.join(OUT, "creds.json"), "w") as f:
    json.dump({"username": "load", "password": pw}, f)

w = call("POST", "/api/v1/wallets", {"title": "Load", "baseCurrency": "EUR"})
wid = w["id"]
W = f"/api/v1/wallets/{wid}"

acc_specs = [
    ("Checking", "checking", 0.55),
    ("Credit card", "creditcard", 0.20),
    ("Cash", "cash", 0.10),
    ("Savings", "savings", 0.05),
    ("Joint", "checking", 0.07),
    ("Broker", "investment", 0.03),
]
accounts = []
for name, typ, share in acc_specs:
    a = call("POST", f"{W}/accounts", {"name": name, "type": typ, "initialBalance": 100000})
    accounts.append((a["id"], share))

cats = []
for i in range(12):
    p = call("POST", f"{W}/categories", {"name": f"Group {i + 1}", "isIncome": i == 0})
    cats.append(p["id"])
    for j in range(4):
        c = call("POST", f"{W}/categories", {"name": f"Sub {i + 1}.{j + 1}", "parentId": p["id"], "isIncome": i == 0})
        cats.append(c["id"])

payees = []
for i in range(400):
    payees.append(call("POST", f"{W}/payees", {"name": f"Payee {i + 1:03d}"})["id"])

db = sqlite3.connect(DB, timeout=30)
db.execute("PRAGMA foreign_keys=ON")
tags = []
for i in range(30):
    cur = db.execute("INSERT INTO tags (wallet_id, name) VALUES (?, ?)", (wid, f"tag{i + 1}"))
    tags.append(cur.lastrowid)

start = date(2016, 10, 1)
days = (date(2026, 9, 29) - start).days
acc_ids = [a for a, _ in accounts]
weights = [s for _, s in accounts]
memos = ["", "", "weekly shop", "monthly", "refund", "online order", "fuel", "dinner"]

txn_rows = 0
splits = transfers = tagged = 0
for k in range(N):
    acc = rnd.choices(acc_ids, weights)[0]
    d = (start + timedelta(days=rnd.randrange(days + 1))).isoformat()
    status = rnd.choices([0, 1, 2], [0.1, 0.2, 0.7])[0]
    r = rnd.random()
    if r < 0.03:  # transfer: two linked rows
        to = rnd.choice([a for a in acc_ids if a != acc])
        amt = rnd.randrange(1000, 200000)
        a1 = db.execute(
            "INSERT INTO transactions (wallet_id, account_id, date, amount, payment_mode, status, memo) VALUES (?,?,?,?,5,?,?)",
            (wid, acc, d, -amt, status, "transfer"),
        ).lastrowid
        a2 = db.execute(
            "INSERT INTO transactions (wallet_id, account_id, date, amount, payment_mode, status, memo) VALUES (?,?,?,?,5,?,?)",
            (wid, to, d, amt, status, "transfer"),
        ).lastrowid
        db.execute("INSERT INTO transfers (txn_from_id, txn_to_id) VALUES (?, ?)", (a1, a2))
        transfers += 1
        txn_rows += 2
        continue
    income = r < 0.10
    amt = rnd.randrange(50000, 400000) if income else -rnd.randrange(100, 30000)
    is_split = 0.10 <= r < 0.13
    cat = None if is_split else rnd.choice(cats)
    tid = db.execute(
        "INSERT INTO transactions (wallet_id, account_id, date, amount, payment_mode, status, payee_id, category_id, memo, is_split) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (wid, acc, d, amt, rnd.randrange(0, 11), status, rnd.choice(payees), cat, rnd.choice(memos), int(is_split)),
    ).lastrowid
    txn_rows += 1
    if is_split:
        a = amt // 2
        db.execute("INSERT INTO splits (transaction_id, category_id, amount, position) VALUES (?,?,?,0)", (tid, rnd.choice(cats), a))
        db.execute("INSERT INTO splits (transaction_id, category_id, amount, position) VALUES (?,?,?,1)", (tid, rnd.choice(cats), amt - a))
        splits += 1
    if rnd.random() < 0.10:
        for t in rnd.sample(tags, rnd.randrange(1, 3)):
            db.execute("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)", (tid, t))
        tagged += 1
db.commit()
# No PRAGMA optimize/ANALYZE here: a user's database never has statistics
# (CloudBank does not run ANALYZE), and with them the planner picks other plans.
# The first run of this test did, and its "before" numbers came out up to 20x
# slower than a real install's.
db.close()

ids = {"wid": wid, "accounts": acc_ids, "cats": cats[:5], "payees": payees[:5]}
with open(os.path.join(OUT, "ids.json"), "w") as f:
    json.dump(ids, f)
print(json.dumps({"rows": txn_rows, "splits": splits, "transfers": transfers, "tagged": tagged, **ids}))
