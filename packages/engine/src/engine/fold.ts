/**
 * Deterministic fold: events in, LearnerModel out.
 *
 * Mastery choice — exponentially weighted moving average (EWMA). Each observed
 * outcome (1 = success, 0 = failure) pulls the estimate toward itself:
 *
 *   mastery' = mastery + ALPHA * (outcome - mastery),  ALPHA = 0.3
 *
 * Rationale: bounded in [0, 1], needs no decay schedule or timestamp decay,
 * and a single wrong answer cannot wipe out a long correct streak. A plain
 * success ratio was rejected because it never recovers from early failures
 * as evidence accumulates. The rate is a named constant so tests can compute
 * exact expected values.
 *
 * Determinism: identical event lists + identical `now` produce identical
 * models. Reducers never read clocks, env vars, or the filesystem.
 */

import type {
  AnalysisRejectedEvent,
  DrillCompletedEvent,
  InterviewCompletedEvent,
  LanguageEvent,
  MessageAnalyzedEvent,
  MistakeCorrectedEvent,
  MistakeDetectedEvent,
  ReviewCompletedEvent,
  VocabularyDetectedEvent,
  VocabularyUsedEvent,
} from "../events/types.js";
import type {
  LearnerModel,
  MasteryState,
  MistakeProfile,
  MistakeStatus,
  ModelSeed,
  VocabularyProfile,
  VocabularyStatus,
} from "../learner/types.js";

/** EWMA learning rate for mastery updates. */
const MASTERY_ALPHA = 0.3;

/** Mistake status thresholds: mastery >= 0.4 → review, >= 0.8 → mastered. */
const MASTERY_REVIEW = 0.4;
const MASTERY_MASTERED = 0.8;
/** Successful reviews required on top of mastery before "mastered". */
const MASTERED_MIN_SUCCESSES = 3;

/** SRS intervals in days after each successful review (clamped at the end). */
const SRS_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;
/** Interval after a failed review: come back tomorrow. */
const SRS_FAIL_INTERVAL_DAYS = 1;

/** Vocabulary thresholds: 1 correct use → learning, 3 → active, 10 @ 80% → mastered. */
const VOCAB_ACTIVE_USES = 3;
const VOCAB_MASTERED_USES = 10;
const VOCAB_MASTERED_RATIO = 0.8;

/** Default seed when the caller does not configure a language pair. */
const DEFAULT_SEED: ModelSeed = { languagePair: { native: "unknown", target: "unknown" } };

/**
 * Create an empty model. The language pair comes from the seed so adapters
 * (Pi extension, web) configure it; nothing is hardcoded.
 */
export function createEmptyModel(seed: ModelSeed = DEFAULT_SEED): LearnerModel {
  return {
    version: 2,
    languagePair: { native: seed.languagePair.native, target: seed.languagePair.target },
    level: "unknown",
    skills: {},
    mistakes: {},
    vocabulary: {},
    goals: [],
    preferences: { correctionStyle: "hint" },
    currentFocus: null,
    updatedAt: null,
  };
}

/**
 * Fold a list of events into a Learner Model.
 *
 * `now` (when provided) is the reference instant for scheduling (SRS
 * `nextReviewAt`) and for `updatedAt`; otherwise each event's own timestamp is
 * used. `seed` configures the language pair of the initial empty model.
 * Pure: same events + same now = same model.
 */
export function fold(events: LanguageEvent[], now?: Date, seed?: ModelSeed): LearnerModel {
  let model = createEmptyModel(seed);
  for (const event of events) {
    const at = now ?? new Date(event.timestamp);
    model = reduceEvent(model, event, at);
  }
  return model;
}

/** Dispatch one event to its reducer. Exported for direct testing. */
export function reduceEvent(model: LearnerModel, event: LanguageEvent, at: Date): LearnerModel {
  switch (event.type) {
    case "message_analyzed":
      return reduceMessageAnalyzed(model, event, at);
    case "mistake_detected":
      return reduceMistakeDetected(model, event, at);
    case "mistake_corrected":
      return reduceMistakeCorrected(model, event, at);
    case "vocabulary_detected":
      return reduceVocabularyDetected(model, event, at);
    case "vocabulary_used":
      return reduceVocabularyUsed(model, event, at);
    case "review_completed":
      return reduceReviewCompleted(model, event, at);
    case "drill_completed":
      return reduceDrillCompleted(model, event, at);
    case "interview_completed":
      return reduceInterviewCompleted(model, event, at);
    case "analysis_rejected":
      return reduceAnalysisRejected(model, event, at);
  }
}

// ---------------------------------------------------------------------------
// Reducers. Each one clones the model, applies its change, and stamps
// `updatedAt`. They never mutate their input and never touch the outside world.
// ---------------------------------------------------------------------------

