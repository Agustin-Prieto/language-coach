/**
 * Deterministic drill answer checking (M4: mistake drills are graded by
 * code — NO LLM anywhere in the drill path). Only the catalog answer for
 * the item's exercise is accepted, after documented normalization.
 *
 * ANSWER NORMALIZATION (`normalizeAnswer`, exported for tests and reuse):
 *
 * 1. trim leading/trailing whitespace;
 * 2. casefold (lowercase) — "Let's" and "let's" are the same answer;
 * 3. collapse internal whitespace runs to a single space;
 * 4. strip trailing punctuation (any run of `. , ! ? ; : …` at the end) —
 *    "went." and "went" are the same answer.
 *
 * Apostrophes, hyphens, and internal punctuation are significant and kept:
 * "let's" must not equal "lets", and "web apps" keeps its internal space.
 * Both the learner's answer and the expected answer go through the exact
 * same normalization, so the comparison is symmetric.
 */

import type { DrillItem } from "./select.js";

/** The result of grading one drill answer. `expected` is the normalized catalog answer. */
export interface CheckResult {
  correct: boolean;
  expected: string;
}

/** Trailing punctuation stripped by normalization. */
const TRAILING_PUNCTUATION = /[.,!?;:…]+$/;

/**
 * Normalize a drill answer: trim, casefold, collapse whitespace, strip
 * trailing punctuation. Pure and deterministic.
 */
export function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, " ").replace(TRAILING_PUNCTUATION, "").trim();
}

/**
 * Grade one answer against the item's catalog exercise. Throws for items
 * that carry no exercise (vocabulary flashcards are self-graded by the
 * adapter, never code-checked).
 */
export function checkAnswer(item: DrillItem, answer: string): CheckResult {
  if (item.kind !== "mistake" || !item.exercise) {
    throw new TypeError(`checkAnswer requires a mistake drill item with a catalog exercise (got kind "${item.kind}")`);
  }
  const expected = normalizeAnswer(item.exercise.answer);
  return { correct: normalizeAnswer(answer) === expected, expected };
}
