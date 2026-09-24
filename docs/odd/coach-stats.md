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
- [ ] T3 — Verify against real log data via `gentle-ai-verify`
- [ ] T4 — Work-unit commits on `feat/coach-stats-dashboard`; merge to `main` by user decision

