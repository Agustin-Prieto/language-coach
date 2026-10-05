/**
 * Deterministic interview focus selection (docs/odd/learner-model-v2.md, M5:
 * "Interview + web integration"). Selection is pure data work: the weak
 * patterns an interviewer should probe, the strong areas to leverage (the
 * interviewer uses vocabulary the learner already owns), and the vocabulary
 * items the learner should try to use naturally. The LLM is never involved —
 * the adapter renders the returned data verbatim.
 *
 * Purity: no filesystem, no store, no clock. Same model + same caps →
 * deep-equal focus, every time. `now` is reserved for future due-based
 * activation filtering; passing it never changes output.
 *
 * Ordering and ties (total orders, so output is input-order independent):
 * - weak areas: mastery ascending, ties by patternId ascending;
 * - strong areas: mastery descending, ties by patternId ascending; patterns
 *   already selected as weak areas are never repeated as strong;
 * - vocabulary: correctUses descending (closest to activation first), ties
 *   by lemma ascending.
 *
 * Filters:
 * - weak: registry-valid (`isValidPattern`) and status !== "mastered"
 *   (new/learning/review/regressed all qualify — they are not yet owned);
 * - strong: registry-valid with status "mastered" or "learning", per the M5
 *   design ("highest-mastery mastered/learning patterns"); "review" patterns
 *   are still walking the review ladder and are deliberately not offered as
 *   strengths;
 * - vocabulary: status "learning" only. Recognition scheduling stays a drill
 *   concern (M4); the interview simply lists these as usage goals, so no
 *   due-date filter is applied and no vocabulary cap is defined.
 *
 * Reasons are always templated in `policy/reasons.ts` from numeric data —
 * never invented prose. Empty model → empty focus (the interview then runs
 * topic-first, exactly as before the Learner Model existed).
 */

import type { LearnerModel, MistakeProfile, VocabularyProfile } from "../learner/types.js";
import { renderDrillReason, renderInterviewReason, toMasteryPercent } from "../policy/reasons.js";
import { isValidPattern } from "../taxonomy/catalog.js";

/** Interview caps as data — the only place these numbers live. */
export const INTERVIEW_CAPS = {
  /** Maximum weak patterns the brief asks the interviewer to probe. */
  maxWeakPatterns: 4,
  /** Maximum strong areas the brief offers for leverage. */
  maxStrongAreas: 3,
  /** Maximum rendered characters per reason string. */
  maxReasonChars: 240,
} as const;

export interface InterviewCaps {
  maxWeakPatterns: number;
  maxStrongAreas: number;
  maxReasonChars: number;
}

/** One interview focus area: a registry pattern plus its templated reason. */
export interface InterviewFocusArea {
  patternId: string;
  reason: string;
}

/** The interview's deterministic focus. Empty model → all sections empty. */
export interface InterviewFocus {
  /** Lowest-mastery non-mastered registry-valid patterns, weakest first. */
  weakAreas: InterviewFocusArea[];
  /** Highest-mastery mastered/learning patterns, strongest first. */
  strongAreas: InterviewFocusArea[];
  /** Learning-status lemmas to try to use naturally, activation-ready first. */
  vocabulary: string[];
}

/**
 * Select the interview focus from the Learner Model. Pure and stable:
 * repeated calls with the same model and caps return deep-equal results.
 */
export function selectInterviewFocus(model: LearnerModel, caps: InterviewCaps = INTERVIEW_CAPS, _now?: Date): InterviewFocus {
  const profiles: MistakeProfile[] = Object.values(model.mistakes).filter((profile) =>
    isValidPattern(profile.patternId),
  );

  const weak = profiles
    .filter((profile) => profile.status !== "mastered")
    .sort(byMasteryAscending)
    .slice(0, caps.maxWeakPatterns);
  const weakIds = new Set(weak.map((profile) => profile.patternId));

  const strong = profiles
    .filter((profile) => (profile.status === "mastered" || profile.status === "learning") && !weakIds.has(profile.patternId))
    .sort(byMasteryDescending)
    .slice(0, caps.maxStrongAreas);

  const vocabulary: VocabularyProfile[] = Object.values(model.vocabulary).filter(
    (item) => item.status === "learning",
  );
  vocabulary.sort(byActivationReadiness);

  return {
    weakAreas: weak.map((profile) => ({
      patternId: profile.patternId,
      reason: truncate(
        renderDrillReason({ template: "lowest-mastery", masteryPct: toMasteryPercent(profile.mastery) }),
        caps.maxReasonChars,
      ),
    })),
    strongAreas: strong.map((profile) => ({
      patternId: profile.patternId,
      reason: truncate(
        renderInterviewReason({ template: "strong-area", masteryPct: toMasteryPercent(profile.mastery) }),
        caps.maxReasonChars,
      ),
    })),
    vocabulary: vocabulary.map((item) => item.lemma),
  };
}

/** Hard cap on rendered reason length (caps are data, applied uniformly). */
function truncate(reason: string, maxReasonChars: number): string {
  return reason.length <= maxReasonChars ? reason : reason.slice(0, maxReasonChars);
}

/** Mastery ascending, ties by patternId ascending. */
function byMasteryAscending(a: MistakeProfile, b: MistakeProfile): number {
  if (a.mastery !== b.mastery) return a.mastery - b.mastery;
  return compareStrings(a.patternId, b.patternId);
}

/** Mastery descending, ties by patternId ascending. */
function byMasteryDescending(a: MistakeProfile, b: MistakeProfile): number {
  if (a.mastery !== b.mastery) return b.mastery - a.mastery;
  return compareStrings(a.patternId, b.patternId);
}

/** Closest to activation first (active at 3 correct uses), ties by lemma. */
function byActivationReadiness(a: VocabularyProfile, b: VocabularyProfile): number {
  if (a.correctUses !== b.correctUses) return b.correctUses - a.correctUses;
  return compareStrings(a.lemma, b.lemma);
}

/** Byte-order string comparison — locale-independent and deterministic. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
