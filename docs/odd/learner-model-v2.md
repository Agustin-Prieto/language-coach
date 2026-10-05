# Learner Model v2 — Architecture

Status: proposed (packaging decision made, implementation not started)

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Packaging | **Split**: standalone engine package + Pi extension as thin adapter | Two surfaces exist today (Pi extension, Astro web). Deterministic core must be testable and reusable outside Pi. Same pattern as gentle-shell (deterministic core, host adapters). |
| Source of truth | Append-only `events.jsonl`; `learner.json` is derived state | Rebuildable, auditable, versioned. |
| Who computes state | **Code only.** Reducers, mastery, SRS, status transitions, policy, selection, stats | Anti-hallucination + token savings. LLM never scores, never mutates state, never forms policy. |
| LLM role | Two jobs only: **classify** (pick IDs from a closed taxonomy) and **generate** (prose from engine-selected items) | Closed outputs are schema-validated; invalid output becomes an `analysis_rejected` event, never a mutation. |

## Repository layout

```text
language-coach/                 (this repo, pnpm workspace)
├── packages/engine/            NEW — @language-coach/engine
│   ├── src/
│   │   ├── events/             event types + schema versions
│   │   ├── learner/            model types, store
│   │   ├── engine/             reducers, state machines, SRS scheduler
│   │   ├── policy/             correction policy (pure functions)
│   │   ├── selection/          drill/review item selection, context budget
│   │   ├── taxonomy/           versioned catalog of categories + patterns
│   │   ├── analysis/           classifier port + zod schemas
│   │   └── generation/         generator port
│   └── test/                   unit tests, no Pi, no LLM
├── extensions/language-coach.ts   existing Pi extension, becomes adapter
├── skills/                     language-drill, language-interview (unchanged surfaces)
└── docs/odd/
```

### Hard boundary rules

- The engine **never imports Pi** — no Pi types, no `process.env` reading, no hardcoded paths.
- Storage location is injected; default `~/.pi/agent/language-coach/` for data continuity.
- LLM access is defined as ports (`Classifier`, `Generator`) implemented by the host:
  Pi extension implements them with Pi's model relay; web implements them with its own.

## Data flow

```text
Pi conversation
   │
   ▼
Adapter (Pi extension)
   │  deterministic gate: skip short / non-natural-language /
   │  already-analyzed / known-correct messages → zero LLM cost
   ▼
engine.append(events)          ← events.jsonl, append-only
   │
   ▼
engine.fold(events)            ← pure reducers → learner.json (cache)
   │
   ├─► policy.decide(model, candidate)  → directive injected into prompt
   ├─► selection.due(model, caps)       → bounded context, never full model
   └─► drills / interview / stats       → consume the same model
```

## Key mechanisms

### 1. Closed-vocabulary classification

- `taxonomy/` owns categories, subcategories, and a pattern registry
  (`since-vs-for`, `article-the`, ...) as versioned code data.
- The classifier must choose a `patternId` from the list or return
  `uncategorized` with `proposedPattern`.
- Proposed patterns enter a pending queue; canonicalization into the
  registry happens through code review, not chat.
- Classifier output is zod-validated. Failure → `analysis_rejected` event,
  no model mutation.

### 2. Correction policy is a pure function

```text
decideCorrection(model, candidate)
  → { action: "correct" | "hint" | "ignore" | "challenge", reason }
```

Thresholds on mastery and status drive interruption. The prompt builder
injects the decision as a directive; the LLM executes, never decides.

### 3. Deterministic context budget

Prompt builder serializes a bounded slice: top-N due mistakes for active
patterns, current focus, caps from config. Drill "reasons" are templated
from data in code.

### 4. Vocabulary honesty

- `usage`: deterministic lemma/exact match of the word in authored
  sentences → `vocabulary_used` event.
- `recognition`: only drills move it. Never estimated by the LLM.

### 5. State machines

Mistake status (`new → learning → review → mastered`, `mastered → regressed`)
and SRS intervals are explicit tables in code, unit-tested.

## Migration / reuse

Existing deterministic logic in `extensions/language-coach.ts` moves into
the engine: `aggregateStats`, `vocabSchedule`, log parsing. Existing
`~/.pi/agent/language-coach-*.jsonl` files become the seed event log
(a one-time importer, schema-versioned).

Add `coach rebuild` (replay `events.jsonl` through reducers) from day one
to validate reducers against real history.

## Milestones

- **M0 — Engine scaffold**: workspace package, event + model types,
  store, fold, first reducer tests.
- **M1 — Learner Model**: MistakeProfile, VocabularyProfile, learner.json,
  versioning, importer for existing logs, `coach rebuild`.
- **M2 — Mistake intelligence**: taxonomy catalog, classifier port + schema,
  mastery + status transitions, nextReviewAt.
- **M3 — Adaptive coach**: policy functions, context budget, prompt builder
  directives.
- **M4 — Personalized drills**: selection from due/weakest items, templated
  reasons, drill results as events.
- **M5 — Interview + web integration**: interview consumes/updates the model;
  language-coach-web reads learner.json via the engine.

## Principle

> The conversation is the input. Events are the truth. The Learner Model is a
> deterministic projection. The LLM classifies within closed lists and writes
> prose. It never computes, never scores, never decides policy.
