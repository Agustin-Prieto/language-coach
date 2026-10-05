/**
 * Learner Model v2 data types.
 *
 * The model is derived state: it is always rebuildable from the append-only
 * event log via `fold()`. `learner.json` is a cache of this projection, never
 * a source of truth. See docs/odd/learner-model-v2.md ("Data flow").
 */

export type MistakeStatus = "new" | "learning" | "review" | "mastered" | "regressed";
export type VocabularyStatus = "new" | "learning" | "active" | "mastered";

/** Shared spaced-repetition bookkeeping. Timestamps are ISO 8601 strings. */
export interface MasteryState {
  /** When the item is next due for review; null while never scheduled. */
  nextReviewAt: string | null;
  reviewCount: number;
  successfulReviews: number;
  failedReviews: number;
}

/**
 * Per-pattern mistake tracking, keyed by taxonomy `patternId`.
 * `occurrences === correct + incorrect`: both detections and self-corrections
 * count as occurrences of the pattern.
 */
export interface MistakeProfile {
  patternId: string;
  category: string;
  occurrences: number;
  correct: number;
  incorrect: number;
  /** Mastery estimate in [0, 1]; exponentially weighted (see engine/fold.ts). */
  mastery: number;
  status: MistakeStatus;
  srs: MasteryState;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Per-lemma vocabulary tracking. `usage` is deterministic (lemma/exact match
 * in authored sentences); `recognition` moves only through drills (M4+), so
 * `srs` stays zero until drill-driven scheduling lands.
 */
export interface VocabularyProfile {
  lemma: string;
  usageCount: number;
  correctUses: number;
  status: VocabularyStatus;
  srs: MasteryState;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** A named skill with a bounded score in [0, 1]. Populated from M1 onward. */
export interface SkillProfile {
  name: string;
  score: number;
  updatedAt: string | null;
}

export interface LearningGoal {
  id: string;
  description: string;
  createdAt: string;
}

export interface LearningPreferences {
  /** How aggressively the coach interrupts for corrections. */
  correctionStyle: "immediate" | "hint" | "passive";
  /** Preferred daily drill item cap, when the learner set one. */
  dailyDrillCap?: number;
}

export interface LearningFocus {
  /** The pattern currently driving corrections and drills. */
  patternId: string;
  reason: string;
  since: string;
}

export interface LearnerModel {
  version: 2;
  languagePair: { native: string; target: string };
  /** Coarse level label (e.g. CEFR). "unknown" until evidence arrives. */
  level: string;
  skills: Record<string, SkillProfile>;
  mistakes: Record<string, MistakeProfile>;
  vocabulary: Record<string, VocabularyProfile>;
  goals: LearningGoal[];
  preferences: LearningPreferences;
  currentFocus: LearningFocus | null;
  /** ISO timestamp of the last applied event; null for an empty model. */
  updatedAt: string | null;
}

/** Seed used to create an empty model; the language pair is caller-configured. */
export interface ModelSeed {
  languagePair: { native: string; target: string };
}
