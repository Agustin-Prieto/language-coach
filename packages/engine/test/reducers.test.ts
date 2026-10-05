import { describe, expect, it } from "vitest";

import {
  createEmptyModel,
  fold,
  reduceDrillCompleted,
  reduceMistakeCorrected,
  reduceMistakeDetected,
  reduceReviewCompleted,
  reduceVocabularyDetected,
  reduceVocabularyUsed,
} from "../src/engine/fold.js";
import type { LearnerModel } from "../src/learner/types.js";
import { T0, corrected, detected, reviewed, times, vocabDetected, vocabUsed } from "./helpers.js";

const SEED = { languagePair: { native: "Spanish", target: "English" } };

describe("fold on empty input", () => {
  it("returns an empty model with the seeded language pair", () => {
    const model = fold([], new Date(T0), SEED);
    expect(model.version).toBe(2);
    expect(model.languagePair).toEqual({ native: "Spanish", target: "English" });
    expect(model.level).toBe("unknown");
    expect(model.mistakes).toEqual({});
    expect(model.vocabulary).toEqual({});
    expect(model.skills).toEqual({});
    expect(model.goals).toEqual([]);
    expect(model.currentFocus).toBeNull();
    expect(model.updatedAt).toBeNull();
  });

  it("defaults the language pair to unknown without a seed", () => {
    expect(fold([]).languagePair).toEqual({ native: "unknown", target: "unknown" });
  });
});

describe("mistake reducers", () => {
  it("counts occurrences, correct, and incorrect separately", () => {
    const model = fold([detected("article-the"), corrected("article-the"), detected("article-the")], new Date(T0));
    const profile = model.mistakes["article-the"]!;
    expect(profile.occurrences).toBe(3);
    expect(profile.incorrect).toBe(2);
    expect(profile.correct).toBe(1);
    expect(profile.firstSeenAt).toBe(T0);
    expect(profile.lastSeenAt).toBe(T0);
    expect(model.updatedAt).toBe(T0);
  });

  it("lowers mastery on detection and raises it on correction (EWMA, alpha 0.3)", () => {
    let model = createEmptyModel(SEED);
    model = reduceMistakeDetected(model, detected("since-for"), new Date(T0));
    expect(model.mistakes["since-for"]!.mastery).toBeCloseTo(0.0, 12);

    model = reduceMistakeCorrected(model, corrected("since-for"), new Date(T0));
    expect(model.mistakes["since-for"]!.mastery).toBeCloseTo(0.3, 12);

    model = reduceMistakeDetected(model, detected("since-for"), new Date(T0));
    expect(model.mistakes["since-for"]!.mastery).toBeCloseTo(0.21, 12);
  });

  it("walks the status table: new → learning → review → mastered", () => {
    let model = fold([detected("since-for")], new Date(T0));
    expect(model.mistakes["since-for"]!.status).toBe("learning");

    // One correction lifts mastery to 0.3 (< 0.4): still learning.
    model = fold([detected("since-for"), corrected("since-for")], new Date(T0));
    expect(model.mistakes["since-for"]!.status).toBe("learning");

    // Two corrections: mastery 0.51 → review.
    model = fold([detected("since-for"), corrected("since-for"), corrected("since-for")], new Date(T0));
    expect(model.mistakes["since-for"]!.status).toBe("review");

    // Keep reviewing successfully until mastery >= 0.8 with >= 3 successes.
    const events = [detected("since-for"), ...times(10, (i) => reviewed("since-for", true))];
    model = fold(events, new Date(T0));
    const profile = model.mistakes["since-for"]!;
    expect(profile.status).toBe("mastered");
    expect(profile.srs.successfulReviews).toBe(10);
    expect(profile.srs.reviewCount).toBe(10);
    expect(profile.srs.failedReviews).toBe(0);
  });

  it("regresses a mastered pattern on the next detection", () => {
    const events = [detected("since-for"), ...times(10, (i) => reviewed("since-for", true))];
    const mastered = fold(events, new Date(T0));
    expect(mastered.mistakes["since-for"]!.status).toBe("mastered");

    const regressed = fold([...events, detected("since-for")], new Date(T0));
    const profile = regressed.mistakes["since-for"]!;
    expect(profile.status).toBe("regressed");
    expect(profile.incorrect).toBe(2);
    expect(profile.mastery).toBeLessThan(0.8);
  });

  it("schedules SRS intervals: 1 day after a success, 1 day after a failure", () => {
    const success = fold([detected("p"), reviewed("p", true)], new Date(T0));
    expect(success.mistakes["p"]!.srs.nextReviewAt).toBe("2025-01-16T10:00:00.000Z");

    const failure = fold([detected("p"), reviewed("p", false)], new Date(T0));
    const srs = failure.mistakes["p"]!.srs;
    expect(srs.nextReviewAt).toBe("2025-01-16T10:00:00.000Z");
    expect(srs.failedReviews).toBe(1);
    expect(srs.successfulReviews).toBe(0);
    expect(srs.reviewCount).toBe(1);
  });

  it("grows the SRS interval with the success streak, clamped at 30 days", () => {
    const events = [detected("p"), reviewed("p", true), reviewed("p", true), reviewed("p", true)];
    const model = fold(events, new Date(T0));
    expect(model.mistakes["p"]!.srs.nextReviewAt).toBe("2025-01-22T10:00:00.000Z"); // 7 days

    const many = [detected("p"), ...times(8, () => reviewed("p", true))];
    const clamped = fold(many, new Date(T0));
    expect(clamped.mistakes["p"]!.srs.nextReviewAt).toBe("2025-02-14T10:00:00.000Z"); // 30 days
  });
});

