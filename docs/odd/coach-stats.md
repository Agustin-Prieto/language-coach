# Feature: /language stats — Coach progress dashboard

## Goal
One command that answers "how am I doing?" without asking the agent:
`/language stats` shows correction volume, weekly trend, and top recurring
corrections from the existing coach log.

## Data sources (already exist, no schema change)
- `~/.pi/agent/language-coach-log.jsonl` — entries
  `{ ts, kind: correction|translation|unmarked, native, target, line }`.
  Corrections contain `**bold**` spans marking the changed words.
- Engram memory topic_key `language-mistakes-<target>` (recurring drill notes).

## Design
- Extend the existing `/language` command with a `stats` subcommand
  (no new command namespace; matches current `on | productivity | off` shape).
- Aggregation (pure function, testable, no fs in unit logic):
  - Total blocks and per-kind counts (correction / translation / unmarked).
  - Corrections per week for the last 4 ISO weeks (Mon-based).
  - Trend: current week vs previous 3-week average (improving / stable / rising).
  - Top corrections: rank `**bold**` spans extracted from correction entries,
    show up to 5 with counts.
  - Last 5 coach blocks (truncated to one line each).
- Rendering: `ctx.ui.notify` compact multi-line summary; headless (`!ctx.hasUI`)
  falls back to `console.log`. Never throws: malformed lines are skipped,
  empty/missing log renders "no data yet".

## Constraints
- Stats command is read-only; it must never write the log or config.
- Logging failures never break the command (same policy as appendLog).
- No new dependencies; reuse node:fs + node:path only.
- Artifact language: English. Token cost: command runs on demand, zero overlay cost.

## Tasks
- [x] T1 — Extract `aggregateStats(entries)` pure logic + `/language stats` subcommand in `extension/language-coach.ts` (implemented, uncommitted)
- [x] T2 — README documentation for the new subcommand (implemented, uncommitted)
- [x] T3 — Verify against real log data via `gentle-ai-verify` (passed: no defects; 25-entry real log, 18 command-safety scenarios, regressions clean)
- [x] T4 — Work-unit commits on `feat/coach-stats-dashboard` (80ffd35, 196b9ec); merge to `main` is a user decision

## Outcome
Implemented, verified, and reviewed on `feat/coach-stats-dashboard`.
Commits: 80ffd35 (feature), 196b9ec (this record).

Native review: lineage `review-2c141a37c8c7d5f4`, medium tier, lens
`review-reliability` — **approved** and acknowledged (authority burned).
Three advisory, non-blocking findings, recorded as later work:
- R3-001 `extension/language-coach.ts:148` (WARNING) — date parsing of log entries
- R3-002 `extension/language-coach.ts:188` (WARNING) — week bucketing uses fixed
  24h arithmetic, so boundaries and labels can drift across DST transitions
- R3-003 `extension/language-coach.ts:312` (SUGGESTION) — JSONL parse failure path

Merge to `main` remains a user decision under ordinary repository policy.
Diff: extension/language-coach.ts (+183, aggregateStats/renderStats/stats branch),
README.md, docs/odd/coach-stats.md.

