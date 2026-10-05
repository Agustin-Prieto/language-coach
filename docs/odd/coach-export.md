# Feature: /language export — JSON snapshot for the web app

## Goal
Produce a single consolidated JSON snapshot of all coach data so the
separate web app (language-coach-web) can render progress views from
synced/remote data without touching the raw stores.

## Design
- Subcommand `export` in the /language handler (user-invoked, main session).
- Output: DATA_DIR/language-coach-export.json (overwrite each run).
- Schema language-coach-export/v1:
  { schema, generatedAt, nativeLanguage, targetLanguage,
    stats: { total, kinds, weeks: [{ label, corrections, startISO }], trend },
    log: LogEntry[], vocab: vocabEntries[], reviews: reviewEntries[],
    tips: tipEntries[], learner?: learnerPayload }
- weeks entries carry startISO (the Monday ISO date of each bucket start)
  so the web app can chart without reimplementing week math.
- `learner` (M5, additive optional): present only when the Learner Model
  engine is available; the field is omitted on any engine/store failure, so
  the export stays language-coach-export/v1-compatible (v1 consumers that
  ignore unknown keys are unaffected — same precedent as the additive
  `severity` event field — hence no v2 bump).
  Shape: { model: LearnerModel (the learner.json snapshot contents, or a
  quiet rebuild from events.jsonl), engineStats: { eventCount (total events
  in the store), legacyEventCount (events written by the one-time legacy
  import), drillAttempts (drill_completed events) } }.
- Reuse existing loaders/pure helpers; no new parsing. Write failures are
  caught and reported; log/config/vocab/tips stores are never modified.

## Tasks
- [x] T1 — Implement export command + schema.
- [x] T2 — README documentation.
- [x] T3 — Verify (parent).
- [x] T4 — Commit (parent).

## Evidence
- tsc strict: `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json` → exit 0.
- Live end-to-end (parent, headless): `pi -p "/language export"` → "Export
  saved to ~/.pi/agent/language-coach-export.json"; snapshot validated:
  schema language-coach-export/v1, 149 log / 6 vocab / 3 reviews / 8 tips,
  weeks carry startISO (e.g. Sep 21–27 → 2026-09-21, 85 corrections),
  trend stable. Consumer: language-coach-web repo.
- Review `review-411405c44a381140` **approved** with two informational
  advisories (:1130 WARNING, :1144 SUGGESTION) recorded as later polish;
  acknowledged, authority burned.
- Commits: `3ad9fa5` (feature) + (this record).
