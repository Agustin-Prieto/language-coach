# Feature: Coach stats review findings (R3-001..R3-003)

## Goal
Address the three advisory findings from the native review of
`/language stats` (lineage `review-2c141a37c8c7d5f4`), recorded in
`docs/odd/coach-stats.md`.

## Tasks
- [x] T1 — R3-001: strict ISO 8601 parsing in `parseLogDate` (regex + NaN
  guard; accepts what `toISOString()` writes, rejects lenient fallbacks).
- [x] T2 — R3-002: DST-safe week bucketing — boundaries via `setDate`
  (local calendar), 4 displayed buckets `[current-21d … current]` plus a
  calendar `current+7d` upper bound; fixed `WEEK_MS` arithmetic removed.
- [x] T3 — R3-003: `/language stats` counts malformed JSONL lines (parse
  failures and schema failures) and appends a "Skipped N malformed log
  line(s)" note instead of dropping them silently.
- [x] T4 — Verified and committed (see Evidence).

## Evidence
- tsc strict: `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json` → exit 0.
- gentle-ai-verify round 1 (task mug1nbbi-1-smzi): R3-001, R3-003, edge
  cases, command-safety PASS; R3-002 DST sweep PASS but caught a window
  regression — first attempt displayed `[current-28d … current]` and
  dropped the current week from buckets and trend.
- Fix: bounds rebuilt as described in T2; round 2 (task mug26ioh-2-dl14)
  PASS 8/8: real-log output identical to HEAD (weeks, trend `rising`,
  18 corrections in Sep 21–27) and DST minute-sweeps (US spring/fall,
  AU fall-back) all align on local Monday 00:00.
- Stats command confirmed read-only (no write calls reachable from the
  stats branch).

## Commits
- `c47b169` fix(coach): harden stats date parsing, DST-safe week buckets, malformed-line reporting

## Notes
- Round-1 regression was an implementer error the verifier caught before
  commit — the "one extra weekStart" must extend the *end* of the window,
  not shift its start.

## Native review
- Lineage `review-d14503562331976b`, medium tier, lens `review-reliability`,
  candidate `e44ebfcd5e70a67f1bf1e25e3e2dafa667646ea7..61489833f7b16fd05ad8535ceb5ce845961835cb`
  (committed range, 2 files, 71 lines) — **approved**, acknowledged,
  authority burned (`gentle-ai.review-acknowledged/v1`).
- Three advisory SUGGESTION findings (informational, non-blocking): strict
  regex hardening at :148-151, weekStarts construction comment at :173-186,
  skipped-counter rendering at :335-344. Recorded as possible later polish.
