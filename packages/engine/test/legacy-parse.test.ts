import { describe, expect, it } from "vitest";

import {
  parseLegacyLogs,
  parseLegacyTips,
  parseLegacyVocabCaptures,
  parseLegacyVocabReviews,
} from "../src/legacy/parse.js";

// Fixtures replicate the real legacy JSONL shapes written by the Pi
// extension (one JSON object per line), including malformed variants.

const LOGS = [
  '{"ts":"2025-01-15T10:00:00.000Z","kind":"correction","native":"Spanish","target":"English","line":"I have 25 years"}',
  "",
  '{"ts":"2025-01-15T10:05:00.000Z","kind":"translation","native":"Spanish","target":"English","line":"let me check"}',
  "not json at all",
  '{"ts":"2025-01-15T10:10:00.000Z","kind":"bogus","native":"Spanish","target":"English","line":"x"}',
  '{"ts":"not-a-date","kind":"unmarked","native":"Spanish","target":"English","line":"y"}',
  '{"ts":"2025-01-15T11:00:00.000Z","line":"missing kind"}',
  // native/target are tolerated as missing (extension ports them as "").
  '{"ts":"2025-01-15T12:00:00.000Z","kind":"unmarked","line":"no language pair"}',
].join("\n");

const VOCAB = [
  '{"ts":"2025-01-14T09:00:00.000Z","phrase":"when you have a minute","translation":"cuando tengas un minuto","source":"translation"}',
  '{"ts":"2025-01-16T09:00:00.000Z","phrase":"take a look at","translation":"revisar","source":"translation"}',
  '{"ts":"2025-01-17T09:00:00.000Z","phrase":"no translation here"}',
  '{"ts":"bad","phrase":"x","translation":"y","source":"translation"}',
].join("\n");

const REVIEWS = [
  '{"ts":"2025-01-15T10:02:00.000Z","phrase":"when you have a minute","correct":true}',
  '{"ts":"2025-01-15T10:08:00.000Z","phrase":"take a look at","correct":false}',
  '{"ts":"2025-01-15T10:09:00.000Z","phrase":"take a look at","correct":"yes"}',
  '{"ts":"2025-01-15T10:10:00.000Z","phrase":"missing correct"}',
].join("\n");

const TIPS = [
  '{"ts":"2025-01-18T10:00:00.000Z","span":"ran","tip":"Past events need past tense."}',
  '{"ts":"2025-01-18T10:01:00.000Z","span":42,"tip":"not a string span"}',
].join("\n");

describe("parseLegacyLogs", () => {
  it("parses well-formed entries and skips malformed ones", () => {
    const { items, skipped } = parseLegacyLogs(LOGS);
    expect(items).toHaveLength(3);
    expect(skipped).toBe(4);
    expect(items[0]).toEqual({
      ts: "2025-01-15T10:00:00.000Z",
      kind: "correction",
      native: "Spanish",
      target: "English",
      line: "I have 25 years",
    });
    // Missing native/target default to "" (extension semantics).
    expect(items[2]).toMatchObject({ kind: "unmarked", native: "", target: "", line: "no language pair" });
  });

  it("returns empty output for empty content", () => {
    expect(parseLegacyLogs("")).toEqual({ items: [], skipped: 0 });
    expect(parseLegacyLogs("\n\n")).toEqual({ items: [], skipped: 0 });
  });
});

describe("parseLegacyVocabCaptures", () => {
  it("parses well-formed captures and skips malformed ones", () => {
    const { items, skipped } = parseLegacyVocabCaptures(VOCAB);
    expect(items).toHaveLength(2);
    expect(skipped).toBe(2);
    expect(items[0]).toEqual({
      ts: "2025-01-14T09:00:00.000Z",
      phrase: "when you have a minute",
      translation: "cuando tengas un minuto",
      source: "translation",
    });
  });
});

describe("parseLegacyVocabReviews", () => {
  it("parses well-formed reviews and skips malformed ones", () => {
    const { items, skipped } = parseLegacyVocabReviews(REVIEWS);
    expect(items).toHaveLength(2);
    expect(skipped).toBe(2);
    expect(items[0]).toEqual({
      ts: "2025-01-15T10:02:00.000Z",
      phrase: "when you have a minute",
      correct: true,
    });
  });
});

describe("parseLegacyTips", () => {
  it("parses well-formed tips and skips malformed ones", () => {
    const { items, skipped } = parseLegacyTips(TIPS);
    expect(items).toHaveLength(1);
    expect(skipped).toBe(1);
    expect(items[0]).toEqual({ ts: "2025-01-18T10:00:00.000Z", span: "ran", tip: "Past events need past tense." });
  });
});
