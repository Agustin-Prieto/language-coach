/**
 * Deterministic bounded context selection (docs/odd/learner-model-v2.md,
 * "Key mechanisms" §3: "Deterministic context budget").
 *
 * The prompt builder must never serialize the full Learner Model. This module
 * picks a bounded, stable slice: the most overdue mistakes, the currently
 * active (recent, non-mastered) pattern ids, the learner's focus, and due
 * vocabulary — all under explicit caps. The LLM only writes prose from this
 * slice; it never selects.
 *
 * Purity: no filesystem, no store, no clock. Same model + same caps + same
 * injected `now` → deep-equal context, every time.
 *
 * tokenEstimate formula (documented, deterministic):
 *
 *   tokenEstimate = ceil(serializeContext(context).length / 4)
 *
 * i.e. ~4 characters per token, a standard English-prose approximation,
 * rounded up so the estimate never under-counts. `serializeContext` is a pure
 * canonical rendering of the selected slice (newline-separated entries, no
 * trailing whitespace).
 */

import type { LearnerModel, LearningFocus, MistakeProfile, VocabularyProfile } from "../learner/types.js";
import { dueForReview } from "../policy/correction.js";
import { renderDrillReason, toMasteryPercent } from "../policy/reasons.js";
import { isValidPattern } from "../taxonomy/catalog.js";

/** Context caps as data — the only place these numbers live. */
export const DEFAULT_CONTEXT_CAPS = {
  /** Maximum due mistake entries in the context. */
  maxDueMistakes: 5,
  /** Maximum active (recent, non-mastered) pattern ids. */
  maxActivePatterns: 8,
  /** Maximum due vocabulary items. */
  maxVocabulary: 10,
  /** Maximum rendered characters per reason string. */
  maxReasonChars: 240,
} as const;

export interface ContextCaps {
  maxDueMistakes: number;
  maxActivePatterns: number;
  maxVocabulary: number;
  maxReasonChars: number;
}

/** One due (or topped-up) mistake plus its templated, capped reason. */
export interface ContextMistakeEntry {
  profile: MistakeProfile;
  reason: string;
}

