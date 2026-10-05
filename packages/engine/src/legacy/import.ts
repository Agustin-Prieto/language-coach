/**
 * Legacy log importer: turns the four legacy JSONL files (raw contents or
 * already-parsed items) into deterministic, timestamp-ordered engine events.
 *
 * Event mapping table (honest and deterministic — no taxonomy data is ever
 * fabricated, because the legacy files carry none):
 *
 * | Legacy source   | Legacy fields              | Event type           | Mapping |
 * |-----------------|----------------------------|----------------------|---------|
 * | log entries     | ts, kind, native, target,  | `message_analyzed`   | `messageId` = `legacy-log-<n>` (accepted-line ordinal), `textLength` = `line.length`; `kind`/`native`/`target`/`line` carried in `metadata` as `legacyKind`/`native`/`target`/`line`. No `mistake_detected`: legacy logs record no pattern/category classification. |
 * |                 | line                       |                      |         |
 * | vocab captures  | ts, phrase, translation,   | `vocabulary_detected`| `lemma` = `phrase`; `translation`/`source` carried in `metadata`. |
 * |                 | source                     |                      |         |
 * | vocab reviews   | ts, phrase, correct        | `drill_completed`    | `kind` = `"vocabulary"`, `itemId` = `phrase`, `successful` = `correct`, `drillId` = `"vocab-review"`. Choice rationale: among the 9 existing event types this is the closest semantic fit for a practice/recall result on a vocabulary item — `review_completed` is scoped to mistake patterns, and `vocabulary_used` means deterministic usage in authored text, which a review is not. Its reducer already consumes it as a (possibly incorrect) vocabulary usage. |
 * | tips            | ts, span, tip              | — unmapped           | Not imported. No existing event type carries corrective tips today; the count is reported in `report.unmapped` with the reason. |
 *
 * Ordering: events from the three mapped sources are concatenated in that
 * source order, then stably sorted by timestamp (`sortByTimestamp`), so
 * identical timestamps keep a stable input order. Timestamps are normalized
 * to UTC ISO 8601 (`Date.toISOString()`).
 */

import { EventSchemaVersion, type LanguageEvent } from "../events/types.js";
import type { ModelSeed } from "../learner/types.js";
import { sortByTimestamp } from "../events/sort.js";
import {
  parseLegacyLogs,
  parseLegacyTimestamp,
  parseLegacyTips,
  parseLegacyVocabCaptures,
  parseLegacyVocabReviews,
  type LegacyLogEntry,
  type LegacyTip,
  type LegacyVocabCapture,
  type LegacyVocabReview,
} from "./parse.js";

/** Either raw file content (parsed here) or already-parsed parser output. */
type LegacySource<T> = string | T[];

export interface LegacyImportInput {
  /**
   * Language-pair seed, passed through for the caller's convenience (e.g.
   * rebuilding the model with the same seed). The importer itself never
   * fabricates per-event language data: each legacy log line carries its
   * own native/target in metadata.
   */
  seed: ModelSeed;
  logs?: LegacySource<LegacyLogEntry>;
  vocabCaptures?: LegacySource<LegacyVocabCapture>;
  vocabReviews?: LegacySource<LegacyVocabReview>;
  tips?: LegacySource<LegacyTip>;
}

/** Per-source parse/import accounting. */
export interface LegacySourceReport {
  /** Items that parsed successfully (before timestamp re-validation). */
  parsed: number;
  /** Malformed lines skipped (or pre-parsed items with unusable timestamps). */
  skipped: number;
  /** Items actually imported as events. */
  imported: number;
}

export interface LegacyUnmappedSource {
  source: "tips";
  count: number;
  reason: string;
}

export interface LegacyMappingReport {
  logs: LegacySourceReport;
  vocabCaptures: LegacySourceReport;
  vocabReviews: LegacySourceReport;
  tips: LegacySourceReport;
  /** Sources that could not be mapped to an existing event type. */
  unmapped: LegacyUnmappedSource[];
}

