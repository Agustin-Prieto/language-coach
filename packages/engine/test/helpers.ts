import type {
  LanguageEvent,
  MistakeCorrectedEvent,
  MistakeDetectedEvent,
  ReviewCompletedEvent,
  VocabularyDetectedEvent,
  VocabularyUsedEvent,
} from "../src/events/types.js";
import { createEmptyModel } from "../src/engine/fold.js";
import type {
  LearningFocus,
  MistakeProfile,
  VocabularyProfile,
} from "../src/learner/types.js";

/** Fixed reference instant so every test is deterministic. */
export const T0 = "2025-01-15T10:00:00.000Z";
export const NOW = new Date(T0);

export function at(offsetMinutes: number): string {
  return new Date(NOW.getTime() + offsetMinutes * 60_000).toISOString();
}

export function detected(
  patternId: string,
  category = "articles",
  ts: string = T0,
  severity?: "low" | "medium" | "high",
): MistakeDetectedEvent {
  return {
    schemaVersion: 1,
    type: "mistake_detected",
    timestamp: ts,
    patternId,
    category,
    ...(severity !== undefined ? { severity } : {}),
    original: "a apple",
    correction: "an apple",
  };
}

export function corrected(patternId: string, category = "articles", ts: string = T0): MistakeCorrectedEvent {
  return { schemaVersion: 1, type: "mistake_corrected", timestamp: ts, patternId, category };
}

export function reviewed(patternId: string, successful: boolean, ts: string = T0): ReviewCompletedEvent {
  return { schemaVersion: 1, type: "review_completed", timestamp: ts, patternId, successful };
}

export function vocabDetected(lemma: string, ts: string = T0): VocabularyDetectedEvent {
  return { schemaVersion: 1, type: "vocabulary_detected", timestamp: ts, lemma };
}

export function vocabUsed(lemma: string, correct: boolean, ts: string = T0): VocabularyUsedEvent {
  return { schemaVersion: 1, type: "vocabulary_used", timestamp: ts, lemma, correct };
}

/** Repeated event builder for compact test loops. */
export function times<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

// ---------------------------------------------------------------------------
// Hand-built model helpers for policy/selection tests. These construct
// LearnerModel literals directly (allowed: the model is plain data) so tests
// can pin exact mastery/status/SRS values without folding long event lists.
// ---------------------------------------------------------------------------

/** One mistake profile with sane defaults; override any field. */
export function mistake(overrides: Partial<MistakeProfile> & { patternId: string }): MistakeProfile {
  return {
    category: "grammar",
    occurrences: 1,
    correct: 0,
    incorrect: 1,
    mastery: 0.3,
    status: "learning",
    srs: { nextReviewAt: null, reviewCount: 0, successfulReviews: 0, failedReviews: 0 },
    firstSeenAt: T0,
    lastSeenAt: T0,
    ...overrides,
  };
}

/** One vocabulary profile with sane defaults; override any field. */
export function vocab(overrides: Partial<VocabularyProfile> & { lemma: string }): VocabularyProfile {
  return {
    usageCount: 1,
    correctUses: 1,
    status: "learning",
    srs: { nextReviewAt: null, reviewCount: 0, successfulReviews: 0, failedReviews: 0 },
    firstSeenAt: T0,
    lastSeenAt: T0,
    ...overrides,
  };
}

/** An empty model populated with the given mistakes/vocabulary/focus. */
export function modelWith(
  parts: { mistakes?: MistakeProfile[]; vocabulary?: VocabularyProfile[]; currentFocus?: LearningFocus } = {},
): ReturnType<typeof createEmptyModel> {
  const model = createEmptyModel({ languagePair: { native: "Spanish", target: "English" } });
  for (const m of parts.mistakes ?? []) model.mistakes[m.patternId] = m;
  for (const v of parts.vocabulary ?? []) model.vocabulary[v.lemma] = v;
  if (parts.currentFocus) model.currentFocus = parts.currentFocus;
  return model;
}

export function isLanguageEvent(event: LanguageEvent): boolean {
  return typeof event.type === "string" && typeof event.timestamp === "string";
}
