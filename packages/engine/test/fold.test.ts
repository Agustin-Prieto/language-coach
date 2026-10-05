import { describe, expect, it } from "vitest";

import { createEmptyModel, fold } from "../src/engine/fold.js";
import { NOW, T0, at, corrected, detected, reviewed, times, vocabDetected, vocabUsed } from "./helpers.js";

const SEED = { languagePair: { native: "Spanish", target: "English" } };

const EVENTS = [
  detected("article-the"),
  corrected("article-the"),
  vocabDetected("keen"),
  vocabUsed("keen", true),
  reviewed("article-the", true),
];

describe("fold determinism", () => {
  it("produces deep-equal models for the same events and now", () => {
    const first = fold(EVENTS, NOW, SEED);
    const second = fold(EVENTS, NOW, SEED);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("produces deep-equal models without a fixed now (event timestamps used)", () => {
    const first = fold(EVENTS);
    const second = fold(EVENTS);
    expect(second).toEqual(first);
  });

  it("uses `now` for scheduling, so different now yields different nextReviewAt", () => {
    const withNow = fold([detected("p"), reviewed("p", true)], new Date("2025-06-01T09:00:00.000Z"));
    expect(withNow.mistakes["p"]!.srs.nextReviewAt).toBe("2025-06-02T09:00:00.000Z");

    const fromTimestamps = fold([detected("p", "articles", T0), reviewed("p", true, T0)]);
    expect(fromTimestamps.mistakes["p"]!.srs.nextReviewAt).toBe("2025-01-16T10:00:00.000Z");
  });
});

describe("fold event semantics", () => {
  it("applies events in order, last writer wins per field", () => {
    const model = fold([corrected("p"), corrected("p"), detected("p")], NOW);
    // Last event is a detection: incorrect 1, mastery back down.
    expect(model.mistakes["p"]!.correct).toBe(2);
    expect(model.mistakes["p"]!.incorrect).toBe(1);
    expect(model.mistakes["p"]!.mastery).toBeCloseTo(0.51 - 0.3 * 0.51, 12);
  });

  it("leaves the model untouched by analysis_rejected events", () => {
    const rejected = {
      schemaVersion: 1 as const,
      type: "analysis_rejected" as const,
      timestamp: T0,
      reason: "classifier returned unknown patternId",
    };
    const without = fold(EVENTS, NOW);
    const withRejected = fold([...EVENTS, rejected], NOW);
    expect(withRejected).toEqual(without);
  });

  it("only stamps updatedAt for mutating events, never for rejected analyses", () => {
    const rejected = {
      schemaVersion: 1 as const,
      type: "analysis_rejected" as const,
      timestamp: T0,
      reason: "schema validation failed",
    };
    const model = fold([rejected], NOW);
    expect(model.updatedAt).toBeNull();
  });

  it("respects the seed language pair", () => {
    const model = fold(EVENTS, NOW, SEED);
    expect(model.languagePair).toEqual({ native: "Spanish", target: "English" });
    expect(model).toEqual(fold(EVENTS, NOW, createEmptyModel(SEED)));
  });

  it("returns an empty model for an empty event list", () => {
    const model = fold([], NOW);
    expect(model.mistakes).toEqual({});
    expect(model.vocabulary).toEqual({});
    expect(model.updatedAt).toBeNull();
  });
});

describe("mistake_detected severity weights (M2)", () => {
  // Starting point in every case: detection (mastery 0) + correction
  // (mastery 0.3 via EWMA alpha 0.3). The next detection pulls mastery back
  // toward 0 with weight = severity multiplier:
  //   low    (0.5): 0.3 + 0.3 * 0.5 * (0 - 0.3) = 0.255
  //   medium (1.0): 0.3 + 0.3 * 1.0 * (0 - 0.3) = 0.21
  //   high   (1.5): 0.3 + 0.3 * 1.5 * (0 - 0.3) = 0.165
  const BASE = [detected("article-the", "articles", T0), corrected("article-the", "articles", T0)];

  it.each([
    ["low", 0.255],
    ["medium", 0.21],
    ["high", 0.165],
  ] as const)("applies the %s weight to the EWMA update", (severity, expected) => {
    const model = fold([...BASE, detected("article-the", "articles", T0, severity)], NOW);
    expect(model.mistakes["article-the"]!.mastery).toBeCloseTo(expected, 12);
  });

  it("treats a missing severity as medium for pre-M2 events (backward compatible)", () => {
    const withExplicit = fold([...BASE, detected("article-the", "articles", T0, "medium")], NOW);
    const withoutSeverity = fold([...BASE, detected("article-the", "articles", T0)], NOW);
    expect(withoutSeverity.mistakes["article-the"]!.mastery).toBe(
      withExplicit.mistakes["article-the"]!.mastery,
    );
  });

  it("keeps severity-weighted mastery clamped to [0, 1]", () => {
    // High weight on a success path would overshoot 1 without clamping.
    const manyCorrections = times(10, (i) => corrected("article-the", "articles", at(i + 1)));
    const model = fold([detected("article-the", "articles", T0, "high"), ...manyCorrections], NOW);
    const mastery = model.mistakes["article-the"]!.mastery;
    expect(mastery).toBeLessThanOrEqual(1);
    expect(mastery).toBeGreaterThanOrEqual(0);
  });

  it("still treats analysis_rejected with an M2 summary as a strict no-op", () => {
    const rejected = {
      schemaVersion: 1 as const,
      type: "analysis_rejected" as const,
      timestamp: T0,
      reason: "unknown_pattern",
      summary: "Unknown patternId hallucinated-pattern",
    };
    const without = fold(EVENTS, NOW);
    expect(fold([...EVENTS, rejected], NOW)).toEqual(without);
  });
});
