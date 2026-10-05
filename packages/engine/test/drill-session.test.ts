import { describe, expect, it } from "vitest";

import { applyDrillResult, drillResultEvent } from "../src/drill/session.js";
import { selectDrillItems } from "../src/drill/select.js";
import { createEmptyModel, fold } from "../src/engine/fold.js";
import { T0, mistake, modelWith, vocab } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mistakeItem(patternId = "since-vs-for") {
  return { kind: "mistake" as const, id: patternId, reason: "test reason" };
}

function vocabItem(lemma = "web apps locally") {
  return { kind: "vocabulary" as const, id: lemma, reason: "test reason" };
}

describe("drillResultEvent", () => {
  it("builds the exact DrillCompletedEvent shape the fold consumes", () => {
    const event = drillResultEvent(mistakeItem("since-vs-for"), true, T0);
    expect(event).toEqual({
      schemaVersion: 1,
      type: "drill_completed",
      timestamp: T0,
      drillId: "cloze",
      kind: "mistake",
      itemId: "since-vs-for",
      successful: true,
    });
  });

  it("uses the deterministic vocabulary drill id and the lemma as itemId", () => {
    const event = drillResultEvent(vocabItem("web apps locally"), false, T0);
    expect(event.drillId).toBe("recall");
    expect(event.kind).toBe("vocabulary");
    expect(event.itemId).toBe("web apps locally");
    expect(event.successful).toBe(false);
  });

  it("rejects malformed input at the boundary", () => {
    expect(() => drillResultEvent(mistakeItem(""), true, T0)).toThrow();
    expect(() => drillResultEvent(mistakeItem(), true, "not-a-timestamp")).toThrow();
  });
});

describe("applyDrillResult — fold integration (mistake)", () => {
  it("updates the mistake profile mastery and SRS through the existing reducer", () => {
    const now = new Date(T0);
    const before = modelWith({ mistakes: [mistake({ patternId: "since-vs-for", mastery: 0.3, status: "learning" })] });
    const after = applyDrillResult(before, mistakeItem("since-vs-for"), true, now);

    const profile = after.mistakes["since-vs-for"]!;
    // EWMA: mastery' = 0.3 + 0.3 * (1 - 0.3) = 0.51
    expect(profile.mastery).toBeCloseTo(0.51, 10);
    // Documented reducer behavior: drill results move mastery/SRS/status but
    // never touch the conversation-evidence counters (occurrences/correct).
    expect(profile.occurrences).toBe(1);
    expect(profile.correct).toBe(0);
    expect(profile.status).toBe("review"); // mastery 0.51 >= 0.4
    expect(profile.srs.successfulReviews).toBe(1);
    expect(profile.srs.reviewCount).toBe(1);
    expect(profile.srs.failedReviews).toBe(0);
    expect(profile.srs.nextReviewAt).toBe(new Date(now.getTime() + 1 * DAY_MS).toISOString());
    expect(after.updatedAt).toBe(T0);
    // The input model is never mutated.
    expect(before.mistakes["since-vs-for"]!.srs.successfulReviews).toBe(0);
  });

  it("records a failed drill as a failed SRS review", () => {
    const now = new Date(T0);
    const after = applyDrillResult(createEmptyModel(), mistakeItem("since-vs-for"), false, now);
    const profile = after.mistakes["since-vs-for"]!;
    expect(profile.mastery).toBe(0);
    expect(profile.srs.failedReviews).toBe(1);
    expect(profile.srs.successfulReviews).toBe(0);
    expect(profile.srs.nextReviewAt).toBe(new Date(now.getTime() + 1 * DAY_MS).toISOString());
  });

  it("moves vocabulary drills through the existing vocabulary usage path", () => {
    const now = new Date(T0);
    const before = modelWith({ vocabulary: [vocab({ lemma: "web apps locally" })] });
    const after = applyDrillResult(before, vocabItem("web apps locally"), true, now);
    const profile = after.vocabulary["web apps locally"]!;
    expect(profile.usageCount).toBe(2);
    expect(profile.correctUses).toBe(2);
  });
});

describe("fold — drill_completed integration", () => {
  it("folds a full drill session from events into the documented model state", () => {
    const events = [
      drillResultEvent(mistakeItem("since-vs-for"), true, "2025-01-15T10:00:00.000Z"),
      drillResultEvent(mistakeItem("since-vs-for"), true, "2025-01-16T10:00:00.000Z"),
      drillResultEvent(vocabItem("web apps locally"), true, "2025-01-16T10:01:00.000Z"),
    ];
    const now = new Date("2025-01-20T10:00:00.000Z");
    const model = fold(events, now);

    const mistake = model.mistakes["since-vs-for"]!;
    // Two successful drills from mastery 0: 0 → 0.3 → 0.51 (EWMA α = 0.3)
    expect(mistake.mastery).toBeCloseTo(0.51, 10);
    expect(mistake.srs.successfulReviews).toBe(2);
    // Second success schedules the 3-day interval. fold(events, now) uses the
    // injected `now` as the reference instant for every event's scheduling.
    expect(mistake.srs.nextReviewAt).toBe("2025-01-23T10:00:00.000Z");
    expect(mistake.status).toBe("review");

    const vocab = model.vocabulary["web apps locally"]!;
    expect(vocab.usageCount).toBe(1);
    expect(vocab.correctUses).toBe(1);

    // The drilled pattern becomes due again and is selected by the drill engine.
    const items = selectDrillItems(model, undefined, now);
    expect(items.map((item) => item.id)).toContain("since-vs-for");
  });
});
