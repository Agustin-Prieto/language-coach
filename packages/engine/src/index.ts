/**
 * Public API of @language-coach/engine.
 *
 * The engine is a deterministic core: events in, Learner Model out. No Pi,
 * no LLM, no network (docs/odd/learner-model-v2.md). Host adapters import
 * ONLY from this barrel; deep imports into src/ are not part of the contract.
 *
 * Surfaces:
 * - events    — versioned event types + schema version + typed factories
 * - learner   — model types, snapshot store (injected directory), rebuild
 * - engine    — pure fold reducers + empty-model factory
 * - policy    — correction policy (decideCorrection, dueForReview) + reasons
 * - selection — bounded prompt-context selection (selectContext, caps)
 * - drill     — deterministic drill selection, answer checking, result application
 * - taxonomy  — closed catalog registry + pending-proposal store
 * - analysis  — zod classifier boundary schemas + rejection reason codes
 * - legacy    — one-time deterministic migration of the pre-engine JSONL logs
 */

// Events ---------------------------------------------------------------------------
export { EventSchemaVersion } from "./events/types.js";
export type {
  AnalysisRejectedEvent,
  DrillCompletedEvent,
  EventBase,
  InterviewCompletedEvent,
  LanguageEvent,
  LanguageEventType,
  MessageAnalyzedEvent,
  MistakeCorrectedEvent,
  MistakeDetectedEvent,
  ReviewCompletedEvent,
  VocabularyDetectedEvent,
  VocabularyUsedEvent,
} from "./events/types.js";

export {
  EventFactoryError,
  InvalidEventInputError,
  makeAnalysisRejected,
  makeDrillCompleted,
  makeMistakeCorrected,
  makeMistakeDetected,
  UnknownPatternError,
} from "./events/factories.js";
export type { MistakeDetectedInput, MistakeDetectedResult } from "./events/factories.js";

// Learner model + store + rebuild ---------------------------------------------------
export type {
  LearningFocus,
  LearningGoal,
  LearningPreferences,
  LearnerModel,
  MasteryState,
  MistakeProfile,
  MistakeStatus,
  ModelSeed,
  SkillProfile,
  VocabularyProfile,
  VocabularyStatus,
} from "./learner/types.js";

export {
  createEventStore,
  EVENTS_FILE,
  readSnapshot,
  SNAPSHOT_FILE,
  SNAPSHOT_VERSION,
  SnapshotVersionError,
  writeSnapshot,
} from "./learner/store.js";
export type { EventStore, ReadEventsResult } from "./learner/store.js";

export { rebuildEvents, rebuildSnapshot } from "./learner/rebuild.js";
export type { RebuildSummary } from "./learner/rebuild.js";

// Fold (pure reducers) ---------------------------------------------------------------
export { createEmptyModel, fold } from "./engine/fold.js";

// Policy -----------------------------------------------------------------------------
export { CORRECTION_THRESHOLDS, decideCorrection, dueForReview } from "./policy/correction.js";
export type { CorrectionAction, CorrectionCandidate, CorrectionDecision } from "./policy/correction.js";
export { renderCorrectionReason, renderDrillReason, toMasteryPercent } from "./policy/reasons.js";
export type { CorrectionReasonData, DrillReasonData } from "./policy/reasons.js";
export type { PatternDrill } from "./taxonomy/catalog.js";

// Selection (deterministic context budget) -------------------------------------------
export { DEFAULT_CONTEXT_CAPS, selectContext, serializeContext } from "./selection/context.js";
export type { ContextCaps, ContextMistakeEntry, PromptContext } from "./selection/context.js";

// Drills (deterministic selection, checking, result application) -----------------------
export { DRILL_CAPS, selectDrillItems } from "./drill/select.js";
export type { DrillCaps, DrillItem, DrillKind } from "./drill/select.js";
export { checkAnswer, normalizeAnswer } from "./drill/check.js";
export type { CheckResult } from "./drill/check.js";
export { applyDrillResult, drillResultEvent } from "./drill/session.js";

// Taxonomy (closed catalog + pending proposals) ---------------------------------------
export {
  CATALOG_VERSION,
  categoryOf,
  getPattern,
  isValidPattern,
  listPatternIds,
  TAXONOMY_CATEGORIES,
  TAXONOMY_SUBCATEGORIES,
} from "./taxonomy/catalog.js";
export type { TaxonomyCategory, TaxonomyPattern } from "./taxonomy/catalog.js";

export { createPendingStore, normalizePatternKey, PENDING_FILE } from "./taxonomy/pending.js";
export type {
  CanonicalPatternInput,
  PendingProposal,
  PendingProposalInput,
  PendingStore,
  RegistryCandidate,
} from "./taxonomy/pending.js";
export { InvalidProposalError, PendingStoreError, UnknownPendingProposalError } from "./taxonomy/pending.js";

// Analysis boundary (zod schemas + rejection codes) -----------------------------------
export { AnalysisReasonCodes, truncateRejectionSummary } from "./analysis/schema.js";
export type { AnalysisReasonCode, AnalysisRejection, Severity } from "./analysis/schema.js";

// Legacy import (deterministic migration of pre-engine JSONL logs) ---------------------
// Host adapters call `importLegacyLogs` once at bootstrap to seed the event
// store from the four legacy files; see src/legacy/import.ts for the mapping
// table and ordering guarantees.
export { importLegacyLogs, VOCAB_REVIEW_DRILL_ID } from "./legacy/import.js";
export type {
  LegacyImportInput,
  LegacyImportResult,
  LegacyMappingReport,
  LegacySourceReport,
  LegacyUnmappedSource,
} from "./legacy/import.js";
