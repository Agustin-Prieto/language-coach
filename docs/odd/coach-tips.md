# Feature: Learned tips (per-error help on the rail)

## Goal
Replace generic heuristic advice with real tips learned from the user's own
corrections: the overlay emits a compact tip line per generalizable
correction, captured mechanically and shown under each top error on the rail.

## Design
- Overlay (🎓 correction section): after the ✏️ line, when the correction
  reveals a generalizable pattern, add `> 💡 <tip, max ~12 words>` — only
  for reusable rules, never typos or one-offs.
- Capture: message_end parses 💡 lines and the first **bold** span of the
  same block's ✏️ line; appends `{ ts, span, tip }` to
  `~/.pi/agent/language-coach-tips.jsonl` (append-only, like vocab).
- Rail: under each top error span, show the most frequent tip recorded for
  that span (case-insensitive span match); fall back to the existing
  errorRecommendation heuristic when no tip exists. Tips never exceed the
  card width (toOneLine).
- Drill: on a miss, quote the stored tip for the target span when present
  ("Recorded tip: ..."), after the corrected sentence.
- Failure policy: capture failures never break the session (same as vocab).

## Tasks
- [x] T1 — Overlay 💡 line + capture into language-coach-tips.jsonl.
- [x] T2 — Rail: per-span learned tips with heuristic fallback.
- [x] T3 — Drill skill: quote stored tips on misses.
- [x] T4 — README documentation.
- [x] T5 — Verify (parent: tsc + capture probe).

## Evidence
- tsc strict: `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json` → exit 0.
- Worker probe: 8/8 assertions on extracted tipsFromBlock/topTipFor (valid
  tip ↔ first bold span pairing; empty and >120-char tips dropped;
  case-insensitive lookup; ties → most recent; no bold span or no ✏️ line →
  nothing captured).
- Live end-to-end (parent, headless pi): input "yesterday i run the tests
  on my pc and all works perfect, i am happy" → coach block with ✏️
  correction and 💡 tip; capture stored
  `{"span":"ran","tip":"Past events need past tense: \"yesterday I ran /
  it worked\"."}` in ~/.pi/agent/language-coach-tips.jsonl. The rail now
  shows that learned tip under the "ran" span.
- Known accepted deviation: card body renders a single role, so tip lines
  match the existing body style (no note/dim distinction) — flagged by the
  implementer, accepted.
- Commit: (this feature commit).
