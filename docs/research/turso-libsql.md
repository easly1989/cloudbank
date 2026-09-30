# SQLite driver evaluation: turso vs libsql vs modernc

**Research date:** 2026-09-30 (the NOCASE and window-frame findings were re-checked against the sources the same day)  
**Scope:** Should CloudBank replace `modernc.org/sqlite` v1.59.0 with either `tursodatabase/turso` (Rust rewrite) or `tursodatabase/libsql` (C fork of SQLite)?

---

## 1. Status, maturity, and licence

### tursodatabase/turso

- **What it is:** A from-scratch Rust reimplementation of the SQLite engine — same file format, same SQL dialect, same C API surface, but written in Rust.
- **Latest release:** v0.8.1, 2026-09-29. ([GitHub releases](https://github.com/tursodatabase/turso/releases))
- **Production-ready?** The project states "Turso powers production applications today at multiple organisations, including Turso Cloud, the Kin AI assistant, and Spice.ai," but explicitly adds: "we have not yet reached 1.0 … we recommend keeping backups." ([README](https://github.com/tursodatabase/turso))
- **Compatibility target:** SQLite 3.50.4. Validated via differential testing and Antithesis simulation.
- **Licence:** MIT. No conflict with AGPL-3.0.

### tursodatabase/libsql

- **What it is:** An open-contribution fork of SQLite in C, extending SQLite with remote access, embedded replicas, and a permissive contribution model.
- **Latest release:** libsql-server-v0.24.32, 2025-02-14. ([GitHub releases](https://github.com/tursodatabase/libsql/releases)) Last release was ~8 months before this research.
- **Production-ready?** The repo README says "actively maintained," but also: "new features are being developed in Turso." The server-side release cadence has stalled; embedded use appears to be in maintenance mode.
- **Licence:** MIT. ([README](https://github.com/tursodatabase/libsql)) No conflict with AGPL-3.0.

---

## 2. Go drivers

### turso Go driver

| Property | Value |
|---|---|
| Module | `turso.tech/database/tursogo` |
| Latest version | v0.8.1 (2026-09-29) ([pkg.go.dev](https://pkg.go.dev/turso.tech/database/tursogo)) |
| CGO required? | **No.** Uses the `ebitengine/purego` library to call Rust-compiled C ABI functions from Go. ([bindings/go README](https://github.com/tursodatabase/turso/tree/main/bindings/go)) |
| `database/sql` driver? | Yes. Driver name: `"turso"`. |
| Supported OS/arch | Linux, macOS, **Windows** explicitly listed. ([pkg.go.dev](https://pkg.go.dev/turso.tech/database/tursogo)) |
| Status | Active; ships with each turso release. |

DSN note: the driver accepts `_busy_timeout=5000` as a query parameter (e.g., `mydb.db?_busy_timeout=5000`). It does **not** use modernc's `_pragma(...)` syntax. ([pkg.go.dev](https://pkg.go.dev/turso.tech/database/tursogo))

### libsql Go drivers

| Driver | Module | CGO? | Windows? | Status |
|---|---|---|---|---|
| go-libsql | `github.com/tursodatabase/go-libsql` | **Yes** (`CGO_ENABLED=1`) | **No** (Linux amd64/arm64, darwin amd64/arm64 only) | Active; latest v0.0.0-20260424 ([pkg.go.dev](https://pkg.go.dev/github.com/tursodatabase/go-libsql)) |
| libsql-client-go | `github.com/tursodatabase/libsql-client-go` | unconfirmed | unconfirmed | **Deprecated** — repo README directs to go-libsql or turso-go ([GitHub](https://github.com/tursodatabase/libsql-client-go)) |

`go-libsql` is a `database/sql`-compatible driver and does expose a standard `sql.DB`. However, its platform support explicitly excludes Windows.

---

## 3. SQL compatibility gaps for CloudBank

### 3a. turso

Source: [COMPAT.md](https://github.com/tursodatabase/turso/blob/main/COMPAT.md), read 2026-09-30.

| CloudBank feature | Status in turso | Impact |
|---|---|---|
| `OVER (ORDER BY … ROWS UNBOUNDED PRECEDING)` (running sum) | **❌ Not supported**: "Custom frame specs (`ROWS`/`RANGE`/`GROUPS BETWEEN`, `EXCLUDE`) are not yet supported" | **Showstopper: the register's running balance (`queries/transactions.sql`) uses exactly this** |
| `COUNT(*) OVER ()` (total count window) | Likely works (aggregate, no frame) | Low risk |
| `RETURNING` | ✅ Full | None |
| `ON CONFLICT` (upsert) | ✅ Full | None |
| `strftime`, `date()` | ✅ Full | None |
| `ALTER TABLE` ADD COLUMN / RENAME | ✅ Full | None |
| `REFERENCES` / foreign keys | ✅ Full | None |
| `PRAGMA foreign_keys` | ✅ Full | None |
| `PRAGMA journal_mode(WAL)` | ✅ Full | None |
| `PRAGMA busy_timeout(5000)` | ✅ Full | None |
| **`PRAGMA synchronous(NORMAL)`** | **❌ NORMAL not supported** — only OFF and FULL | **Showstopper: must change or accept weaker durability** |
| `COLLATE NOCASE` | ✅ Built in. `core/translate/collate.rs` maps `binary`, `nocase` and `rtrim` to built-in sequences. The COMPAT.md bug (unknown names silently fall back to BINARY) concerns *custom* collation names only | None |
| `group_concat` | ✅ Full | None |
| `coalesce` | ✅ Full | None |
| `INDEXED BY idx_…` | ✅ Full | None |
| Covering indexes | Not explicitly listed in COMPAT.md | Unconfirmed |
| `WITH RECURSIVE` CTEs | **❌ Not supported** | None (CloudBank does not use recursive CTEs) |
| `VACUUM INTO` | ✅ Supported | None (used in `Backup()`) |

**COLLATE NOCASE detail (corrected on review):** a first reading took NOCASE for an "unknown" collation. The source says otherwise: `CollationSeq::new` in [core/translate/collate.rs](https://github.com/tursodatabase/turso/blob/main/core/translate/collate.rs) returns `NoCase` for `"nocase"`, so `ORDER BY name COLLATE NOCASE` works. COMPAT.md's bug applies to names outside BINARY/NOCASE/RTRIM and to locale collations.

**Window frame detail:** the only window query with an explicit frame is the running balance, `SUM(t.amount) OVER (ORDER BY t.date, t.id ROWS UNBOUNDED PRECEDING)`. For this ordering the default frame (`RANGE UNBOUNDED PRECEDING`) would give the same result only while `(date, id)` is unique, which it is. So the query could be rewritten without the explicit frame, but that is a change made for the engine, and it would need testing.

**PRAGMA synchronous=NORMAL detail:** CloudBank's `openPool` passes `synchronous(NORMAL)` via DSN. Turso only supports OFF and FULL. FULL is roughly equivalent to SQLite's `synchronous=EXTRA` (more fsyncs), which would increase write latency for no benefit on a WAL database.

**Multiple read connections:** Turso's COMPAT.md does not document multi-connection reads to the same WAL file. It only documents same-connection write serialisation. Behaviour of CloudBank's two-pool model is unconfirmed.

**File format:** Turso states "✅ SQLite file format is fully supported" and "You should be able to access a database created with SQLite in Turso." Existing `.db` files should open. Files written by Turso should remain readable by stock SQLite.

### 3b. libsql

libsql claims "100% compatibility with the SQLite API" ([README](https://github.com/tursodatabase/libsql)). As a C fork of SQLite it inherits the same built-in collations, window-function frames, and PRAGMA set. No compatibility gaps are expected for CloudBank's feature set. However, no published COMPAT.md exists to cite against; this is unconfirmed from a primary source.

WAL mode, multi-connection reads, and file format are inherited from SQLite and should work identically.

---

## 4. What they add beyond SQLite

| Feature | turso | libsql | Relevant to single-node self-hosted? |
|---|---|---|---|
| `BEGIN CONCURRENT` / MVCC | ✅ (experimental) | ❌ (still single-writer) | **No** — CloudBank already caps writes to 1 connection; MVCC would not help |
| Async I/O (io_uring) | ✅ Linux only | ❌ | Marginal — CloudBank's bottleneck is query planning, not syscall overhead |
| Vector search | ✅ built-in | ✅ (extension) | No |
| Embedded replicas + sync | ✅ (main selling point for Turso Cloud) | ✅ | No — single-node, no remote sync needed |
| CDC / change streams | Unconfirmed | Unconfirmed | No |
| Encryption | Unconfirmed | ✅ ([README](https://github.com/tursodatabase/libsql)) | Not needed: CloudBank already encrypts its secrets at rest (`internal/secrets`) |
| FTS (full-text search) | Tantivy-based (not SQLite FTS5) | SQLite FTS5 inherited | No |
| Postgres wire protocol | ✅ experimental | ❌ | No |

For a single-node, self-hosted, personal-finance app with one write connection and a local file, none of the extras are immediately applicable.

---

## 5. Published performance claims

**turso:** No quantitative benchmarks are published in the README or COMPAT.md as of 2026-09-30. The 0.8.0 release notes mention "performance enhancements across storage, MVCC, and query execution" but give no numbers. The io_uring path is Linux-only. No Go-driver benchmarks are available from a primary source.

**libsql:** No published performance benchmarks found. The project inherits SQLite's performance profile; no claims of improvement.

**Conclusion:** Neither project publishes Go-driver benchmarks comparable to CloudBank's 80–400 ms report queries on 103k transactions. Any performance claim would be unconfirmed.

---

## 6. Practical path to a benchmark

### turso

- **Driver to use:** `turso.tech/database/tursogo` (no CGO, pure Go + prebuilt Rust dylib).
- **Can it build on Windows?** Yes — Windows is explicitly supported by the driver. However, the prebuilt Rust library must be present at link time. The `turso-go-platform-libs` dependency distributes these; it is untested in this evaluation.
- **Changes needed in `server/internal/store/store.go`:**
  1. Replace `_ "modernc.org/sqlite"` import with `_ "turso.tech/database/tursogo"`.
  2. Change driver name from `"sqlite"` to `"turso"` in `sql.Open`.
  3. Rewrite DSN: modernc's `_pragma(...)` syntax is not supported. Replace with individual query parameters. Example:

     ```go
     dsn := "file:" + dbPath +
         "?_journal_mode=WAL" +
         "&_foreign_keys=on" +
         "&_busy_timeout=5000"
     // synchronous=NORMAL cannot be set; must accept FULL or omit it
     ```

  4. Evaluate whether `synchronous=NORMAL` → `FULL` is acceptable (more fsyncs per transaction).
  5. Fix or work around `COLLATE NOCASE` before any benchmark — the silent sort regression means query results are wrong, not slow.

### libsql

- **Driver to use:** `github.com/tursodatabase/go-libsql`.
- **Can it build on Windows?** **No.** The driver requires CGO and distributes precompiled libraries only for Linux and macOS. A Windows developer cannot run tests or build the binary without Docker.
- **Changes needed:** Same driver-name and DSN changes as above, but CGO must be enabled and the build system must target only Linux/macOS.

---

## Verdict

**Not worth benchmarking now. Both alternatives have hard blockers for CloudBank.**

### turso — not ready for CloudBank's data

1. **Explicit window frames are not supported** ([COMPAT.md](https://github.com/tursodatabase/turso/blob/main/COMPAT.md)). The register's running balance uses `ROWS UNBOUNDED PRECEDING`. It could be rewritten, but only to suit the engine.
2. **`PRAGMA synchronous=NORMAL` is unsupported** (OFF and FULL only). FULL means more fsyncs per write: slower writes, not wrong ones.
3. **Pre-1.0, "keep backups."** For someone's financial records, that alone rules it out as the default engine.
4. **Two pools on one file:** the behaviour is not documented (unconfirmed).
5. **Not a static binary any more.** The Go driver is no-cgo, but through purego it loads a Rust shared library at run time. That library has to ship in the image and resolve on Windows. How `turso-go-platform-libs` packages it is unconfirmed.

`COLLATE NOCASE` is **not** a problem: see the corrected detail above.

### libsql — build-system blocker

1. **The only viable Go driver (`go-libsql`) does not support Windows.** CloudBank developers build and test on Windows; this is a hard constraint.
2. The libsql server release cadence has stalled (last release Feb 2025); active development has moved to turso.

### modernc — no reason to replace it today

`modernc.org/sqlite` is a faithful C-to-Go translation of SQLite itself: pure Go, no CGO, Windows supported, 100% SQLite feature parity including NOCASE, all PRAGMA modes, and window frames. CloudBank's current 80–400 ms report latency on 103k rows is acceptable for a personal-finance app. If those queries become a bottleneck, the right next step is query-level profiling (indexes, query plans) before changing the driver.

**Revisit turso when:** (a) it reaches 1.0, (b) explicit window frames are supported, and (c) `synchronous=NORMAL` is added. Its no-cgo Go driver with Windows support is the one genuinely attractive part.
