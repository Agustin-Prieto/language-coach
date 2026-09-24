# Feature: Language drill (/skill:language-drill)

## Goal
Close the learning loop: turn the user's own recurring corrected mistakes
(ranked **bold** spans in the coach log + Engram mistake notes) into short
targeted exercises.

## Design
- Skill-based (like language-interview), not extension code: zero overlay
  cost until invoked, progressive disclosure, model reads the log directly.
- Data: `~/.pi/agent/language-coach-log.jsonl` (`kind:"correction"` entries,
  rank `**bold**` spans) + Engram `topic_key: language-mistakes-<target>`.
- Exercise: native-language sentence scenario tempting one historical
  mistake; user answers in target language; corrected sentence bolds the
  changed words; short native-language explanation.
- Default 5 exercises (max 10), one at a time, first-try score, end summary,
  recurring mistakes saved back to Engram (same topic_key).
- Takes precedence over the always-on coach overlay while active.

## Tasks
- [x] T1 — Create skills/language-drill/SKILL.md.
- [x] T2 — README documentation (How it works + Commands).
- [x] T3 — Verify end-to-end with a live headless drill (parent-owned).
- [x] T4 — Work-unit commit on main (parent-owned).

## Evidence
- Live headless verification (fresh pi session, 2026-09-24): prompt
  "Run a language drill please" → skill loaded from the package, read the
  real log (25 corrections), ranked recurring mistakes (capital I,
  prepositions in/on, question word order, adjective/adverb), and produced
  exercise 1/5 in Spanish tempting exactly those mistakes. Score + summary
  flow deferred to interactive use by design.
- Commits: `fdf0977` (feature) + (this record).

## Native review
- Lineage `review-eeb6dabc4d0e5bfe`, medium tier, lens `review-reliability`,
  candidate `dc4491d..fdf0977` — **approved**, acknowledged, authority burned.
- Advisory, non-blocking (possible later polish): max-count bounds wording
  (SKILL.md:14), log-extraction determinism (:10), mem_save failover (:18),
  overlay-suppression phrasing (:19).

## Notes
- Skill loads on next pi start (package convention directory skills/).
- Real data to target (2026-09-24): i x7, in x3, perfectly, would you like,
  on, commands, pc, let's.
