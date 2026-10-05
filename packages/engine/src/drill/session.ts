/**
 * Drill result application (M4). Two thin pure helpers so the adapter can
 * never build a malformed event or re-derive a mastery update by hand:
 *
 * - `drillResultEvent(item, successful, timestamp)` → the exact
 *   `drill_completed` event the factory expects (validated at the boundary
 *   by `makeDrillCompleted`); the adapter appends it through its event
 *   store and the model updates via the existing fold.
 * - `applyDrillResult(model, item, successful, now?)` → the model AFTER one
 *   drill result, computed by dispatching that same event through the
 *   existing `reduceEvent` reducer. It emits nothing and persists nothing:
 *   the engine never writes files; storage stays the adapter's concern.
 *
 * Deterministic drill ids (the reducer ignores them; they exist so the
 * event log can distinguish drill surfaces):
 * - mistake cloze items → "cloze"
 * - vocabulary recall items → "recall"
 * (The legacy importer already uses "vocab-review" for imported reviews.)
 */

import { reduceEvent } from "../engine/fold.js";
import { makeDrillCompleted } from "../events/factories.js";
import type { DrillCompletedEvent } from "../events/types.js";
import type { LearnerModel } from "../learner/types.js";
import type { DrillItem } from "./select.js";

/** Deterministic drillId per drill kind (see module doc). */
function drillIdFor(kind: DrillItem["kind"]): string {
  return kind === "mistake" ? "cloze" : "recall";
}

/**
 * Build the `drill_completed` event for one answered drill item. Throws
 * typed factory errors on structurally invalid input, so an invalid event
 * can never reach the append-only store.
 */
export function drillResultEvent(item: DrillItem, successful: boolean, timestamp: string): DrillCompletedEvent {
  return makeDrillCompleted({
    drillId: drillIdFor(item.kind),
    kind: item.kind,
    itemId: item.id,
    successful,
    timestamp,
  });
}

/**
 * Apply one drill result to the model via the existing reducer (the same
 * path a folded event log takes). Pure: no emission, no persistence, no
 * clock — `now` is injected and defaults to the epoch reference instant
 * used throughout the engine.
 */
export function applyDrillResult(model: LearnerModel, item: DrillItem, successful: boolean, now?: Date): LearnerModel {
  const at = now ?? new Date(0);
  return reduceEvent(model, drillResultEvent(item, successful, at.toISOString()), at);
}
