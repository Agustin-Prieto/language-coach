import { describe, expect, it } from "vitest";

import { classifyWithPort, type ClassifierPort } from "../src/analysis/classifier.js";

const INPUT = {
  text: "I have been living here since three years.",
  targetLanguage: "English",
  activePatternIds: ["since-vs-for"],
};

const VALID_CLASSIFIED = {
  verdict: "classified",
  patternId: "since-vs-for",
  severity: "high",
  original: "since three years",
  corrected: "for three years",
  spanStart: 22,
  spanEnd: 38,
  confidence: 0.95,
};

function portReturning(value: unknown): ClassifierPort {
  return { classify: async () => value };
}

function portThrowing(error: unknown): ClassifierPort {
  return {
    classify: async () => {
      throw error;
    },
  };
}

describe("classifyWithPort", () => {
  it("returns the parsed classification on a valid port result", async () => {
    const result = await classifyWithPort(portReturning(VALID_CLASSIFIED), INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.classification).toMatchObject({ verdict: "classified", patternId: "since-vs-for" });
    }
  });

  it("maps a port throw to a port_error rejection, never throwing to the caller", async () => {
    const result = await classifyWithPort(portThrowing(new Error("relay down")), INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.reason).toBe("port_error");
      expect(result.rejection.summary).toContain("relay down");
    }
  });

  it("maps a non-Error port throw to a port_error rejection too", async () => {
    const result = await classifyWithPort(portThrowing("boom"), INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.reason).toBe("port_error");
      expect(result.rejection.summary).toContain("boom");
    }
  });

  it("maps a missing verdict to missing_fields", async () => {
    const { verdict: _omitted, ...withoutVerdict } = VALID_CLASSIFIED;
    const result = await classifyWithPort(portReturning(withoutVerdict), INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe("missing_fields");
  });

  it("maps a non-object result to schema_mismatch", async () => {
    for (const value of [null, "classified", 42, []]) {
      const result = await classifyWithPort(portReturning(value), INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.rejection.reason).toBe("schema_mismatch");
    }
  });

  it("maps an unknown patternId to unknown_pattern", async () => {
    const result = await classifyWithPort(
      portReturning({ ...VALID_CLASSIFIED, patternId: "hallucinated-pattern" }),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe("unknown_pattern");
  });

  it("maps out-of-bounds confidence to schema_mismatch", async () => {
    const result = await classifyWithPort(portReturning({ ...VALID_CLASSIFIED, confidence: 5 }), INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe("schema_mismatch");
  });

  it("keeps rejection summaries bounded", async () => {
    const result = await classifyWithPort(portThrowing(new Error("x".repeat(1000))), INPUT);
    if (!result.ok) expect(result.rejection.summary.length).toBeLessThanOrEqual(300);
  });
});
