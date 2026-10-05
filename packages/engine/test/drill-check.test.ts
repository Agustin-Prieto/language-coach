import { describe, expect, it } from "vitest";

import { checkAnswer, normalizeAnswer } from "../src/drill/check.js";
import type { DrillItem } from "../src/drill/select.js";

function mistakeItem(answer: string, kind: DrillItem["kind"] = "mistake"): DrillItem {
  return { kind, id: "test-pattern", reason: "test reason", exercise: { cloze: "___", answer } };
}

describe("normalizeAnswer", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeAnswer("  for  ")).toBe("for");
  });

  it("casefolds", () => {
    expect(normalizeAnswer("Let's GO")).toBe("let's go");
  });

  it("collapses internal whitespace runs", () => {
    expect(normalizeAnswer("web   apps")).toBe("web apps");
    expect(normalizeAnswer("web\t apps")).toBe("web apps");
  });

  it("strips trailing punctuation", () => {
    expect(normalizeAnswer("went.")).toBe("went");
    expect(normalizeAnswer("the?!")).toBe("the");
    expect(normalizeAnswer("for…")).toBe("for");
  });

  it("keeps significant internal punctuation", () => {
    // The whole point of the missing-apostrophe pattern: the apostrophe matters.
    expect(normalizeAnswer("let's")).toBe("let's");
    expect(normalizeAnswer("lets")).toBe("lets");
    expect(normalizeAnswer("let's")).not.toBe(normalizeAnswer("lets"));
  });
});

describe("checkAnswer", () => {
  it("accepts the exact answer", () => {
    expect(checkAnswer(mistakeItem("for"), "for")).toEqual({ correct: true, expected: "for" });
  });

  it("ignores case differences", () => {
    expect(checkAnswer(mistakeItem("went"), "WENT").correct).toBe(true);
  });

  it("ignores whitespace and trailing punctuation differences", () => {
    expect(checkAnswer(mistakeItem("web apps"), "  Web   Apps. ").correct).toBe(true);
    expect(checkAnswer(mistakeItem("let's"), "Let's!")).toEqual({ correct: true, expected: "let's" });
  });

  it("rejects wrong answers and reports the expected one", () => {
    expect(checkAnswer(mistakeItem("for"), "since")).toEqual({ correct: false, expected: "for" });
    expect(checkAnswer(mistakeItem("web apps"), "web locals")).toEqual({ correct: false, expected: "web apps" });
  });

  it("does not accept the incorrect form the pattern exists to fix", () => {
    expect(checkAnswer(mistakeItem("let's"), "lets").correct).toBe(false);
  });

  it("throws for vocabulary items, which are self-graded", () => {
    const vocabItem: DrillItem = { kind: "vocabulary", id: "web apps locally", reason: "test reason" };
    expect(() => checkAnswer(vocabItem, "anything")).toThrow(TypeError);
  });
});
