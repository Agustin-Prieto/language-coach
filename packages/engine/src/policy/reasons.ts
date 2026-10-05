/**
 * Templated, deterministic reason strings for corrections and drills
 * (docs/odd/learner-model-v2.md, "Key mechanisms" §2 and §3).
 *
 * Reasons are ALWAYS rendered here from numeric data in code — never composed
 * as prose by the LLM or by callers. Every template is a fixed string with
 * numeric substitution; pluralization is explicit (1 mistake / N mistakes).
 * No date math happens in this module: callers derive counts/days from the
 * injected `now` and pass plain numbers.
 *
 * `masteryPct` inputs are integer percents produced by `toMasteryPercent`
 * (Math.round on the mastery ratio). This module never rounds on its own so
 * every rendered string is byte-for-byte reproducible.
 */

/** Integer percent for a mastery ratio in [0, 1]. The only sanctioned rounding step. */
export function toMasteryPercent(mastery: number): number {
  return Math.round(mastery * 100);
}

/** Explicit pluralization: 1 → singular, anything else → plural. */
function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** Template data for correction decisions (policy/correction.ts). */
export type CorrectionReasonData =
  | { template: "actively-teaching"; masteryPct: number }
  | { template: "hint"; masteryPct: number }
  | { template: "monitoring"; masteryPct: number }
  | { template: "regressed"; masteryPct: number }
  | { template: "unknown-pattern" };

/** Render a deterministic correction reason from numeric template data. */
export function renderCorrectionReason(data: CorrectionReasonData): string {
  switch (data.template) {
    case "actively-teaching":
      return `Mastery ${data.masteryPct}% — actively teaching this pattern.`;
    case "hint":
      return `Mastery ${data.masteryPct}% — quick hint.`;
    case "monitoring":
      return `Mastery ${data.masteryPct}% — monitoring only.`;
    case "regressed":
      return `Mastery ${data.masteryPct}% — regressed; challenging with a targeted drill.`;
    case "unknown-pattern":
      return "Unrecognized pattern — offering a conservative hint.";
  }
}

/** Template data for drill/review item reasons (M4 consumes these too). */
export type DrillReasonData =
  | { template: "recent-mistakes"; count: number; days: number }
  | { template: "due-review"; overdueDays: number }
  | { template: "lowest-mastery"; masteryPct: number }
  | { template: "vocab-due"; overdueDays: number };

/**
 * Render a deterministic drill reason. `count`/`days`/`overdueDays` are
 * non-negative integers derived by callers from the injected `now`;
 * `overdueDays === 0` means "due right now" rather than "overdue".
 */
export function renderDrillReason(data: DrillReasonData): string {
  switch (data.template) {
    case "recent-mistakes":
      return (
        `You made ${data.count} ${plural(data.count, "mistake", "mistakes")} related to this ` +
        `in the last ${data.days} ${plural(data.days, "day", "days")}.`
      );
    case "due-review":
      return data.overdueDays === 0
        ? "Due for review now."
        : `Due for review ${data.overdueDays} ${plural(data.overdueDays, "day", "days")} ago.`;
    case "lowest-mastery":
      return `Mastery ${data.masteryPct}% — one of your weakest patterns.`;
    case "vocab-due":
      return data.overdueDays === 0
        ? "Vocabulary recall due now."
        : `Vocabulary recall due ${data.overdueDays} ${plural(data.overdueDays, "day", "days")} ago.`;
  }
}
