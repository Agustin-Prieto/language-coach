# Feature: /language digest — weekly digest file

## Goal
Complement /language stats (now) with a durable over-time record: each run
appends a dated digest section to a markdown file the user can read or
commit anywhere.

## Design
- Subcommand `digest` in the existing /language handler, same shape as
  `stats`.
- Refactor: extract the shared JSONL parse/validate loop used by stats into
  `parseLogEntries(raw): { entries: LogEntry[]; skipped: number }` and reuse
  it in both commands (no behavior change for stats).
- Output file: `~/.pi/agent/language-coach-digest.md`.
- Each run appends one section:
  `## Digest — <new Date().toISOString()>` followed by the rendered stats
  summary and, if a previous digest header exists in the file, a
  "Since last digest" line counting correction entries with ts strictly
  greater than the previous header timestamp.
- Write failures are caught and reported via notify; they never break the
  command. The coach log and config are never written by digest.
- UI: `ctx.ui.notify` (headless falls back to console.log), matching stats.

## Tasks
- [x] T1 — Implement digest subcommand + parseLogEntries refactor.
- [x] T2 — README documentation (Commands + data files table).
- [x] T3 — Verify (parent: tsc + gentle-ai-verify).
- [x] T4 — Work-unit commit (parent).

## Evidence
- tsc strict: `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json` → exit 0.
- gentle-ai-verify (task mug9g8lx-a-ykdq): 5/5 PASS — refactor equivalence
  (parseLogEntries vs HEAD inline loop: deepStrictEqual on 52 real entries),
  digest logic 10/10 assertions (no-previous-header case, strict `>`
  boundary at exact header ts, last-valid-header wins, malformed-header
  fallback), command safety (only DIGEST_PATH written; LOG_PATH/config
  read-only; write-failure path notifies and returns), real end-to-end
  `pi -p "/language digest"` created ~/.pi/agent/language-coach-digest.md
  with today's section and no "Since last digest" line on first run.
- Commit: (this feature commit).
