# Backups, upgrades and restoring

Everything CloudBank keeps lives in its data directory, `/data` in the
container:

- `cloudbank.db`: the SQLite database. It holds every wallet, person and
  setting.
- `attachments/`: the files attached to transactions.

One thing lives outside it: `CB_SECRET_KEY`, if you set it. It encrypts bank
credentials, AI keys and two-factor secrets in the database. A database restored
without the same key loses those secrets, and they have to be set up again.
**Keep a copy of the key somewhere safe, apart from the backups.**

## Three kinds of backup

| | Full database | Wallet backup | Copy of `/data` |
| --- | --- | --- | --- |
| **Where** | Settings → Import & export → Backup & integrity → **Download full database** (administrators) | Settings → Import & export → Backup & integrity → **Download backup** | Outside CloudBank, see below |
| **Holds** | Every wallet, person and setting | One wallet | Everything |
| **Attachments** | No | Yes | Yes |
| **Needs the app stopped** | No | No | Yes |
| **Restores** | The whole server, as it was | A new wallet next to the others | The whole server, as it was |

### Full database

- **What it is:** a consistent snapshot of the whole database, taken while
  CloudBank runs. The file is named after the moment it was taken, such as
  `cloudbank-20260928-101500.db`.
- **What it leaves out:** attachments. If you attach receipts to transactions,
  copy `attachments/` as well, or use a copy of `/data` instead.

### Wallet backup

- **What it is:** one wallet in a single JSON file. It includes:
  - currencies, accounts and their valuations;
  - payees, categories and tags;
  - transactions with their splits, transfers and attachments;
  - templates, schedules, rules, budgets and goals;
  - vehicles, and which transactions belong to each. Backups taken with
    3.5.1 or earlier lack them.
- **What it leaves out:**
  - bank connections, which you connect again;
  - the people, their preferences, two-factor and API tokens.
- **Restoring:** see [One wallet, from a wallet backup](#one-wallet-from-a-wallet-backup).
  Files up to 256 MiB are accepted. Behind nginx, raise its upload limit first
  ([the reverse-proxy guide](reverse-proxy.md)).

**Export .xhb**, next to it, writes the wallet as a HomeBank file. It is your
way back to HomeBank, not a backup: HomeBank has no place for what only
CloudBank keeps, such as goals and attachments.

### A copy of `/data`

The most complete backup, and the only one you can automate outside the app.
Stop CloudBank while you copy: a SQLite database copied while it is being
written can come out inconsistent. With the
[Quick start](../README.md#quick-start)'s `docker-compose.yml`, run this from
the directory you want the backup in:

```bash
docker compose stop cloudbank
docker run --rm --volumes-from cloudbank -v "$PWD:/backup" alpine tar czf "/backup/cloudbank-$(date +%F).tar.gz" -C /data .
docker compose start cloudbank
```

CloudBank is down for as long as the copy takes, usually a few seconds.

## A routine that works

- **Regularly:** a copy of `/data`, from a nightly scheduled job, or at least
  the full database each week.
- **Several of them.** Keep a few generations, somewhere other than the machine
  CloudBank runs on.
- **The key.** Keep `CB_SECRET_KEY` safe too, apart from the backups.
- **Once, a test.** Restore a backup onto a spare install, before you need it
  for real.

A wallet backup is handy before a risky change to one wallet, such as a large
import or a rule applied to everything. It is not a replacement for the above.

## Upgrading

1. **Read what changed:** the release notes on
   [GitHub](https://github.com/easly1989/cloudbank/releases), or
   [CHANGELOG.md](../CHANGELOG.md).
2. **Back up**, as above.
3. **Pull the new image and restart:**

   ```bash
   docker compose pull
   docker compose up -d
   ```

At startup, CloudBank updates the database to the new version by itself. There
is nothing to run by hand.

**Which image you run** is set by its tag. `:main` is the latest stable release;
`:latest` is the nightly build, which can break. Pin a version, such as
`:v3.5.1`, to upgrade only when you choose. See
[Container images and tag convention](../README.md#container-images-and-tag-convention).

**Going back to an older version is not supported.** The database only moves
forward, and an older CloudBank is not guaranteed to work on a database a newer
one has updated. To go back, restore the backup you took before upgrading,
together with the older image.

## Restoring

### One wallet, from a wallet backup

In **Settings → Import & export → Backup & integrity**, choose the `.json` file
under **Restore**. The restore creates a **new wallet**, and never overwrites an
existing one. If the new wallet replaces an old one, delete the old one
afterwards, under **Delete wallet** at the bottom of the same page.

Afterwards, reconnect the wallet's banks, which the wallet backup does not hold.

### The whole server, from a full database

Put the downloaded file in the current directory, and use its name in the
second command:

```bash
docker compose stop cloudbank
docker run --rm --volumes-from cloudbank -v "$PWD:/backup" alpine sh -c 'rm -f /data/cloudbank.db-wal /data/cloudbank.db-shm && cp /backup/cloudbank-20260928-101500.db /data/cloudbank.db && chown 65532:65532 /data/cloudbank.db'
docker compose start cloudbank
```

- `rm` removes the old database's pending changes, which would otherwise be
  replayed on top of the snapshot.
- `chown` gives the file to the user CloudBank runs as.

Everything goes back to the moment of the snapshot: every wallet, person and
setting.

### The whole server, from a copy of `/data`

```bash
docker compose stop cloudbank
docker run --rm --volumes-from cloudbank -v "$PWD:/backup" alpine sh -c 'rm -rf /data/* && tar xzf /backup/cloudbank-2026-09-28.tar.gz -C /data && chown -R 65532:65532 /data'
docker compose start cloudbank
```

### Moving to another machine

Copy `/data` as above, restore it on the new machine, and give the new install
the same `CB_SECRET_KEY`.

## Checking the data

**Settings → Import & export → Backup & integrity → Run check** looks through
the current wallet for anything inconsistent. For example, a reconciled
transaction dated in the future. Each finding comes with a suggested **Fix**.
