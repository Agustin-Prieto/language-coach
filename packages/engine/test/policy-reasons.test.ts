import { describe, expect, it } from "vitest";

import { renderCorrectionReason, renderDrillReason, toMasteryPercent } from "../src/policy/reasons.js";

describe("toMasteryPercent", () => {
  it("rounds a mastery ratio to an integer percent", () => {
    expect(toMasteryPercent(0)).toBe(0);
    expect(toMasteryPercent(0.91)).toBe(91);
    expect(toMasteryPercent(0.905)).toBe(91);
    expect(toMasteryPercent(1)).toBe(100);
  });
});

describe("renderCorrectionReason", () => {
  it("renders the actively-teaching template", () => {
    expect(renderCorrectionReason({ template: "actively-teaching", masteryPct: 23 })).toBe(
      "Mastery 23% — actively teaching this pattern.",
    );
  });

  it("renders the hint template", () => {
    expect(renderCorrectionReason({ template: "hint", masteryPct: 55 })).toBe("Mastery 55% — quick hint.");
  });

  it("renders the monitoring template", () => {
    expect(renderCorrectionReason({ template: "monitoring", masteryPct: 91 })).toBe("Mastery 91% — monitoring only.");
  });

  it("renders the regressed template", () => {
    expect(renderCorrectionReason({ template: "regressed", masteryPct: 45 })).toBe(
      "Mastery 45% — regressed; challenging with a targeted drill.",
    );
  });

  it("renders the unknown-pattern template", () => {
    expect(renderCorrectionReason({ template: "unknown-pattern" })).toBe(
      "Unrecognized pattern — offering a conservative hint.",
    );
  });
});

describe("renderDrillReason", () => {
  it("pluralizes mistakes and days explicitly", () => {
    expect(renderDrillReason({ template: "recent-mistakes", count: 6, days: 7 })).toBe(
      "You made 6 mistakes related to this in the last 7 days.",
    );
    expect(renderDrillReason({ template: "recent-mistakes", count: 1, days: 1 })).toBe(
      "You made 1 mistake related to this in the last 1 day.",
    );
    expect(renderDrillReason({ template: "recent-mistakes", count: 1, days: 7 })).toBe(
      "You made 1 mistake related to this in the last 7 days.",
    );
    expect(renderDrillReason({ template: "recent-mistakes", count: 3, days: 1 })).toBe(
      "You made 3 mistakes related to this in the last 1 day.",
    );
  });

  it("distinguishes 'due now' from overdue by whole days", () => {
    expect(renderDrillReason({ template: "due-review", overdueDays: 0 })).toBe("Due for review now.");
    expect(renderDrillReason({ template: "due-review", overdueDays: 3 })).toBe("Due for review 3 days ago.");
    expect(renderDrillReason({ template: "due-review", overdueDays: 1 })).toBe("Due for review 1 day ago.");
  });

  it("renders the lowest-mastery template", () => {
    expect(renderDrillReason({ template: "lowest-mastery", masteryPct: 42 })).toBe(
      "Mastery 42% — one of your weakest patterns.",
    );
  });
});

describe("reason hygiene", () => {
  it("never emits trailing or leading whitespace for any template", () => {
    const rendered = [
      renderCorrectionReason({ template: "actively-teaching", masteryPct: 10 }),
      renderCorrectionReason({ template: "hint", masteryPct: 50 }),
      renderCorrectionReason({ template: "monitoring", masteryPct: 90 }),
      renderCorrectionReason({ template: "regressed", masteryPct: 50 }),
      renderCorrectionReason({ template: "unknown-pattern" }),
      renderDrillReason({ template: "recent-mistakes", count: 1, days: 1 }),
      renderDrillReason({ template: "recent-mistakes", count: 9, days: 30 }),
      renderDrillReason({ template: "due-review", overdueDays: 0 }),
      renderDrillReason({ template: "due-review", overdueDays: 14 }),
      renderDrillReason({ template: "lowest-mastery", masteryPct: 5 }),
    ];
    for (const text of rendered) {
      expect(text).toBe(text.trim());
    }
  });
});