/**
 * Marks that a message passed the deterministic gate. No per-skill scoring
 * exists yet (M1+); it only advances `updatedAt`.
 */
export function reduceMessageAnalyzed(model: LearnerModel, _event: MessageAnalyzedEvent, at: Date): LearnerModel {
  return touch(cloneModel(model), at);
}

/** The learner made the mistake again: mastery down, occurrence counters up. */
export function reduceMistakeDetected(model: LearnerModel, event: MistakeDetectedEvent, at: Date): LearnerModel {
  const next = cloneModel(model);
  const profile = { ...ensureMistake(next, event.patternId, event.category, at) };
  const mastery = applyMastery(profile.mastery, 0);
  // Explicit transition: a mastered pattern that slips again regresses.
  const status: MistakeStatus =
    profile.status === "mastered"
      ? "regressed"
      : deriveMistakeStatus(profile.status, mastery, profile.srs.successfulReviews);
  next.mistakes[event.patternId] = {
    ...profile,
    category: profile.category || event.category,
    occurrences: profile.occurrences + 1,
    incorrect: profile.incorrect + 1,
    mastery,
    status,
    lastSeenAt: at.toISOString(),
  };
  return touch(next, at);
}

/** The learner produced the correct form: mastery up, occurrence counters up. */
export function reduceMistakeCorrected(model: LearnerModel, event: MistakeCorrectedEvent, at: Date): LearnerModel {
  const next = cloneModel(model);
  const profile = { ...ensureMistake(next, event.patternId, event.category, at) };
  const mastery = applyMastery(profile.mastery, 1);
  next.mistakes[event.patternId] = {
    ...profile,
    category: profile.category || event.category,
    occurrences: profile.occurrences + 1,
    correct: profile.correct + 1,
    mastery,
    status: deriveMistakeStatus(profile.status, mastery, profile.srs.successfulReviews),
    lastSeenAt: at.toISOString(),
  };
  return touch(next, at);
}

/** A new vocabulary item was encountered: creates the profile, nothing else. */
export function reduceVocabularyDetected(model: LearnerModel, event: VocabularyDetectedEvent, at: Date): LearnerModel {
  const next = cloneModel(model);
  const existing = next.vocabulary[event.lemma];
  next.vocabulary[event.lemma] = existing
    ? { ...existing, lastSeenAt: at.toISOString() }
    : createVocabularyProfile(event.lemma, at);
  return touch(next, at);
}

/** Deterministic usage evidence: usage counters up, status re-derived. */
export function reduceVocabularyUsed(model: LearnerModel, event: VocabularyUsedEvent, at: Date): LearnerModel {
  const next = cloneModel(model);
  const existing = next.vocabulary[event.lemma] ?? createVocabularyProfile(event.lemma, at);
  const usageCount = existing.usageCount + 1;
  const correctUses = existing.correctUses + (event.correct ? 1 : 0);
  next.vocabulary[event.lemma] = {
    ...existing,
    usageCount,
    correctUses,
    status: deriveVocabularyStatus(correctUses, usageCount),
    lastSeenAt: at.toISOString(),
  };
  return touch(next, at);
}

/** A scheduled review was completed: mastery up/down and SRS rescheduling. */
export function reduceReviewCompleted(model: LearnerModel, event: ReviewCompletedEvent, at: Date): LearnerModel {
  const next = cloneModel(model);
  const profile = { ...ensureMistake(next, event.patternId, "", at) };
  const mastery = applyMastery(profile.mastery, event.successful ? 1 : 0);
  const srs = schedule(profile.srs, at, event.successful);
  next.mistakes[event.patternId] = {
    ...profile,
    mastery,
    srs,
    status: deriveMistakeStatus(profile.status, mastery, srs.successfulReviews),
    lastSeenAt: at.toISOString(),
  };
  return touch(next, at);
}

/**
 * A drill item was completed. Mistake drills update the mistake profile and
 * its SRS state; vocabulary drills count as (possibly incorrect) usage —
 * drill-driven recognition scheduling arrives in M4.
 */
export function reduceDrillCompleted(model: LearnerModel, event: DrillCompletedEvent, at: Date): LearnerModel {
  if (event.kind === "mistake") {
    const next = cloneModel(model);
    const profile = { ...ensureMistake(next, event.itemId, "", at) };
    const mastery = applyMastery(profile.mastery, event.successful ? 1 : 0);
    const srs = schedule(profile.srs, at, event.successful);
    next.mistakes[event.itemId] = {
      ...profile,
      mastery,
      srs,
      status: deriveMistakeStatus(profile.status, mastery, srs.successfulReviews),
      lastSeenAt: at.toISOString(),
    };
    return touch(next, at);
  }
  const syntheticUse: VocabularyUsedEvent = {
    schemaVersion: 1,
    type: "vocabulary_used",
    timestamp: event.timestamp,
    lemma: event.itemId,
    correct: event.successful,
  };
  return reduceVocabularyUsed(model, syntheticUse, at);
}

