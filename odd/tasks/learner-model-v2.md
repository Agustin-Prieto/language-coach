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
- [x] M3b — Adapter wiring: Pi extension consumes engine (engine barrel + dist packaging, 🏷️ classification riding the coach block with closed-list ids, policy directives in overlay, event recording with pending-store routing + analysis_rejected fallbacks, `/language rebuild` with confirm, full try/catch degradation to legacy behavior)
- [x] M4 — Personalized drills: deterministic cloze drills from catalog data (all 6 patterns), code-graded answers, self-graded vocab flashcards, `selectDrillItems` with DRILL_CAPS, drill results as events via `makeDrillCompleted`, `/language drill` interactive loop; 180/180 tests. Follow-up: vocabulary drill results don't schedule `nextReviewAt` yet (reducer gap)
- M4.1 — Completion pass: vocabulary drill SRS scheduling (shared `schedule` helper, failure resets), one-time idempotent legacy import bootstrap (marker + zero-event guard), legacy provenance line in `/language rebuild` report; 185/185 tests
- [x] M5 — Interview + web integration: engine `selectInterviewFocus` (weak/strong/vocabulary selection, `INTERVIEW_CAPS` = { maxWeakPatterns: 4, maxStrongAreas: 3, maxReasonChars: 240 }, templated reasons) + barrel export, 16 new tests (201/201); `/language interview-brief` adapter subcommand (same guards/degradation as drill); "Learner Model integration" section in skills/language-interview/SKILL.md; export payload gains additive optional `learner` field (model + engineStats { eventCount, legacyEventCount, drillAttempts }) — schema stays v1

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
- M3a commit `070b034` reviewed natively (lineage `review-88c25a7a8fe5eb6e`, medium tier, lens review-reliability): **approved**, authority acknowledged/burned. Non-blocking suggestions for later work:
  - R3-001 packages/engine/src/policy/correction.ts:43-98
  - R3-002 packages/engine/src/selection/context.ts:85-128
  - R3-003 packages/engine/test/policy-correction.test.ts:117-162
  - R3-004 packages/engine/test/selection-context.test.ts:130-161
- M3b implemented by gentle-ai-worker; verified by gentle-ai-verify: 5/5 PASS (build dist, 148/148 vitest, engine boundary greps, degradation safety on all 4 entry points, closed-vocabulary routing, workspace wiring). Informational: overlay cap slice keeps registry ids before due/active candidates — revisit if registry grows past cap.
- M3b commit `e4b4eef` reviewed natively (lineage `review-e3852b2b82a9b07d`, medium tier, lens review-reliability): **approved**, authority acknowledged/burned. Non-blocking findings for later work:
  - R3-001 (WARNING) extensions/language-coach.ts:414-418
  - R3-002 extensions/language-coach.ts:280-281
  - R3-003 extensions/language-coach.ts:414-418
- M4 implemented by gentle-ai-worker; verified by gentle-ai-verify: 6/6 PASS (build, tsc, 180/180 vitest, determinism, no-LLM drill path, event discipline via makeDrillCompleted, fold integration, additive catalog shape)
- M4 commit `2fa200f` reviewed natively (lineage `review-93069f3f018d71e2`, medium tier, lens review-reliability): **approved**, authority acknowledged/burned. Non-blocking finding for later work:
  - R3-001 (WARNING) extensions/language-coach.ts:495-499
- M4.1 writer timed out after mostly completing the work; finished inline (one stale comment at selection/context.ts:164); verified by gentle-ai-verify: 5/6 then inline fix → all green. Commit `c4bf30f` reviewed natively (lineage `review-0792197277439cfb`, medium tier, lens review-reliability): **approved**, authority acknowledged/burned. Non-blocking suggestion: extensions/language-coach.ts:525
