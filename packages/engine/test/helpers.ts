import type {
  LanguageEvent,
  MistakeCorrectedEvent,
  MistakeDetectedEvent,
  ReviewCompletedEvent,
  VocabularyDetectedEvent,
  VocabularyUsedEvent,
} from "../src/events/types.js";

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

export function isLanguageEvent(event: LanguageEvent): boolean {
  return typeof event.type === "string" && typeof event.timestamp === "string";
}