/** The bounded prompt context. Every field is engine-selected, never LLM-selected. */
export interface PromptContext {
  dueMistakes: ContextMistakeEntry[];
  activePatternIds: string[];
  focus: LearningFocus | null;
  vocabulary: VocabularyProfile[];
  tokenEstimate: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Select the bounded context for a prompt. Pure and stable: repeated calls
 * with the same model, caps, and `now` return deep-equal results.
 */
export function selectContext(
  model: LearnerModel,
  caps: ContextCaps = DEFAULT_CONTEXT_CAPS,
  now?: Date,
): PromptContext {
  const nowMs = (now ?? new Date(0)).getTime();

  const dueMistakes = selectDueMistakes(model, caps, nowMs);
  const activePatternIds = selectActivePatternIds(model, caps);
  const focus = model.currentFocus ? { ...model.currentFocus } : null;
  const vocabulary = selectDueVocabulary(model, caps, nowMs);

  const context: PromptContext = { dueMistakes, activePatternIds, focus, vocabulary, tokenEstimate: 0 };
  context.tokenEstimate = Math.ceil(serializeContext(context).length / 4);
  return context;
}

/**
 * Canonical rendering of the context slice. Pure; the tokenEstimate formula
 * is defined on this string's length. Entries are newline-separated and none
 * carries trailing whitespace.
 */
export function serializeContext(context: PromptContext): string {
  const parts: string[] = [];
  for (const entry of context.dueMistakes) {
    parts.push(`mistake ${entry.profile.patternId} ${entry.profile.status} ${entry.reason}`);
  }
  if (context.activePatternIds.length > 0) {
    parts.push(`patterns ${context.activePatternIds.join(",")}`);
  }
  if (context.focus) {
    parts.push(`focus ${context.focus.patternId} ${context.focus.reason}`);
  }
  for (const item of context.vocabulary) {
    parts.push(`vocab ${item.lemma}`);
  }
  return parts.join("\n");
}

/**
 * Due mistakes: take the top-N from `dueForReview` (already sorted by
 * nextReviewAt then patternId); if fewer are due than the cap, top up with
 * the lowest-mastery not-due mistakes (ties by patternId). Each entry gets a
 * templated reason truncated to `maxReasonChars`.
 */
function selectDueMistakes(model: LearnerModel, caps: ContextCaps, nowMs: number): ContextMistakeEntry[] {
  const due = dueForReview(model, new Date(nowMs));
  const selected: ContextMistakeEntry[] = due.slice(0, caps.maxDueMistakes).map((profile) => ({
    profile,
    reason: truncate(renderDrillReason({ template: "due-review", overdueDays: overdueDays(profile, nowMs) }), caps),
  }));

  if (selected.length < caps.maxDueMistakes) {
    const dueIds = new Set(due.map((profile) => profile.patternId));
    const notDue = Object.values(model.mistakes)
      .filter((profile) => !dueIds.has(profile.patternId))
      .sort((a, b) => {
        if (a.mastery !== b.mastery) return a.mastery - b.mastery;
        return compareStrings(a.patternId, b.patternId);
      });
    for (const profile of notDue) {
      if (selected.length >= caps.maxDueMistakes) break;
      selected.push({
        profile: { ...profile, srs: { ...profile.srs } },
        reason: truncate(
          renderDrillReason({ template: "lowest-mastery", masteryPct: toMasteryPercent(profile.mastery) }),
          caps,
        ),
      });
    }
  }
  return selected;
}

/**
 * Active patterns: recent, non-mastered, registry-valid ids (closed
 * vocabulary — these feed the classifier's `activePatternIds` hint), sorted
 * by lastSeenAt descending, ties by patternId ascending, capped.
 */
function selectActivePatternIds(model: LearnerModel, caps: ContextCaps): string[] {
  return Object.values(model.mistakes)
    .filter((profile) => profile.status !== "mastered" && isValidPattern(profile.patternId))
    .sort((a, b) => {
      const aMs = lastSeenMsOf(a);
      const bMs = lastSeenMsOf(b);
      if (aMs !== bMs) return bMs - aMs;
      return compareStrings(a.patternId, b.patternId);
    })
    .slice(0, caps.maxActivePatterns)
    .map((profile) => profile.patternId);
}

/**
 * Due vocabulary: reuses the existing SRS fields on VocabularyProfile
 * (`nextReviewAt` at or before `now`; drill-driven recognition scheduling
 * arrives in M4). Sorted by nextReviewAt then lemma, capped.
 */
function selectDueVocabulary(model: LearnerModel, caps: ContextCaps, nowMs: number): VocabularyProfile[] {
  return Object.values(model.vocabulary)
    .filter((item) => {
      if (item.srs.nextReviewAt === null) return false;
      const dueMs = new Date(item.srs.nextReviewAt).getTime();
      return !Number.isNaN(dueMs) && dueMs <= nowMs;
    })
    .sort((a, b) => {
      const aMs = new Date(a.srs.nextReviewAt ?? "").getTime();
      const bMs = new Date(b.srs.nextReviewAt ?? "").getTime();
      if (aMs !== bMs) return aMs - bMs;
      return compareStrings(a.lemma, b.lemma);
    })
    .slice(0, caps.maxVocabulary)
    .map((item) => ({ ...item, srs: { ...item.srs } }));
}

/** Whole days overdue, floored; 0 means "due right now". */
function overdueDays(profile: MistakeProfile, nowMs: number): number {
  if (profile.srs.nextReviewAt === null) return 0;
  const dueMs = new Date(profile.srs.nextReviewAt).getTime();
  if (Number.isNaN(dueMs)) return 0;
  return Math.floor(Math.max(0, nowMs - dueMs) / DAY_MS);
}

/** lastSeenAt as sort key; malformed timestamps sort oldest. */
function lastSeenMsOf(profile: MistakeProfile): number {
  const ms = new Date(profile.lastSeenAt).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Hard cap on rendered reason length (caps are data, applied uniformly). */
function truncate(reason: string, caps: ContextCaps): string {
  return reason.length <= caps.maxReasonChars ? reason : reason.slice(0, caps.maxReasonChars);
}

/** Byte-order string comparison — locale-independent and deterministic. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
