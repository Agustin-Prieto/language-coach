import { describe, expect, it } from "vitest";

import type { AnalysisRejectedEvent, MistakeCorrectedEvent, MistakeDetectedEvent } from "../src/events/types.js";
import {
  EventFactoryError,
  InvalidEventInputError,
  UnknownPatternError,
  makeAnalysisRejected,
  makeMistakeCorrected,
  makeMistakeDetected,
} from "../src/events/factories.js";

const T0 = "2025-01-15T10:00:00.000Z";

describe("makeMistakeDetected", () => {
  it("builds an event for a valid patternId, carrying catalog category/subcategory", () => {
    const result = makeMistakeDetected({
      verdict: "classified",
      patternId: "article-the",
      severity: "medium",
      original: "a apple",
      corrected: "an apple",
      timestamp: T0,
    });
    expect(result.kind).toBe("event");
    const event = (result as { event: MistakeDetectedEvent }).event;
    expect(event).toMatchObject({
      schemaVersion: 1,
      type: "mistake_detected",
      patternId: "article-the",
      category: "grammar",
      subcategory: "articles",
      severity: "medium",
      original: "a apple",
      correction: "an apple",
      timestamp: T0,
    });
  });

  it("carries the subcategory when the pattern has one", () => {
    const result = makeMistakeDetected({
      verdict: "classified",
      patternId: "irregular-past-simple",
      severity: "low",
      original: "I goed",
      corrected: "I went",
      timestamp: T0,
    });
    const event = (result as { event: MistakeDetectedEvent }).event;
    expect(event.subcategory).toBe("tense");
  });

  it("throws a typed error for an invalid patternId", () => {
    expect(() =>
      makeMistakeDetected({
        verdict: "classified",
        patternId: "hallucinated-pattern",
        severity: "low",
        original: "x",
        corrected: "y",
        timestamp: T0,
      }),
    ).toThrow(UnknownPatternError);
  });

  it("routes uncategorized-with-proposedPattern to a pending proposal, not an event", () => {
    const result = makeMistakeDetected({
      verdict: "uncategorized",
      proposedPattern: "  Web   locals ",
      original: "testing the web locals",
      timestamp: T0,
    });
    expect(result.kind).toBe("pending-proposal");
    const proposal = (result as { proposal: { proposedPattern: string; proposedAt: string } }).proposal;
    expect(proposal.proposedPattern).toBe("Web   locals");
    expect(proposal.proposedAt).toBe(T0);
  });

  it("throws a typed error for uncategorized without a proposedPattern", () => {
    expect(() =>
      makeMistakeDetected({
        verdict: "uncategorized",
        proposedPattern: "   ",
        original: "x",
        timestamp: T0,
      }),
    ).toThrow(InvalidEventInputError);
  });

  it("throws a typed error for a non-ISO timestamp", () => {
    expect(() =>
      makeMistakeDetected({
        verdict: "classified",
        patternId: "article-the",
        severity: "low",
        original: "x",
        corrected: "y",
        timestamp: "whenever",
      }),
    ).toThrow(InvalidEventInputError);
  });
});

describe("makeMistakeCorrected", () => {
  it("builds an event with the catalog category", () => {
    const event: MistakeCorrectedEvent = makeMistakeCorrected({ patternId: "since-vs-for", timestamp: T0 });
    expect(event).toMatchObject({
      schemaVersion: 1,
      type: "mistake_corrected",
      patternId: "since-vs-for",
      category: "grammar",
      timestamp: T0,
    });
  });

  it("throws a typed error for an invalid patternId", () => {
    expect(() => makeMistakeCorrected({ patternId: "nope", timestamp: T0 })).toThrow(UnknownPatternError);
  });
});

describe("makeAnalysisRejected", () => {
  it("builds a rejection event with a reason code and bounded summary", () => {
    const event: AnalysisRejectedEvent = makeAnalysisRejected(
      { reason: "port_error", summary: "relay down" },
      T0,
    );
    expect(event).toMatchObject({
      schemaVersion: 1,
      type: "analysis_rejected",
      reason: "port_error",
      summary: "relay down",
      timestamp: T0,
    });
  });

  it("truncates unbounded summaries at the boundary", () => {
    const event = makeAnalysisRejected({ reason: "schema_mismatch", summary: "x".repeat(5000) }, T0);
    expect(event.summary.length).toBeLessThanOrEqual(300);
  });

  it("throws a typed error for an invalid rejection payload", () => {
    expect(() =>
      makeAnalysisRejected({ reason: "vibes" as never, summary: "x" }, T0),
    ).toThrow(InvalidEventInputError);
    expect(() => makeAnalysisRejected({ reason: "port_error", summary: "" }, T0)).toThrow(InvalidEventInputError);
  });
});

describe("typed error hierarchy", () => {
  it("extends EventFactoryError so callers can catch the family", () => {
    expect(new UnknownPatternError("x")).toBeInstanceOf(EventFactoryError);
    expect(new InvalidEventInputError("x")).toBeInstanceOf(EventFactoryError);
    expect(new EventFactoryError("x")).toBeInstanceOf(Error);
  });
});
