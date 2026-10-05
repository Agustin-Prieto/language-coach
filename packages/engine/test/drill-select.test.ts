import { describe, expect, it } from "vitest";

import { DRILL_CAPS, selectDrillItems } from "../src/drill/select.js";
import type { DrillCaps } from "../src/drill/select.js";
import { getPattern } from "../src/taxonomy/catalog.js";
import { NOW, modelWith, mistake, times, vocab } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

/** A due mistake with SRS state `overdueDays` in the past. */
function dueMistake(patternId: string, overdueDays: number, overrides = {}) {
  return mistake({
    patternId,
    srs: {
      nextReviewAt: iso(-overdueDays * DAY_MS),
      reviewCount: 1,
      successfulReviews: 1,
      failedReviews: 0,
    },
    ...overrides,
  });
}

function dueVocab(lemma: string, overdueDays: number, overrides = {}) {
  return vocab({
    lemma,
    srs: { nextReviewAt: iso(-overdueDays * DAY_MS), reviewCount: 1, successfulReviews: 1, failedReviews: 0 },
    ...overrides,
  });
}

describe("DRILL_CAPS", () => {
  it("exposes the documented caps as data", () => {
    expect(DRILL_CAPS).toEqual({
      maxMistakeItems: 5,
      maxVocabItems: 5,
      maxReasonChars: 240,
    });
  });
});

describe("selectDrillItems — caps", () => {
  it("caps mistake items at maxMistakeItems, most overdue first", () => {
    // All 6 registry ids are due; only maxMistakeItems come back.
    const ids = ["since-vs-for", "article-the", "missing-apostrophe", "web-locals", "third-person-s", "irregular-past-simple"];
    const model = modelWith({ mistakes: ids.map((id, i) => dueMistake(id, 10 - i)) });
    const items = selectDrillItems(model, DRILL_CAPS, NOW);
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.id)).toEqual([
      "since-vs-for",
      "article-the",
      "missing-apostrophe",
      "web-locals",
      "third-person-s",
    ]);
    for (const item of items) {
      expect(item.kind).toBe("mistake");
      expect(item.exercise).toEqual(getPattern(item.id)!.drill);
    }
  });

  it("tops up below-cap due slots with the lowest-mastery non-mastered mistakes", () => {
    const model = modelWith({
      mistakes: [
        dueMistake("third-person-s", 3),
        mistake({ patternId: "web-locals", mastery: 0.05, status: "learning" }),
        mistake({ patternId: "irregular-past-simple", mastery: 0.0, status: "mastered" }),
      ],
    });
    const items = selectDrillItems(model, DRILL_CAPS, NOW);
    expect(items.map((item) => item.id)).toEqual(["third-person-s", "web-locals"]);
    expect(items[1]!.reason).toBe("Mastery 5% — one of your weakest patterns.");
  });

  it("does not duplicate a pattern already selected as due when topping up", () => {
    const model = modelWith({ mistakes: [dueMistake("since-vs-for", 1)] });
    const items = selectDrillItems(model, { ...DRILL_CAPS, maxMistakeItems: 3 }, NOW);
    expect(items.map((item) => item.id)).toEqual(["since-vs-for"]);
  });

  it("caps vocabulary at maxVocabItems after the mistake items", () => {
    const model = modelWith({ vocabulary: times(8, (i) => dueVocab(`w${i}`, 2)) });
    const items = selectDrillItems(model, { ...DRILL_CAPS, maxVocabItems: 3 }, NOW);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.kind).toBe("vocabulary");
      expect(item.exercise).toBeUndefined();
    }
  });

  it("never exceeds maxMistakeItems + maxVocabItems in total", () => {
    const ids = ["since-vs-for", "article-the", "missing-apostrophe", "web-locals", "third-person-s", "irregular-past-simple"];
    const model = modelWith({
      mistakes: ids.map((id) => dueMistake(id, 1)),
      vocabulary: times(8, (i) => dueVocab(`w${i}`, 1)),
    });
    const items = selectDrillItems(model, DRILL_CAPS, NOW);
    expect(items).toHaveLength(DRILL_CAPS.maxMistakeItems + DRILL_CAPS.maxVocabItems);
    expect(items.filter((i) => i.kind === "mistake")).toHaveLength(DRILL_CAPS.maxMistakeItems);
    expect(items.filter((i) => i.kind === "vocabulary")).toHaveLength(DRILL_CAPS.maxVocabItems);
  });
});

describe("selectDrillItems — registry validity", () => {
  it("skips mistakes without registry drill data instead of synthesizing an exercise", () => {
    const model = modelWith({
      mistakes: [dueMistake("not-in-registry", 2), mistake({ patternId: "uncategorized", mastery: 0.1, status: "learning" })],
    });
    expect(selectDrillItems(model, DRILL_CAPS, NOW)).toEqual([]);
  });

  it("returns nothing for a model whose only items have no drill data", () => {
    const model = modelWith({
      vocabulary: [vocab({ lemma: "unscheduled", srs: { nextReviewAt: null, reviewCount: 0, successfulReviews: 0, failedReviews: 0 } })],
    });
    expect(selectDrillItems(model, DRILL_CAPS, NOW)).toEqual([]);
  });
});

describe("selectDrillItems — vocabulary ordering", () => {
  it("sorts due vocabulary by nextReviewAt then lemma, never including not-due items", () => {
    const model = modelWith({
      vocabulary: [
        dueVocab("banana", 1),
        dueVocab("apple", 5),
        dueVocab("cherry", 1),
        dueVocab("future", -3), // not due yet
      ],
    });
    const items = selectDrillItems(model, DRILL_CAPS, NOW);
    expect(items.map((item) => item.id)).toEqual(["apple", "banana", "cherry"]);
    expect(items[0]!.reason).toBe("Vocabulary recall due 5 days ago.");
    expect(items[1]!.reason).toBe("Vocabulary recall due 1 day ago.");
  });
});

describe("selectDrillItems — determinism", () => {
  it("returns a deep-equal list for repeated calls with the same model and now", () => {
    const model = modelWith({
      mistakes: [dueMistake("since-vs-for", 2), mistake({ patternId: "third-person-s", mastery: 0.5, status: "review" })],
      vocabulary: [dueVocab("apple", 1)],
    });
    const first = selectDrillItems(model, DRILL_CAPS, NOW);
    const second = selectDrillItems(model, DRILL_CAPS, NOW);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("is stable across key-insertion order of the model maps", () => {
    const a = modelWith({ mistakes: [dueMistake("article-the", 1), dueMistake("since-vs-for", 1)] });
    const b = modelWith({ mistakes: [dueMistake("since-vs-for", 1), dueMistake("article-the", 1)] });
    expect(selectDrillItems(a, DRILL_CAPS, NOW)).toEqual(selectDrillItems(b, DRILL_CAPS, NOW));
  });
});

describe("selectDrillItems — empty model", () => {
  it("returns an empty list for an empty model", () => {
    expect(selectDrillItems(modelWith(), DRILL_CAPS, NOW)).toEqual([]);
  });
});
