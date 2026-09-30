# Research notes

What was looked into before a technical decision, and what the measurements
said. These notes are for maintainers, not readers of the user guides. When the
question comes back, start here instead of from scratch.

| Note | Question | Verdict |
|---|---|---|
| [sqlite-load-test.md](sqlite-load-test.md) | Does SQLite hold up at 100k transactions, and where does the time go? | Keep SQLite; the slow reports were one non-covering index (#541, #542). |
| [turso-libsql.md](turso-libsql.md) | Would turso or libSQL be a better engine than `modernc.org/sqlite`? | Not now: turso lacks explicit window frames and is pre-1.0; libSQL's Go driver needs cgo and has no Windows build. |

## Writing one

- **One question per note.** Put the question first and the verdict last.
- **Date it.** Tools move, and a finding is only as good as the day it was
  checked.
- **Primary sources only.** Link each claim to where it comes from: the
  project's own docs, source or release notes. If something cannot be
  confirmed, say "unconfirmed".
- **Numbers come with their conditions** (machine, data, versions), and with the
  script that produced them, in a folder next to the note.
- **Keep the scripts' output out of git.** Scripts write to their own `out/`,
  which a `.gitignore` excludes.
