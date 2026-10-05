import { describe, expect, it } from "vitest";

import { createEmptyModel, fold } from "../src/engine/fold.js";
import { NOW, T0, corrected, detected, reviewed, vocabDetected, vocabUsed } from "./helpers.js";

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
