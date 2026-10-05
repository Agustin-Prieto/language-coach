import { describe, expect, it } from "vitest";

import { importLegacyLogs } from "../src/legacy/import.js";
import {
  parseLegacyLogs,
  parseLegacyTips,
  parseLegacyVocabCaptures,
  parseLegacyVocabReviews,
} from "../src/legacy/parse.js";

const SEED = { languagePair: { native: "Spanish", target: "English" } };

// Timestamps are chosen so the chronologically sorted sequence interleaves
// the four sources: C < A < E < B < F < D.
const LOGS = [
  '{"ts":"2025-01-15T10:00:00.000Z","kind":"correction","native":"Spanish","target":"English","line":"I have 25 years"}',
  '{"ts":"2025-01-15T10:05:00.000Z","kind":"translation","native":"Spanish","target":"English","line":"let me check"}',
].join("\n");

const VOCAB = [
  '{"ts":"2025-01-14T09:00:00.000Z","phrase":"when you have a minute","translation":"cuando tengas un minuto","source":"translation"}',
  '{"ts":"2025-01-16T09:00:00.000Z","phrase":"take a look at","translation":"revisar","source":"translation"}',
].join("\n");

const REVIEWS = [
  '{"ts":"2025-01-15T10:02:00.000Z","phrase":"when you have a minute","correct":true}',
  '{"ts":"2025-01-15T10:08:00.000Z","phrase":"take a look at","correct":false}',
].join("\n");

const TIPS = '{"ts":"2025-01-18T10:00:00.000Z","span":"ran","tip":"Past events need past tense."}';

const INPUT = { seed: SEED, logs: LOGS, vocabCaptures: VOCAB, vocabReviews: REVIEWS, tips: TIPS };

describe("importLegacyLogs", () => {
  it("maps each legacy source to its event type with the right counts", () => {
    const { events, report } = importLegacyLogs(INPUT);
    expect(events).toHaveLength(6);
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "message_analyzed")).toHaveLength(2);
    expect(types.filter((t) => t === "vocabulary_detected")).toHaveLength(2);
    expect(types.filter((t) => t === "drill_completed")).toHaveLength(2);
    expect(types).not.toContain("mistake_detected"); // no taxonomy data in legacy logs
    expect(types).not.toContain("analysis_rejected");
  });

  it("sorts events by timestamp across sources and keeps stable order for ties", () => {
    const { events } = importLegacyLogs(INPUT);
    expect(events.map((e) => e.timestamp)).toEqual([
      "2025-01-14T09:00:00.000Z", // capture C
      "2025-01-15T10:00:00.000Z", // log A
      "2025-01-15T10:02:00.000Z", // review E
      "2025-01-15T10:05:00.000Z", // log B
      "2025-01-15T10:08:00.000Z", // review F
      "2025-01-16T09:00:00.000Z", // capture D
    ]);

    const tied = importLegacyLogs({
      seed: SEED,
      logs: [
        '{"ts":"2025-01-15T10:00:00.000Z","kind":"unmarked","native":"Spanish","target":"English","line":"first"}',
        '{"ts":"2025-01-15T10:00:00.000Z","kind":"unmarked","native":"Spanish","target":"English","line":"second"}',
      ].join("\n"),
    });
    expect(tied.events).toHaveLength(2);
    expect((tied.events[0] as { messageId: string }).messageId).toBe("legacy-log-0");
    expect((tied.events[1] as { messageId: string }).messageId).toBe("legacy-log-1");
  });

  it("records legacy context as metadata without fabricating event payload", () => {
    const { events } = importLegacyLogs(INPUT);
    const [logEvent] = events.filter((e) => e.type === "message_analyzed");
    const [captureEvent] = events.filter((e) => e.type === "vocabulary_detected");
    const [reviewEvent] = events.filter((e) => e.type === "drill_completed");
    expect(logEvent).toMatchObject({
      type: "message_analyzed",
      messageId: "legacy-log-0",
      textLength: "I have 25 years".length,
      metadata: { legacyKind: "correction", native: "Spanish", target: "English", line: "I have 25 years" },
    });
    expect(captureEvent).toMatchObject({
      type: "vocabulary_detected",
      lemma: "when you have a minute",
      metadata: { translation: "cuando tengas un minuto", source: "translation" },
    });
    expect(reviewEvent).toMatchObject({
      type: "drill_completed",
      drillId: "vocab-review",
      kind: "vocabulary",
      itemId: "when you have a minute",
      successful: true,
    });
  });

  it("reports unmapped tips with a reason and per-source parsed/skipped/imported counts", () => {
    const messyLogs = `${LOGS}\nnot json\n{"ts":"oops","kind":"unmarked","line":"x"}`;
    const { events, report } = importLegacyLogs({ ...INPUT, logs: messyLogs });
    expect(events).toHaveLength(6);
    expect(report.logs).toEqual({ parsed: 2, skipped: 2, imported: 2 });
    expect(report.vocabCaptures).toEqual({ parsed: 2, skipped: 0, imported: 2 });
    expect(report.vocabReviews).toEqual({ parsed: 2, skipped: 0, imported: 2 });
    expect(report.tips).toEqual({ parsed: 1, skipped: 0, imported: 0 });
    expect(report.unmapped).toHaveLength(1);
    expect(report.unmapped[0]).toMatchObject({ source: "tips", count: 1 });
    expect(report.unmapped[0].reason).toMatch(/tips/i);
  });

  it("accepts pre-parsed parser outputs instead of raw strings", () => {
    const parsed = {
      logs: parseLegacyLogs(LOGS).items,
      vocabCaptures: parseLegacyVocabCaptures(VOCAB).items,
      vocabReviews: parseLegacyVocabReviews(REVIEWS).items,
      tips: parseLegacyTips(TIPS).items,
    };
    const fromRaw = importLegacyLogs(INPUT);
    const fromParsed = importLegacyLogs({ seed: SEED, ...parsed });
    expect(fromParsed.events).toEqual(fromRaw.events);
    expect(fromParsed.report).toEqual(fromRaw.report);
  });

  it("normalizes offset timestamps to UTC and drops items with unusable timestamps", () => {
    const { events, report } = importLegacyLogs({
      seed: SEED,
      logs: '{"ts":"2025-01-15T12:00:00.000+02:00","kind":"unmarked","native":"Spanish","target":"English","line":"offset"}',
      vocabCaptures: '{"ts":"nope","phrase":"x","translation":"y","source":"translation"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "message_analyzed", timestamp: "2025-01-15T10:00:00.000Z" });
    expect(report.logs).toEqual({ parsed: 1, skipped: 0, imported: 1 });
    expect(report.vocabCaptures).toEqual({ parsed: 0, skipped: 1, imported: 0 });
  });

  it("produces an empty result and zeroed report when nothing is provided", () => {
    const { events, report } = importLegacyLogs({ seed: SEED });
    expect(events).toEqual([]);
    expect(report.unmapped).toEqual([]);
    for (const source of [report.logs, report.vocabCaptures, report.vocabReviews, report.tips]) {
      expect(source).toEqual({ parsed: 0, skipped: 0, imported: 0 });
    }
  });
});
