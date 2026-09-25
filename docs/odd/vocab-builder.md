# Feature: Vocabulary builder (capture, review, drill)

## Goal
Turn the coach's daily 🌐 translations into a reviewable phrase store:
capture notable multi-word English phrases, schedule their review, and
practice them in drills.

## Design (locked with user)
- Capture: overlay gains an optional third coach-block line for
  translations only: `> 📚 "english phrase" — spanish gloss` (max 2,
  multi-word phrases). The extension captures 📚 lines mechanically at
  message_end into `~/.pi/agent/language-coach-vocab.jsonl`
  (`{ ts, phrase, translation, source: "translation" }`), append-only.
- Reviews: drill sessions append `{ ts, phrase, correct }` records to
  `~/.pi/agent/language-coach-vocab-reviews.jsonl` via bash (append-only).
- Scheduling (pure function, testable): a phrase is due if never reviewed
  or days since last correct review >= interval(streak); intervals
  [2,4,7,14,30] days by consecutive-correct streak; a miss resets streak.
- Drill: mixes due-vocab exercises (produce-the-phrase with hint fallback)
  with mistake drills; review records appended at drill end.
- `/language vocab`: summary (total phrases, due now) + 5 most recent;
  read-only. Digest: vocab section (new phrases + due count since last
  digest header). Overlay addition kept to one compact sentence.

## Tasks
- [x] T1 — Extension: 📚 capture at message_end + overlay line + VOCAB_PATH.
- [x] T2 — Extension: scheduling helper + `/language vocab` + digest vocab section.
- [x] T3 — Drill skill: vocab exercises + review-record appends.
- [x] T4 — README documentation.
- [x] T5 — Verify (parent: tsc + gentle-ai-verify + live test).

## Evidence
- tsc strict: `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json` → exit 0.
- gentle-ai-verify (task mugb6jyn-d-kzsc): 5/5 PASS — 24/24 scheduling
  assertions (never-reviewed, boundary >=, miss 1-day rule, streak
  recovery, dedupe latest-wins, clamp at 30, malformed-line skips);
  capture parsing accept/reject matrix (em dash required, multi-word,
  leading whitespace tolerated); command safety (vocab files written only
  by appendVocab in message_end; /language vocab and digest read-only);
  live end-to-end: two headless Spanish prompts captured 3 real phrases
  (`when you have a minute`, `take a look at`, `left pending`),
  /language vocab reported "3 phrases tracked, 3 due now", digest gained
  the Vocabulary line.
- Scheduling note: first correct review → 2-day interval (streak-1
  indexing fixed pre-verification per agreed 2→4→7→14→30 progression).
- Commit: (this feature commit).
