/**
 * Versioned event model for the language-coach Learner Model.
 *
 * Events are the source of truth (append-only `events.jsonl`); the Learner
 * Model is a deterministic projection produced by `fold()`. See
 * docs/odd/learner-model-v2.md ("Data flow", "Key mechanisms").
 *
 * Every event carries `schemaVersion`, `type`, and an ISO 8601 `timestamp`.
 * Breaking payload changes bump `EventSchemaVersion` and add a migration path.
 */

/** Schema version stamped on every event. Bump on breaking payload changes. */
export const EventSchemaVersion = 1;

/** Shared fields carried by every event. */
export interface EventBase {
  schemaVersion: typeof EventSchemaVersion;
  /** ISO 8601 timestamp of when the event happened. */
  timestamp: string;
  /**
   * Optional provenance metadata (e.g. legacy-import context such as the
   * original line text or translation). Reducers ignore it; it exists so
   * importers never fabricate payload fields that the closed event schemas
   * do not define. Additive and optional: does not bump EventSchemaVersion.
   */
  metadata?: Record<string, unknown>;
}

/** A user message passed the deterministic gate and was analyzed. */
export interface MessageAnalyzedEvent extends EventBase {
  type: "message_analyzed";
  messageId: string;
  textLength: number;
}

/** The learner made a mistake matching a known taxonomy pattern. */
export interface MistakeDetectedEvent extends EventBase {
  type: "mistake_detected";
  patternId: string;
  category: string;
  /**
   * How hard this detection should pull mastery down. Additive in M2;
   * absent for pre-M2 events, which reducers treat as "medium".
   * schemaVersion stays 1 (additive optional field).
   */
  severity?: "low" | "medium" | "high";
  /** Subcategory from the taxonomy catalog. Additive in M2; optional. */
  subcategory?: string;
  /** The incorrect text produced by the learner. */
  original: string;
  /** The corrected text proposed by the coach. */
  correction: string;
}

/** The learner produced the corrected form (or an otherwise correct rendition). */
export interface MistakeCorrectedEvent extends EventBase {
  type: "mistake_corrected";
  patternId: string;
  category: string;
}

/** A new vocabulary item was encountered. Recognition is never estimated here. */
export interface VocabularyDetectedEvent extends EventBase {
  type: "vocabulary_detected";
  lemma: string;
  /** Surface form as it appeared, when it differs from the lemma. */
  surface?: string;
}

/** Deterministic lemma/exact match of a vocabulary item in authored text. */
export interface VocabularyUsedEvent extends EventBase {
  type: "vocabulary_used";
  lemma: string;
  correct: boolean;
}

/** A scheduled review for a mistake pattern was completed. */
export interface ReviewCompletedEvent extends EventBase {
  type: "review_completed";
  patternId: string;
  successful: boolean;
}

/** A drill item was completed. `itemId` is a patternId (mistake) or lemma (vocabulary). */
export interface DrillCompletedEvent extends EventBase {
  type: "drill_completed";
  drillId: string;
  kind: "mistake" | "vocabulary";
  itemId: string;
  successful: boolean;
}

/** A mock interview session was completed. */
export interface InterviewCompletedEvent extends EventBase {
  type: "interview_completed";
  topics: string[];
}

/**
 * Classifier output failed schema validation. Rejected analyses are audit
 * events only: they never mutate the model (closed-vocabulary rule).
 *
 * `reason` is one of the closed analysis reason codes (schema_mismatch,
 * unknown_pattern, missing_fields, port_error); `summary` is a truncated,
 * deterministic error summary (additive in M2, schemaVersion stays 1).
 */
export interface AnalysisRejectedEvent extends EventBase {
  type: "analysis_rejected";
  reason: string;
  /** Truncated deterministic error summary; absent for pre-M2 events. */
  summary?: string;
}

export type LanguageEvent =
  | MessageAnalyzedEvent
  | MistakeDetectedEvent
  | MistakeCorrectedEvent
  | VocabularyDetectedEvent
  | VocabularyUsedEvent
  | ReviewCompletedEvent
  | DrillCompletedEvent
  | InterviewCompletedEvent
  | AnalysisRejectedEvent;

export type LanguageEventType = LanguageEvent["type"];
