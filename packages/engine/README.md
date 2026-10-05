# @language-coach/engine

Deterministic learner-model core for language-coach: events in, Learner Model
out. No Pi, no LLM calls, no network. All paths are injected by the host
adapter; the engine never reads `process.env` and never hardcodes locations.

Architecture: `docs/odd/learner-model-v2.md`.

## Dependency policy

`zod` is the package's **first and only runtime dependency**, introduced in
Milestone 2 (Mistake intelligence). The architecture doc mandates zod
validation at the classifier boundary: the LLM may return anything, and every
byte must pass `src/analysis/schema.ts` before it can influence the model.
Nothing else in the engine parses untrusted shapes, and no further runtime
dependencies are expected. `EventSchemaVersion` stays `1` — the M2 additions
(`severity`, `subcategory`, `summary`) are additive optional fields, and the
zod schemas validate classifier IO and rejection payloads, not the event-log
format.

## Layout

- `src/events/` — versioned event union and typed boundary factories
- `src/learner/` — model types, JSONL store, snapshot IO
- `src/engine/` — pure fold reducers (EWMA mastery, status, SRS)
- `src/taxonomy/` — versioned closed catalog (`catalog.ts`) and pending
  proposal store (`pending.ts`)
- `src/analysis/` — classifier port, zod schemas, rejection mapping
- `test/` — vitest, deterministic, injected paths, no Pi, no LLM
