import { describe, expect, it } from "vitest";

import { DEFAULT_CONTEXT_CAPS, selectContext, serializeContext } from "../src/selection/context.js";
import type { ContextCaps } from "../src/selection/context.js";
import { NOW, T0, modelWith, mistake, times, vocab } from "./helpers.js";

/** Registry-valid ids: active patterns must come from the closed vocabulary. */
const REGISTRY_IDS = [
  "since-vs-for",
  "article-the",
  "missing-apostrophe",
  "web-locals",
  "third-person-s",
  "irregular-past-simple",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

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

describe("DEFAULT_CONTEXT_CAPS", () => {
  it("exposes the documented caps as data", () => {
    expect(DEFAULT_CONTEXT_CAPS).toEqual({
      maxDueMistakes: 5,
      maxActivePatterns: 8,
      maxVocabulary: 10,
      maxReasonChars: 240,
    });
  });
});

describe("selectContext — caps", () => {
  it("caps due mistakes at maxDueMistakes, most overdue first", () => {
    const model = modelWith({ mistakes: times(8, (i) => dueMistake(`p${i}`, 10 - i)) });
    const context = selectContext(model, DEFAULT_CONTEXT_CAPS, NOW);
    expect(context.dueMistakes).toHaveLength(5);
    expect(context.dueMistakes.map((e) => e.profile.patternId)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("tops up below-cap due slots with the lowest-mastery not-due mistakes", () => {
    const model = modelWith({
      mistakes: [
        dueMistake("due-1", 3),
        dueMistake("due-2", 1),
        mistake({ patternId: "weak", mastery: 0.05, status: "learning" }),
        mistake({ patternId: "mid", mastery: 0.5, status: "review" }),
        mistake({ patternId: "strong", mastery: 0.6, status: "review" }),
        mistake({ patternId: "strongest", mastery: 0.72, status: "review" }),
      ],
    });
    const context = selectContext(model, DEFAULT_CONTEXT_CAPS, NOW);
    expect(context.dueMistakes.map((e) => e.profile.patternId)).toEqual([
      "due-1",
      "due-2",
      "weak",
      "mid",
      "strong",
    ]);
  });

  it("caps active pattern ids at maxActivePatterns, most recent first", () => {
    // Six registry ids exceed a cap of 3; fake ids would be filtered out.
    const caps: ContextCaps = { ...DEFAULT_CONTEXT_CAPS, maxActivePatterns: 3 };
    const model = modelWith({
      mistakes: REGISTRY_IDS.map((patternId, i) =>
        mistake({ patternId, status: "review", mastery: 0.5, lastSeenAt: iso(-i * 60_000) }),
      ),
    });
    const context = selectContext(model, caps, NOW);
    expect(context.activePatternIds).toHaveLength(3);
    expect(context.activePatternIds).toEqual(["since-vs-for", "article-the", "missing-apostrophe"]);
  });

  it("excludes mastered and non-registry patterns from active ids", () => {
    const model = modelWith({
      mistakes: [
        mistake({ patternId: "article-the", status: "mastered", mastery: 0.95, lastSeenAt: T0 }),
        mistake({ patternId: "third-person-s", status: "review", mastery: 0.5, lastSeenAt: T0 }),
        mistake({ patternId: "uncategorized", status: "learning", mastery: 0.2, lastSeenAt: T0 }),
        mistake({ patternId: "not-in-registry", status: "learning", mastery: 0.2, lastSeenAt: T0 }),
      ],
    });
    const context = selectContext(model, DEFAULT_CONTEXT_CAPS, NOW);
    expect(context.activePatternIds).toEqual(["third-person-s"]);
  });

  it("caps vocabulary at maxVocabulary, only due items, nextReviewAt then lemma", () => {
    const model = modelWith({
      vocabulary: [
        ...times(12, (i) =>
          vocab({
            lemma: `w${i}`,
            srs: { nextReviewAt: iso(-i * DAY_MS), reviewCount: 1, successfulReviews: 1, failedReviews: 0 },
          }),
        ),
        vocab({ lemma: "not-due", srs: { nextReviewAt: iso(DAY_MS), reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
        vocab({ lemma: "unscheduled", srs: { nextReviewAt: null, reviewCount: 0, successfulReviews: 0, failedReviews: 0 } }),
      ],
    });
    const context = selectContext(model, DEFAULT_CONTEXT_CAPS, NOW);
    expect(context.vocabulary).toHaveLength(10);
    expect(context.vocabulary.map((v) => v.lemma)).toEqual([
      "w11",
      "w10",
      "w9",
      "w8",
      "w7",
      "w6",
      "w5",
      "w4",
      "w3",
      "w2",
    ]);
  });

  it("breaks vocabulary ties on nextReviewAt by lemma ascending", () => {
    const same = iso(-DAY_MS);
    const model = modelWith({
      vocabulary: [
        vocab({ lemma: "banana", srs: { nextReviewAt: same, reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
        vocab({ lemma: "apple", srs: { nextReviewAt: same, reviewCount: 1, successfulReviews: 1, failedReviews: 0 } }),
      ],
    });
    const context = selectContext(model, DEFAULT_CONTEXT_CAPS, NOW);
    expect(context.vocabulary.map((v) => v.lemma)).toEqual(["apple", "banana"]);
  });

  it("passes the current focus through", () => {
    const focus = { patternId: "since-vs-for", reason: "recurring this week", since: T0 };
    const context = selectContext(modelWith({ currentFocus: focus }), DEFAULT_CONTEXT_CAPS, NOW);
    expect(context.focus).toEqual(focus);
  });

  it("truncates rendered reasons to maxReasonChars", () => {
    const caps: ContextCaps = { maxDueMistakes: 1, maxActivePatterns: 0, maxVocabulary: 0, maxReasonChars: 10 };
    const model = modelWith({ mistakes: [dueMistake("p0", 2)] });
    const context = selectContext(model, caps, NOW);
    expect(context.dueMistakes).toHaveLength(1);
    expect(context.dueMistakes[0]!.reason.length).toBeLessThanOrEqual(10);
  });
});

describe("selectContext — determinism", () => {
  it("returns a deep-equal context for repeated calls with the same model and now", () => {
    const model = modelWith({
      mistakes: [
        dueMistake("p0", 2),
        mistake({ patternId: "p1", mastery: 0.5, status: "review", lastSeenAt: T0 }),
      ],
      vocabulary: [vocab({ lemma: "apple", srs: { nextReviewAt: iso(-DAY_MS), reviewCount: 1, successfulReviews: 1, failedReviews: 0 } })],
      currentFocus: { patternId: "p1", reason: "focus", since: T0 },
    });
    const first = selectContext(model, DEFAULT_CONTEXT_CAPS, NOW);
    const second = selectContext(model, DEFAULT_CONTEXT_CAPS, NOW);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("selectContext — empty model", () => {
  it("returns an empty context with a zero token estimate", () => {
    const context = selectContext(modelWith(), DEFAULT_CONTEXT_CAPS, NOW);
    expect(context.dueMistakes).toEqual([]);
    expect(context.activePatternIds).toEqual([]);
    expect(context.focus).toBeNull();
    expect(context.vocabulary).toEqual([]);
    expect(context.tokenEstimate).toBe(0);
  });
});

describe("selectContext — tokenEstimate formula", () => {
  it("equals ceil(serializeContext(context).length / 4)", () => {
    const model = modelWith({
      mistakes: [dueMistake("p0", 2), mistake({ patternId: "p1", mastery: 0.5, status: "review", lastSeenAt: T0 })],
      vocabulary: [vocab({ lemma: "apple", srs: { nextReviewAt: iso(-DAY_MS), reviewCount: 1, successfulReviews: 1, failedReviews: 0 } })],
      currentFocus: { patternId: "p1", reason: "focus", since: T0 },
    });
    const context = selectContext(model, DEFAULT_CONTEXT_CAPS, NOW);
    expect(context.tokenEstimate).toBe(Math.ceil(serializeContext(context).length / 4));
  });

  it("serializes the bounded slice without trailing whitespace", () => {
    const model = modelWith({
      mistakes: [dueMistake("p0", 2)],
      currentFocus: { patternId: "p0", reason: "focus", since: T0 },
    });
    const context = selectContext(model, DEFAULT_CONTEXT_CAPS, NOW);
    const text = serializeContext(context);
    expect(text).toBe(text.trim());
    expect(text).toContain("mistake p0");
    expect(text).toContain("focus p0");
  });
});
