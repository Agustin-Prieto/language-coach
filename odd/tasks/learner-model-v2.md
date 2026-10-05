# Feature: Learner Model v2

Architecture: `docs/odd/learner-model-v2.md` (split: standalone engine + Pi adapter).
Decided 2026-10-05 after ChatGPT draft + gentle-shell-inspired adjustments.

## Milestone 0 — Engine scaffold

- [x] M0.1 pnpm workspace + `packages/engine` package scaffold (pure TS, ESM, strict, vitest, zero runtime deps)
- [x] M0.2 Event types: `LanguageEvent` discriminated union with `schemaVersion` (9 events incl. `analysis_rejected`)
- [x] M0.3 Learner model types: `LearnerModel` (v2), `MistakeProfile`, `VocabularyProfile`, supporting types
- [x] M0.4 Append-only JSONL event store with injected storage path
- [x] M0.5 `fold(events) → LearnerModel` reducers (EWMA mastery, status tables, SRS [1,3,7,14,30]d) + snapshot read/write
- [x] M0.6 Unit tests: 29 tests across reducers/fold/store (determinism, purity, malformed-line tolerance)

## Later milestones (from architecture doc)

- M1 — Learner Model complete: importer for existing `~/.pi/agent/language-coach-*.jsonl`, `coach rebuild`
- M2 — Mistake intelligence: taxonomy catalog, classifier port + zod schema, mastery + status transitions
- M3 — Adaptive coach: policy functions, context budget, prompt directives
- M4 — Personalized drills
- M5 — Interview + web integration

## Evidence

- `b87cf7f` docs(odd): add Learner Model v2 architecture with split engine decision (branch `feature/learner-model-v2`)
- M0 implemented by gentle-ai-worker; verified by gentle-ai-verify: 4/4 PASS (install, tsc --noEmit, 29/29 vitest, boundary greps clean, workspace wiring OK)
- M0 commit `c8725d6` reviewed natively (lineage `review-002572e4ac6ec825`, medium tier, lens review-reliability): **approved**, authority acknowledged/burned. 4 non-blocking SUGGESTION findings for later work:
  - R3-001 packages/engine/src/learner/store.ts:48
  - R3-002 packages/engine/src/engine/fold.ts:271
  - R3-003 packages/engine/src/engine/fold.ts:293
  - R3-004 packages/engine/src/learner/store.ts:53
