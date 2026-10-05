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

- [x] M1 — Learner Model complete: legacy JSONL importer (log/vocab/vocab-reviews parsed; tips reported unmapped), `EventBase.metadata?` additive field, `SnapshotVersionError` guard, `rebuildEvents`/`rebuildSnapshot` reusing fold/store; 48/48 tests
- [x] M2 — Mistake intelligence: taxonomy catalog v1 (6 seeded patterns), pending-pattern store, zod classifier boundary (typed rejections, strict schemas), typed event factories, severity-weighted mastery {low 0.5, medium 1.0, high 1.5}; 109/109 tests; zod added as first runtime dep
- [x] M3a — Adaptive coach (engine): pure `decideCorrection` policy (regressed > mastery band > status), `dueForReview`, bounded `selectContext` with caps + deterministic token estimate, templated reasons; 148/148 tests
- [ ] M3b — Adapter wiring: Pi extension consumes engine (classifier port, policy-driven coach block, `/coach rebuild`)
- [ ] M4 — Personalized drills
- [ ] M5 — Interview + web integration

## Evidence

- `b87cf7f` docs(odd): add Learner Model v2 architecture with split engine decision (branch `feature/learner-model-v2`)
- M0 implemented by gentle-ai-worker; verified by gentle-ai-verify: 4/4 PASS (install, tsc --noEmit, 29/29 vitest, boundary greps clean, workspace wiring OK)
- M0 commit `c8725d6` reviewed natively (lineage `review-002572e4ac6ec825`, medium tier, lens review-reliability): **approved**, authority acknowledged/burned. 4 non-blocking SUGGESTION findings for later work:
  - R3-001 packages/engine/src/learner/store.ts:48
  - R3-002 packages/engine/src/engine/fold.ts:271
  - R3-003 packages/engine/src/engine/fold.ts:293
  - R3-004 packages/engine/src/learner/store.ts:53
- M1 implemented by gentle-ai-worker (RED→GREEN observed); verified by gentle-ai-verify: 5/5 PASS (tsc, 48/48 vitest, boundary greps clean, mapping honesty, version guard, no duplicated logic)
- M1 commit `53b1d0b` reviewed natively (lineage `review-6b8daf5e20ece4fd`, medium tier, lens review-reliability): **approved**, authority acknowledged/burned. Non-blocking findings for later work:
  - R3-001 (WARNING) packages/engine/src/legacy/import.ts:108
  - R3-002 packages/engine/src/events/sort.ts:9
  - R3-003 packages/engine/src/learner/store.ts:83
- M2 implemented by gentle-ai-worker (RED→GREEN observed); verified by gentle-ai-verify: 6/6 PASS (tsc, 109/109 vitest, closed-vocabulary rules, anti-hallucination boundary, rejection safety, purity, zod-only lockfile delta)
- M2 commit `7429ff1` reviewed natively (lineage `review-9a5ead384aa6aff8`, medium tier, lens review-reliability): **approved with zero findings**, authority acknowledged/burned
- M3a implemented by gentle-ai-worker (RED→GREEN observed); verified by gentle-ai-verify: 5/5 PASS (tsc, 148/148 vitest, policy exhaustiveness, selection stability, no LLM in policy, additive-only helpers)
