/**
 * Versioned rebuild: events (the source of truth) in, Learner Model out.
 *
 * `rebuildEvents` sorts events deterministically by timestamp (stable for
 * identical timestamps) and folds them with the existing pure reducers —
 * no duplicated fold logic. `rebuildSnapshot` reads the append-only event
 * log through the existing store, rebuilds the model, and writes the
 * `learner.json` snapshot, returning a summary for the caller (e.g. a
 * `coach rebuild` command).
 */

import { fold } from "../engine/fold.js";
import { sortByTimestamp } from "../events/sort.js";
import type { LanguageEvent } from "../events/types.js";
import type { LearnerModel, ModelSeed } from "./types.js";
import { createEventStore, writeSnapshot } from "./store.js";

/**
 * Rebuild a Learner Model from events: deterministic timestamp sort + fold.
 * `now` (when provided) is the reference instant for scheduling, exactly as
 * in `fold`; `seed` configures the language pair of the initial empty model.
 */
export function rebuildEvents(events: LanguageEvent[], seed: ModelSeed, now?: Date): LearnerModel {
  return fold(sortByTimestamp(events), now, seed);
}

export interface RebuildSummary {
  /** Number of valid events that were folded. */
  eventCount: number;
  /** Malformed event lines skipped by the store while reading. */
  skippedLines: number;
  model: LearnerModel;
}

/**
 * Read events from the injected directory via the existing store, rebuild
 * the model, and write the snapshot. Pure with respect to the model: the
 * result depends only on the event log, the seed, and `now`.
 */
export async function rebuildSnapshot(dir: string, seed: ModelSeed, now?: Date): Promise<RebuildSummary> {
  const store = createEventStore(dir);
  const { events, skippedMalformedLines } = await store.readEvents();
  const model = rebuildEvents(events, seed, now);
  await writeSnapshot(dir, model);
  return { eventCount: events.length, skippedLines: skippedMalformedLines, model };
}
