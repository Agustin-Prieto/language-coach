/**
 * Parsers for the four legacy JSONL formats written by the Pi extension
 * (log entries, vocab captures, vocab reviews, tips).
 *
 * These are ports of the extension's original parsers (parseLogEntries,
 * parseVocabEntries, parseVocabReviews) with their tolerance semantics
 * preserved: a malformed line never breaks the import, it is only counted.
 * A line is skipped when its JSON is unparseable, when required fields are
 * missing or of the wrong type, or when its timestamp is not strict ISO 8601
 * (the extension's parseLogDate rule — no trusting Date's lenient fallbacks).
 * Blank lines are ignored, not counted as malformed, matching the event
 * store's tolerance style.
 */

export type LegacyLogKind = "correction" | "translation" | "unmarked";

/** One line of `language-coach-log.jsonl`. */
export interface LegacyLogEntry {
  ts: string;
  kind: LegacyLogKind;
  native: string;
  target: string;
  line: string;
}

/** One line of `language-coach-vocab.jsonl`. */
export interface LegacyVocabCapture {
  ts: string;
  phrase: string;
  translation: string;
  source: string;
}

/** One line of `language-coach-vocab-reviews.jsonl`. */
export interface LegacyVocabReview {
  ts: string;
  phrase: string;
  correct: boolean;
}

/** One line of `language-coach-tips.jsonl`. */
export interface LegacyTip {
  ts: string;
  span: string;
  tip: string;
}

export interface ParsedLegacy<T> {
  items: T[];
  /** Lines that were malformed and therefore skipped. */
  skipped: number;
}

/** Legacy timestamps are always UTC ISO 8601 (the extension wrote `new Date().toISOString()`). */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Strict timestamp validation; returns the parsed Date or null. Ported from parseLogDate. */
export function parseLegacyTimestamp(ts: unknown): Date | null {
  if (typeof ts !== "string" || !ISO_8601.test(ts)) return null;
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Shared JSONL walker: blank lines ignored, malformed lines counted. */
function parseJsonlLines<T>(raw: string, accept: (record: Record<string, unknown>) => T | null): ParsedLegacy<T> {
  const items: T[] = [];
  let skipped = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null) {
        skipped++;
        continue;
      }
      const item = accept(parsed as Record<string, unknown>);
      if (item === null) {
        skipped++;
      } else {
        items.push(item);
      }
    } catch {
      // Unparseable JSON: skipped and counted, never fatal.
      skipped++;
    }
  }
  return { items, skipped };
}

function validString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string";
}

export function parseLegacyLogs(raw: string): ParsedLegacy<LegacyLogEntry> {
  return parseJsonlLines<LegacyLogEntry>(raw, (record) => {
    if (
      !validString(record, "ts") ||
      !validString(record, "line") ||
      (record.kind !== "correction" && record.kind !== "translation" && record.kind !== "unmarked") ||
      parseLegacyTimestamp(record.ts) === null
    ) {
      return null;
    }
    return {
      ts: record.ts as string,
      kind: record.kind as LegacyLogKind,
      // The extension tolerated a missing language pair; keep that semantics.
      native: typeof record.native === "string" ? record.native : "",
      target: typeof record.target === "string" ? record.target : "",
      line: record.line as string,
    };
  });
}

export function parseLegacyVocabCaptures(raw: string): ParsedLegacy<LegacyVocabCapture> {
  return parseJsonlLines<LegacyVocabCapture>(raw, (record) => {
    if (
      !validString(record, "ts") ||
      !validString(record, "phrase") ||
      !validString(record, "translation") ||
      parseLegacyTimestamp(record.ts) === null
    ) {
      return null;
    }
    return {
      ts: record.ts as string,
      phrase: record.phrase as string,
      translation: record.translation as string,
      // The extension never required `source`; treat it as optional.
      source: typeof record.source === "string" ? record.source : "",
    };
  });
}

export function parseLegacyVocabReviews(raw: string): ParsedLegacy<LegacyVocabReview> {
  return parseJsonlLines<LegacyVocabReview>(raw, (record) => {
    if (!validString(record, "ts") || !validString(record, "phrase") || typeof record.correct !== "boolean") {
      return null;
    }
    if (parseLegacyTimestamp(record.ts) === null) return null;
    return { ts: record.ts as string, phrase: record.phrase as string, correct: record.correct as boolean };
  });
}

export function parseLegacyTips(raw: string): ParsedLegacy<LegacyTip> {
  return parseJsonlLines<LegacyTip>(raw, (record) => {
    if (!validString(record, "ts") || !validString(record, "span") || !validString(record, "tip")) return null;
    if (parseLegacyTimestamp(record.ts) === null) return null;
    return { ts: record.ts as string, span: record.span as string, tip: record.tip as string };
  });
}
