/**
 * Correction policy — a pure function (docs/odd/learner-model-v2.md,
 * "Key mechanisms" §2: "Correction policy is a pure function").
 *
 * The LLM never decides policy. This module inspects the Learner Model and a
 * correction candidate, and returns the action the prompt builder will inject
 * as a directive. No filesystem, no store, no clock: the model is passed in
 * and any reference instant is an injected argument.
 *
 * THRESHOLD TABLE (tie-break order: regressed > mastery band > status)
 *
 * | Condition (evaluated in order)                                  | Action    |
 * | --------------------------------------------------------------- | --------- |
 * | patternId unknown to the model, or "uncategorized"              | hint      |
 * | status === "regressed" (any mastery)                            | challenge |
 * | mastery <  CORRECTION_THRESHOLDS.teachBelow (0.40)              | correct   |
 * | mastery <= CORRECTION_THRESHOLDS.hintAtOrBelow (0.70)           | hint      |
 * | mastery >  0.70 and status !== "mastered" (still in review)     | hint      |
 * | mastery >  0.70 and status === "mastered"                       | ignore    |
 *
 * The "> 0.70 but not yet mastered" row is a documented completion of the
 * bands so every (mastery, status) input has exactly one deterministic
 * outcome: a pattern still walking the review ladder keeps getting nudged
 * until it is mastered.
 *
 * `candidate.severity` and `candidate.lastSeenAt` are carried for later
 * milestones (window-based templates) and deliberately do not affect the M3a
 * decision; `now` is likewise reserved. Their presence never changes output.
 */

import type { LearnerModel, MistakeProfile } from "../learner/types.js";
import { renderCorrectionReason, toMasteryPercent } from "./reasons.js";

/**
 * Correction thresholds as data (never magic numbers at call sites):
 * mastery < 0.40 → actively teach; 0.40–0.70 → hint; above 0.70 the pattern
 * is only ignored once its status is "mastered".
 */
export const CORRECTION_THRESHOLDS = {
  /** Below this mastery the coach teaches the pattern actively. */
  teachBelow: 0.4,
  /** At or below this mastery the coach gives a brief hint. */
  hintAtOrBelow: 0.7,
} as const;

export type CorrectionAction = "correct" | "hint" | "challenge" | "ignore";

/**
 * The correction candidate supplied by the host adapter. Only `patternId`
 * drives the M3a decision; `severity` and `lastSeenAt` are reserved inputs
 * for window-based templates in later milestones.
 */
export interface CorrectionCandidate {
  patternId: string;
  severity?: "low" | "medium" | "high";
  lastSeenAt?: string;
}

/** The directive the prompt builder injects; `reason` is a templated string. */
export interface CorrectionDecision {
  action: CorrectionAction;
  reason: string;
}

/**
 * Decide the correction action for one candidate against the model.
 * Pure: same model + same candidate + same `now` → same decision.
 */
export function decideCorrection(
  model: LearnerModel,
  candidate: CorrectionCandidate,
  _now?: Date,
): CorrectionDecision {
  const profile: MistakeProfile | undefined = model.mistakes[candidate.patternId];

  // Uncategorized or unknown patternId: no trusted mastery signal exists, so
  // the policy is conservative — a gentle hint, never silence, never a drill.
  if (candidate.patternId === "uncategorized" || !profile) {
    return {
      action: "hint",
      reason: renderCorrectionReason({ template: "unknown-pattern" }),
    };
  }

  // Tie-break level 1: a regressed pattern overrides any mastery band.
  if (profile.status === "regressed") {
    return {
      action: "challenge",
      reason: renderCorrectionReason({ template: "regressed", masteryPct: toMasteryPercent(profile.mastery) }),
    };
  }

  // Tie-break level 2: the mastery band.
  const masteryPct = toMasteryPercent(profile.mastery);
  if (profile.mastery < CORRECTION_THRESHOLDS.teachBelow) {
    return {
      action: "correct",
      reason: renderCorrectionReason({ template: "actively-teaching", masteryPct }),
    };
  }
  if (profile.mastery <= CORRECTION_THRESHOLDS.hintAtOrBelow) {
    return { action: "hint", reason: renderCorrectionReason({ template: "hint", masteryPct }) };
  }

  // Tie-break level 3: status above the hint band — ignore only when mastered.
  if (profile.status === "mastered") {
    return { action: "ignore", reason: renderCorrectionReason({ template: "monitoring", masteryPct }) };
  }
  return { action: "hint", reason: renderCorrectionReason({ template: "hint", masteryPct }) };
}

/**
 * The due set the policy and selection layers build on: every mistake whose
 * `nextReviewAt` is at or before `now` (null `nextReviewAt` is never due),
 * sorted by `nextReviewAt` ascending, ties broken by `patternId` ascending.
 * Malformed timestamps sort last and are never due. Returns shallow copies;
 * the input model is never mutated.
 */
export function dueForReview(model: LearnerModel, now?: Date): MistakeProfile[] {
  const nowMs = (now ?? new Date(0)).getTime();
  const due = Object.values(model.mistakes).filter((profile) => {
    if (profile.srs.nextReviewAt === null) return false;
    const dueMs = new Date(profile.srs.nextReviewAt).getTime();
    return !Number.isNaN(dueMs) && dueMs <= nowMs;
  });
  return due
    .map((profile) => ({ ...profile, srs: { ...profile.srs } }))
    .sort((a, b) => {
      const aMs = dueMsOf(a, nowMs);
      const bMs = dueMsOf(b, nowMs);
      if (aMs !== bMs) return aMs - bMs;
      return a.patternId < b.patternId ? -1 : a.patternId > b.patternId ? 1 : 0;
    });
}

/** Due timestamp used for sorting; malformed timestamps sort last. */
function dueMsOf(profile: MistakeProfile, fallback: number): number {
  if (profile.srs.nextReviewAt === null) return fallback;
  const ms = new Date(profile.srs.nextReviewAt).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}