export interface LegacyImportResult {
  /** Deterministic, timestamp-ordered events (schemaVersion 1). */
  events: LanguageEvent[];
  report: LegacyMappingReport;
}

const TIPS_UNMAPPED_REASON =
  "Legacy corrective tips are not imported: no existing event type carries corrective tips today.";

/** Stable identifier for imported vocabulary-review drills. */
const VOCAB_REVIEW_DRILL_ID = "vocab-review";

export function importLegacyLogs(input: LegacyImportInput): LegacyImportResult {
  const report: LegacyMappingReport = {
    logs: { parsed: 0, skipped: 0, imported: 0 },
    vocabCaptures: { parsed: 0, skipped: 0, imported: 0 },
    vocabReviews: { parsed: 0, skipped: 0, imported: 0 },
    tips: { parsed: 0, skipped: 0, imported: 0 },
    unmapped: [],
  };

  const logEvents: LanguageEvent[] = [];
  for (const entry of resolveSource(input.logs, parseLegacyLogs, report.logs)) {
    const timestamp = normalizeTimestamp(entry.ts);
    if (timestamp === null) {
      report.logs.skipped++;
      continue;
    }
    logEvents.push({
      schemaVersion: EventSchemaVersion,
      type: "message_analyzed",
      timestamp,
      // Deterministic ordinal over accepted log entries (stable input order).
      messageId: `legacy-log-${logEvents.length}`,
      textLength: entry.line.length,
      metadata: { legacyKind: entry.kind, native: entry.native, target: entry.target, line: entry.line },
    });
    report.logs.imported++;
  }

  const captureEvents: LanguageEvent[] = [];
  for (const capture of resolveSource(input.vocabCaptures, parseLegacyVocabCaptures, report.vocabCaptures)) {
    const timestamp = normalizeTimestamp(capture.ts);
    if (timestamp === null) {
      report.vocabCaptures.skipped++;
      continue;
    }
    captureEvents.push({
      schemaVersion: EventSchemaVersion,
      type: "vocabulary_detected",
      timestamp,
      lemma: capture.phrase,
      metadata: { translation: capture.translation, source: capture.source },
    });
    report.vocabCaptures.imported++;
  }

  const reviewEvents: LanguageEvent[] = [];
  for (const review of resolveSource(input.vocabReviews, parseLegacyVocabReviews, report.vocabReviews)) {
    const timestamp = normalizeTimestamp(review.ts);
    if (timestamp === null) {
      report.vocabReviews.skipped++;
      continue;
    }
    reviewEvents.push({
      schemaVersion: EventSchemaVersion,
      type: "drill_completed",
      timestamp,
      drillId: VOCAB_REVIEW_DRILL_ID,
      kind: "vocabulary",
      itemId: review.phrase,
      successful: review.correct,
    });
    report.vocabReviews.imported++;
  }

  const tipItems = resolveSource(input.tips, parseLegacyTips, report.tips);
  if (tipItems.length > 0) {
    report.unmapped.push({ source: "tips", count: tipItems.length, reason: TIPS_UNMAPPED_REASON });
  }

  // Stable sort: identical timestamps keep the concatenation order above.
  const events = sortByTimestamp([...logEvents, ...captureEvents, ...reviewEvents]);
  return { events, report };
}

/**
 * Parse raw content (or accept pre-parsed items) and account for the result.
 * Pre-parsed items still go through timestamp re-validation in the mapping
 * loops, so a caller cannot smuggle unusable timestamps into events.
 */
function resolveSource<T extends { ts: string }>(
  source: LegacySource<T> | undefined,
  parse: (raw: string) => { items: T[]; skipped: number },
  into: LegacySourceReport,
): T[] {
  if (source === undefined) return [];
  if (typeof source === "string") {
    const parsed = parse(source);
    into.parsed = parsed.items.length;
    into.skipped = parsed.skipped;
    return parsed.items;
  }
  into.parsed = source.length;
  return source;
}

function normalizeTimestamp(ts: string): string | null {
  const date = parseLegacyTimestamp(ts);
  return date === null ? null : date.toISOString();
}
