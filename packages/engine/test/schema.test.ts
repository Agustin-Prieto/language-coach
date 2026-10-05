import { describe, expect, it } from "vitest";

import {
  MAX_REJECTION_SUMMARY_CHARS,
  AnalysisRejectedPayloadSchema,
  ClassifierInputSchema,
  ClassifierOutputSchema,
  truncateRejectionSummary,
} from "../src/analysis/schema.js";

const VALID_CLASSIFIED = {
  verdict: "classified",
  patternId: "article-the",
  severity: "medium",
  original: "a apple",
  corrected: "an apple",
  confidence: 0.9,
};

const VALID_UNCATEGORIZED = {
  verdict: "uncategorized",
  proposedPattern: "web locals",
  original: "running the web locals",
  confidence: 0.7,
};

describe("ClassifierInputSchema", () => {
  it("accepts message text plus learner context", () => {
    const parsed = ClassifierInputSchema.parse({
      text: "I have been living here since three years.",
      targetLanguage: "English",
      nativeLanguage: "Spanish",
      activePatternIds: ["since-vs-for", "article-the"],
    });
    expect(parsed.text).toContain("since three years");
    expect(parsed.activePatternIds).toHaveLength(2);
  });

  it("requires text and target language", () => {
    expect(ClassifierInputSchema.safeParse({ text: "hello" }).success).toBe(false);
    expect(ClassifierInputSchema.safeParse({ targetLanguage: "English" }).success).toBe(false);
    expect(ClassifierInputSchema.safeParse({ text: "", targetLanguage: "English" }).success).toBe(false);
  });
});

describe("ClassifierOutputSchema — classified", () => {
  it("parses a valid classified output", () => {
    const parsed = ClassifierOutputSchema.parse(VALID_CLASSIFIED);
    expect(parsed).toMatchObject({ verdict: "classified", patternId: "article-the", severity: "medium" });
  });

  it("rejects an unknown patternId as a typed zod failure, not a crash", () => {
    const result = ClassifierOutputSchema.safeParse({ ...VALID_CLASSIFIED, patternId: "hallucinated-pattern" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("patternId"));
      expect(issue?.message).toContain("Unknown patternId");
    }
  });

  it("allows corrected, spanStart and spanEnd to be optional", () => {
    expect(ClassifierOutputSchema.safeParse(VALID_CLASSIFIED).success).toBe(true);
    expect(
      ClassifierOutputSchema.safeParse({
        ...VALID_CLASSIFIED,
        corrected: undefined,
        spanStart: 0,
        spanEnd: 7,
      }).success,
    ).toBe(true);
  });

  it("rejects an inverted span", () => {
    const result = ClassifierOutputSchema.safeParse({ ...VALID_CLASSIFIED, spanStart: 5, spanEnd: 2 });
    expect(result.success).toBe(false);
  });
});

describe("ClassifierOutputSchema — uncategorized", () => {
  it("parses uncategorized with a proposedPattern", () => {
    const parsed = ClassifierOutputSchema.parse(VALID_UNCATEGORIZED);
    expect(parsed.verdict).toBe("uncategorized");
  });

  it("parses uncategorized without a proposedPattern", () => {
    const parsed = ClassifierOutputSchema.parse({
      verdict: "uncategorized",
      original: "sounds fine to me",
      confidence: 0.6,
    });
    expect(parsed.verdict).toBe("uncategorized");
  });

  it("rejects an empty proposedPattern", () => {
    expect(ClassifierOutputSchema.safeParse({ ...VALID_UNCATEGORIZED, proposedPattern: "   " }).success).toBe(false);
  });
});

describe("ClassifierOutputSchema — bounds", () => {
  it("enforces severity values", () => {
    expect(ClassifierOutputSchema.safeParse({ ...VALID_CLASSIFIED, severity: "catastrophic" }).success).toBe(false);
  });

  it("enforces confidence in [0, 1]", () => {
    expect(ClassifierOutputSchema.safeParse({ ...VALID_CLASSIFIED, confidence: 1.5 }).success).toBe(false);
    expect(ClassifierOutputSchema.safeParse({ ...VALID_CLASSIFIED, confidence: -0.1 }).success).toBe(false);
    expect(ClassifierOutputSchema.safeParse({ ...VALID_CLASSIFIED, confidence: 0 }).success).toBe(true);
    expect(ClassifierOutputSchema.safeParse({ ...VALID_CLASSIFIED, confidence: 1 }).success).toBe(true);
  });

  it("rejects an unknown verdict", () => {
    expect(ClassifierOutputSchema.safeParse({ ...VALID_CLASSIFIED, verdict: "maybe" }).success).toBe(false);
  });
});

describe("AnalysisRejectedPayloadSchema", () => {
  it("accepts a reason code with a bounded summary", () => {
    expect(
      AnalysisRejectedPayloadSchema.safeParse({ reason: "unknown_pattern", summary: "Unknown patternId x" }).success,
    ).toBe(true);
  });

  it("rejects reason codes outside the closed list", () => {
    expect(AnalysisRejectedPayloadSchema.safeParse({ reason: "vibes", summary: "x" }).success).toBe(false);
  });

  it("rejects unbounded summaries", () => {
    expect(
      AnalysisRejectedPayloadSchema.safeParse({ reason: "port_error", summary: "x".repeat(301) }).success,
    ).toBe(false);
  });
});

describe("truncateRejectionSummary", () => {
  it("is deterministic and bounded", () => {
    const raw = `line1\nline2\twith ${"tabs and spaces ".repeat(50)}`;
    const first = truncateRejectionSummary(raw);
    const second = truncateRejectionSummary(raw);
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(MAX_REJECTION_SUMMARY_CHARS);
    expect(first).not.toContain("\n");
    expect(first.startsWith("line1 line2")).toBe(true);
  });

  it("leaves short summaries alone", () => {
    expect(truncateRejectionSummary("short")).toBe("short");
  });
});