/**
 * An interview session completed. Interview-driven focus and skill scoring
 * arrive in M5; it only advances `updatedAt` for now.
 */
export function reduceInterviewCompleted(model: LearnerModel, _event: InterviewCompletedEvent, at: Date): LearnerModel {
  return touch(cloneModel(model), at);
}

/**
 * Closed-vocabulary rule: rejected analyses are audit events only. They never
 * mutate the model — not even `updatedAt`.
 */
export function reduceAnalysisRejected(model: LearnerModel, _event: AnalysisRejectedEvent, _at: Date): LearnerModel {
  return model;
}

// ---------------------------------------------------------------------------
// Internal helpers (pure).
// ---------------------------------------------------------------------------

/** Shallow clone with fresh maps/arrays so reducers never mutate their input. */
function cloneModel(model: LearnerModel): LearnerModel {
  return {
    ...model,
    languagePair: { ...model.languagePair },
    skills: { ...model.skills },
    mistakes: { ...model.mistakes },
    vocabulary: { ...model.vocabulary },
    goals: [...model.goals],
  };
}

function touch(model: LearnerModel, at: Date): LearnerModel {
  return { ...model, updatedAt: at.toISOString() };
}

function emptyMastery(): MasteryState {
  return { nextReviewAt: null, reviewCount: 0, successfulReviews: 0, failedReviews: 0 };
}

function createVocabularyProfile(lemma: string, at: Date): VocabularyProfile {
  return {
    lemma,
    usageCount: 0,
    correctUses: 0,
    status: "new",
    srs: emptyMastery(),
    firstSeenAt: at.toISOString(),
    lastSeenAt: at.toISOString(),
  };
}

/** Get-or-create a mistake profile inside an already-cloned model. */
function ensureMistake(model: LearnerModel, patternId: string, category: string, at: Date): MistakeProfile {
  const existing = model.mistakes[patternId];
  if (existing) return existing;
  const created: MistakeProfile = {
    patternId,
    category,
    occurrences: 0,
    correct: 0,
    incorrect: 0,
    mastery: 0,
    status: "new",
    srs: emptyMastery(),
    firstSeenAt: at.toISOString(),
    lastSeenAt: at.toISOString(),
  };
  model.mistakes[patternId] = created;
  return created;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function applyMastery(current: number, outcome: 0 | 1): number {
  return clamp01(current + MASTERY_ALPHA * (outcome - current));
}

/**
 * Explicit mistake status table:
 * new → learning (first evidence) → review (mastery >= 0.4)
 *   → mastered (mastery >= 0.8 with >= 3 successful reviews)
 * mastered → regressed happens only via a later mistake_detected.
 */
function deriveMistakeStatus(previous: MistakeStatus, mastery: number, successfulReviews: number): MistakeStatus {
  if (previous === "new") return "learning";
  if (mastery >= MASTERY_MASTERED && successfulReviews >= MASTERED_MIN_SUCCESSES) return "mastered";
  if (mastery >= MASTERY_REVIEW) return "review";
  return "learning";
}

/**
 * Vocabulary status is fully derived from usage counters (monotonic):
 * 1 correct use → learning, 3 → active, 10 correct at >= 80% ratio → mastered.
 */
function deriveVocabularyStatus(correctUses: number, usageCount: number): VocabularyStatus {
  if (correctUses >= VOCAB_MASTERED_USES && correctUses / usageCount >= VOCAB_MASTERED_RATIO) return "mastered";
  if (correctUses >= VOCAB_ACTIVE_USES) return "active";
  if (correctUses >= 1) return "learning";
  return "new";
}

function schedule(mastery: MasteryState, at: Date, successful: boolean): MasteryState {
  const successfulReviews = mastery.successfulReviews + (successful ? 1 : 0);
  const failedReviews = mastery.failedReviews + (successful ? 0 : 1);
  const intervalDays = successful
    ? SRS_INTERVAL_DAYS[Math.min(successfulReviews - 1, SRS_INTERVAL_DAYS.length - 1)]
    : SRS_FAIL_INTERVAL_DAYS;
  return {
    nextReviewAt: addDays(at, intervalDays),
    reviewCount: mastery.reviewCount + 1,
    successfulReviews,
    failedReviews,
  };
}

function addDays(at: Date, days: number): string {
  return new Date(at.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