describe("vocabulary reducers", () => {
  it("creates a profile on detection without usage", () => {
    const model = fold([vocabDetected("serendipity")], new Date(T0));
    const profile = model.vocabulary["serendipity"]!;
    expect(profile.status).toBe("new");
    expect(profile.usageCount).toBe(0);
    expect(profile.correctUses).toBe(0);
    expect(profile.srs.nextReviewAt).toBeNull();
  });

  it("moves status with usage: new → learning → active → mastered", () => {
    let model = fold([vocabDetected("keen"), vocabUsed("keen", true)], new Date(T0));
    expect(model.vocabulary["keen"]!.status).toBe("learning");

    // 3 correct uses → active.
    const activeEvents = [vocabDetected("keen"), ...times(3, () => vocabUsed("keen", true))];
    model = fold(activeEvents, new Date(T0));
    expect(model.vocabulary["keen"]!.status).toBe("active");

    // 10 correct at exactly 80% ratio → mastered.
    const masteredEvents = [
      vocabDetected("keen"),
      ...times(10, () => vocabUsed("keen", true)),
      ...times(2, () => vocabUsed("keen", false)),
    ];
    model = fold(masteredEvents, new Date(T0));
    expect(model.vocabulary["keen"]!.usageCount).toBe(12);
    expect(model.vocabulary["keen"]!.correctUses).toBe(10);
    expect(model.vocabulary["keen"]!.status).toBe("mastered");

    // 9 correct + 2 wrong: usage 11, ratio fine, but correctUses < 10 → active.
    const notYetEvents = [
      vocabDetected("keen"),
      ...times(9, () => vocabUsed("keen", true)),
      ...times(2, () => vocabUsed("keen", false)),
    ];
    model = fold(notYetEvents, new Date(T0));
    expect(model.vocabulary["keen"]!.status).toBe("active");
  });

  it("counts incorrect uses without moving correctUses", () => {
    const model = fold([vocabDetected("keen"), vocabUsed("keen", false)], new Date(T0));
    const profile = model.vocabulary["keen"]!;
    expect(profile.usageCount).toBe(1);
    expect(profile.correctUses).toBe(0);
    expect(profile.status).toBe("new");
  });
});

describe("drill reducers", () => {
  it("feeds mistake drill results into the mistake profile and SRS", () => {
    const event = {
      schemaVersion: 1 as const,
      type: "drill_completed" as const,
      timestamp: T0,
      drillId: "drill-1",
      kind: "mistake" as const,
      itemId: "article-the",
      successful: true,
    };
    const model = reduceDrillCompleted(createEmptyModel(SEED), event, new Date(T0));
    const profile = model.mistakes["article-the"]!;
    expect(profile.occurrences).toBe(0); // drills are not conversation occurrences
    expect(profile.mastery).toBeCloseTo(0.3, 12);
    expect(profile.srs.successfulReviews).toBe(1);
    expect(profile.srs.nextReviewAt).toBe("2025-01-16T10:00:00.000Z");
  });

  it("feeds vocabulary drill results into usage counters", () => {
    const event = {
      schemaVersion: 1 as const,
      type: "drill_completed" as const,
      timestamp: T0,
      drillId: "drill-2",
      kind: "vocabulary" as const,
      itemId: "keen",
      successful: true,
    };
    const model = reduceDrillCompleted(createEmptyModel(SEED), event, new Date(T0));
    expect(model.vocabulary["keen"]!.usageCount).toBe(1);
    expect(model.vocabulary["keen"]!.correctUses).toBe(1);
    expect(model.vocabulary["keen"]!.status).toBe("learning");
  });
});

describe("reducer purity", () => {
  it("never mutates the input model", () => {
    const before = createEmptyModel(SEED);
    const snapshot = structuredClone(before);
    reduceMistakeDetected(before, detected("p"), new Date(T0));
    reduceVocabularyUsed(before, vocabUsed("w", true), new Date(T0));
    reduceReviewCompleted(before, reviewed("p", true), new Date(T0));
    expect(before).toEqual(snapshot as LearnerModel);
  });
});
