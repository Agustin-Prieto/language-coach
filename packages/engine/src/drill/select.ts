/**
 * Deterministic drill item selection (docs/odd/learner-model-v2.md, M4:
 * "Personalized drills"). Selection is pure data work: due mistakes first,
 * then the weakest registry-valid mistakes that carry catalog drill data,
 * then due vocabulary. The LLM is never involved — mistake exercises come
 * verbatim from the taxonomy catalog and answers are checked by code
 * (`drill/check.ts`); vocabulary items are self-graded flashcards.
 *
 * Purity: no filesystem, no store, no clock. Same model + same caps + same
 * injected `now` → deep-equal item list, every time.
 *
 * Ordering and ties:
 * - due mistakes: `dueForReview` order (nextReviewAt ascending, ties by
 *   patternId ascending);
 * - topped-up mistakes: mastery ascending, ties by patternId ascending;
 * - vocabulary: nextReviewAt ascending, ties by lemma ascending;
 * - mistakes always precede vocabulary items.
 *
 * Registry validity: only mistakes whose pattern exists in the catalog AND
 * carries `drill` data are selected (closed vocabulary — a pattern without
 * an exercise, e.g. a future `fluency` entry, is skipped, never synthesized).
 */

import type { LearnerModel } from "../learner/types.js";
import { dueForReview } from "../policy/correction.js";
import { renderDrillReason, toMasteryPercent } from "../policy/reasons.js";
import { getPattern, type PatternDrill } from "../taxonomy/catalog.js";

/** Drill caps as data — the only place these numbers live. */
export const DRILL_CAPS = {
  /** Maximum mistake drill items per session. */
  maxMistakeItems: 5,
  /** Maximum vocabulary flashcard items per session. */
  maxVocabItems: 5,
  /** Maximum rendered characters per reason string. */
  maxReasonChars: 240,
} as const;

export interface DrillCaps {
  maxMistakeItems: number;
  maxVocabItems: number;
  maxReasonChars: number;
}

export type DrillKind = "mistake" | "vocabulary";

/** One selectable drill item. `id` is a patternId (mistake) or lemma (vocabulary). */
export interface DrillItem {
  kind: DrillKind;
  id: string;
  /** Templated, data-derived reason (never invented prose). */
  reason: string;
  /** Catalog exercise; present only for mistake items with drill data. */
  exercise?: PatternDrill;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Select the drill items for one session. Pure and stable: repeated calls
 * with the same model, caps, and `now` return deep-equal results.
 */
export function selectDrillItems(model: LearnerModel, caps: DrillCaps = DRILL_CAPS, now?: Date): DrillItem[] {
  const nowMs = (now ?? new Date(0)).getTime();
  const selected: DrillItem[] = [];
  const chosenIds = new Set<string>();

  // 1. Due mistakes first, in dueForReview order.
  for (const profile of dueForReview(model, new Date(nowMs))) {
    if (selected.length >= caps.maxMistakeItems) break;
    const drill = drillDataFor(profile.patternId);
    if (!drill) continue;
    chosenIds.add(profile.patternId);
    selected.push({
      kind: "mistake",
      id: profile.patternId,
      reason: truncate(renderDrillReason({ template: "due-review", overdueDays: overdueDaysOf(profile, nowMs) }), caps),
      exercise: drill,
    });
  }

  // 2. Top up with the lowest-mastery non-mastered registry-valid mistakes
  //    that carry drill data and were not already selected as due.
  if (selected.length < caps.maxMistakeItems) {
    const topUp = Object.values(model.mistakes)
      .filter(
        (profile) =>
          !chosenIds.has(profile.patternId) &&
          profile.status !== "mastered" &&
          drillDataFor(profile.patternId) !== undefined,
      )
      .sort((a, b) => {
        if (a.mastery !== b.mastery) return a.mastery - b.mastery;
        return compareStrings(a.patternId, b.patternId);
      });
    for (const profile of topUp) {
      if (selected.length >= caps.maxMistakeItems) break;
      chosenIds.add(profile.patternId);
      selected.push({
        kind: "mistake",
        id: profile.patternId,
        reason: truncate(
          renderDrillReason({ template: "lowest-mastery", masteryPct: toMasteryPercent(profile.mastery) }),
          caps,
        ),
        exercise: drillDataFor(profile.patternId)!,
      });
    }
  }

  // 3. Due vocabulary last: the existing SRS fields on VocabularyProfile
  //    (nextReviewAt at or before `now`; null or malformed is never due).
  const vocab: Array<{ lemma: string; dueMs: number }> = [];
  for (const item of Object.values(model.vocabulary)) {
    if (item.srs.nextReviewAt === null) continue;
    const dueMs = new Date(item.srs.nextReviewAt).getTime();
    if (Number.isNaN(dueMs) || dueMs > nowMs) continue;
    vocab.push({ lemma: item.lemma, dueMs });
  }
  vocab.sort((a, b) => {
    if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
    return compareStrings(a.lemma, b.lemma);
  });
  let vocabCount = 0;
  for (const entry of vocab) {
    if (vocabCount >= caps.maxVocabItems) break;
    vocabCount++;
    selected.push({
      kind: "vocabulary",
      id: entry.lemma,
      reason: truncate(renderDrillReason({ template: "vocab-due", overdueDays: Math.floor(Math.max(0, nowMs - entry.dueMs) / DAY_MS) }), caps),
    });
  }

  return selected;
}

/** Catalog drill data for a pattern id, or undefined when absent (skip, never synthesize). */
function drillDataFor(patternId: string): PatternDrill | undefined {
  return getPattern(patternId)?.drill;
}

/** Whole days overdue, floored; 0 means "due right now". */
function overdueDaysOf(profile: { srs: { nextReviewAt: string | null } }, nowMs: number): number {
  if (profile.srs.nextReviewAt === null) return 0;
  const dueMs = new Date(profile.srs.nextReviewAt).getTime();
  if (Number.isNaN(dueMs)) return 0;
  return Math.floor(Math.max(0, nowMs - dueMs) / DAY_MS);
}

/** Hard cap on rendered reason length (caps are data, applied uniformly). */
function truncate(reason: string, caps: DrillCaps): string {
  return reason.length <= caps.maxReasonChars ? reason : reason.slice(0, caps.maxReasonChars);
}

/** Byte-order string comparison — locale-independent and deterministic. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
