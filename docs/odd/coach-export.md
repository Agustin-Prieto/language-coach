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
    tips: tipEntries[] }
- weeks entries carry startISO (the Monday ISO date of each bucket start)
  so the web app can chart without reimplementing week math.
- Reuse existing loaders/pure helpers; no new parsing. Write failures are
  caught and reported; log/config/vocab/tips stores are never modified.

## Tasks
- [x] T1 — Implement export command + schema.
- [x] T2 — README documentation.
- [x] T3 — Verify (parent).
- [x] T4 — Commit (parent).

## Evidence
- (pending — parent fills after verification)
