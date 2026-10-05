import { describe, expect, it } from "vitest";

import { CORRECTION_THRESHOLDS, decideCorrection, dueForReview } from "../src/policy/correction.js";
import { NOW, modelWith, mistake } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

describe("CORRECTION_THRESHOLDS", () => {
  it("exposes the documented bands as data", () => {
    expect(CORRECTION_THRESHOLDS).toEqual({ teachBelow: 0.4, hintAtOrBelow: 0.7 });
  });
});

describe("decideCorrection — mastery bands", () => {
  it("teaches actively below the teach threshold", () => {
    const model = modelWith({ mistakes: [mistake({ patternId: "article-the", mastery: 0.2, status: "learning" })] });
    const decision = decideCorrection(model, { patternId: "article-the" }, NOW);
    expect(decision.action).toBe("correct");
    expect(decision.reason).toBe("Mastery 20% — actively teaching this pattern.");
  });

  it("treats mastery just below 0.40 as correct and exactly 0.40 as hint", () => {
    const below = modelWith({ mistakes: [mistake({ patternId: "article-the", mastery: 0.399, status: "learning" })] });
    expect(decideCorrection(below, { patternId: "article-the" }, NOW).action).toBe("correct");

    const at = modelWith({ mistakes: [mistake({ patternId: "article-the", mastery: 0.4, status: "review" })] });
    const decision = decideCorrection(at, { patternId: "article-the" }, NOW);
    expect(decision.action).toBe("hint");
    expect(decision.reason).toBe("Mastery 40% — quick hint.");
  });

  it("hints through the upper band boundary (0.70 inclusive)", () => {
    const model = modelWith({ mistakes: [mistake({ patternId: "article-the", mastery: 0.7, status: "review" })] });
    expect(decideCorrection(model, { patternId: "article-the" }, NOW).action).toBe("hint");
  });

  it("keeps hinting above 0.70 while the pattern is not mastered (documented completion)", () => {
    const model = modelWith({ mistakes: [mistake({ patternId: "article-the", mastery: 0.75, status: "review" })] });
    const decision = decideCorrection(model, { patternId: "article-the" }, NOW);
    expect(decision.action).toBe("hint");
    expect(decision.reason).toBe("Mastery 75% — quick hint.");
  });

  it("ignores mastered patterns above the hint band", () => {
    const model = modelWith({
      mistakes: [mistake({ patternId: "article-the", mastery: 0.91, status: "mastered" })],
    });
    const decision = decideCorrection(model, { patternId: "article-the" }, NOW);
    expect(decision.action).toBe("ignore");
    expect(decision.reason).toBe("Mastery 91% — monitoring only.");
  });
});

describe("decideCorrection — regressed override", () => {
  it("challenges regardless of mastery when status is regressed", () => {
    const model = modelWith({
      mistakes: [mistake({ patternId: "article-the", mastery: 0.45, status: "regressed" })],
    });
    const decision = decideCorrection(model, { patternId: "article-the" }, NOW);
    expect(decision.action).toBe("challenge");
    expect(decision.reason).toBe("Mastery 45% — regressed; challenging with a targeted drill.");
  });

  it("challenges even at high mastery — status beats the mastery band", () => {
    const model = modelWith({
      mistakes: [mistake({ patternId: "article-the", mastery: 0.9, status: "regressed" })],
    });
    expect(decideCorrection(model, { patternId: "article-the" }, NOW).action).toBe("challenge");
  });
});

describe("decideCorrection — unknown / uncategorized patterns", () => {
  it("defaults to a conservative hint for a patternId missing from the model", () => {
    const decision = decideCorrection(modelWith(), { patternId: "since-vs-for" }, NOW);
    expect(decision.action).toBe("hint");
    expect(decision.reason).toBe("Unrecognized pattern — offering a conservative hint.");
  });

  it("treats 'uncategorized' as unknown even if a profile exists", () => {
    const model = modelWith({
      mistakes: [mistake({ patternId: "uncategorized", mastery: 0.1, status: "learning" })],
    });
    const decision = decideCorrection(model, { patternId: "uncategorized" }, NOW);
    expect(decision.action).toBe("hint");
    expect(decision.reason).toBe("Unrecognized pattern — offering a conservative hint.");
  });
});

describe("decideCorrection — reserved candidate fields", () => {
  it("does not change the decision for severity or lastSeenAt in M3a", () => {
    const model = modelWith({ mistakes: [mistake({ patternId: "article-the", mastery: 0.5, status: "review" })] });
    const plain = decideCorrection(model, { patternId: "article-the" }, NOW);
    const decorated = decideCorrection(
      model,
      { patternId: "article-the", severity: "high", lastSeenAt: iso(-DAY_MS) },
      NOW,
    );
    expect(decorated).toEqual(plain);
  });
});

describe("decideCorrection — reason hygiene", () => {
  it("never emits trailing or leading whitespace", () => {
    const model = modelWith({
      mistakes: [
        mistake({ patternId: "a", mastery: 0.1, status: "learning" }),
        mistake({ patternId: "b", mastery: 0.5, status: "review" }),
        mistake({ patternId: "c", mastery: 0.95, status: "mastered" }),
        mistake({ patternId: "d", mastery: 0.5, status: "regressed" }),
      ],
    });
    for (const patternId of ["a", "b", "c", "d", "missing", "uncategorized"]) {
      const reason = decideCorrection(model, { patternId }, NOW).reason;
      expect(reason).toBe(reason.trim());
    }
  });
});

describe("dueForReview", () => {
  it("returns only mistakes whose nextReviewAt is at or before now", () => {
    const model = modelWith({
      mistakes: [
        mistake({ patternId: "past", srs: { nextReviewAt: iso(-DAY_MS), reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
        mistake({ patternId: "future", srs: { nextReviewAt: iso(DAY_MS), reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
        mistake({ patternId: "never", srs: { nextReviewAt: null, reviewCount: 0, successfulReviews: 0, failedReviews: 0 } }),
        mistake({ patternId: "exact", srs: { nextReviewAt: iso(0), reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
      ],
    });
    const due = dueForReview(model, NOW);
    expect(due.map((m) => m.patternId)).toEqual(["past", "exact"]);
  });

  it("sorts by nextReviewAt ascending", () => {
    const model = modelWith({
      mistakes: [
        mistake({ patternId: "older", srs: { nextReviewAt: iso(-DAY_MS), reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
        mistake({ patternId: "oldest", srs: { nextReviewAt: iso(-2 * DAY_MS), reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
        mistake({ patternId: "newest-due", srs: { nextReviewAt: iso(0), reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
      ],
    });
    expect(dueForReview(model, NOW).map((m) => m.patternId)).toEqual(["oldest", "older", "newest-due"]);
  });

  it("breaks ties on nextReviewAt by patternId ascending", () => {
    const same = iso(-DAY_MS);
    const model = modelWith({
      mistakes: [
        mistake({ patternId: "b-pattern", srs: { nextReviewAt: same, reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
        mistake({ patternId: "a-pattern", srs: { nextReviewAt: same, reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
      ],
    });
    expect(dueForReview(model, NOW).map((m) => m.patternId)).toEqual(["a-pattern", "b-pattern"]);
  });

  it("returns an empty list for a model with nothing scheduled", () => {
    expect(dueForReview(modelWith(), NOW)).toEqual([]);
  });
});
