/**
 * Interview focus selection tests (M5). Same discipline as selection-context
 * and drill-select: hand-built models from test/helpers.ts pin exact
 * mastery/status values; every assertion checks pure, deterministic output.
 */
import { describe, expect, it } from "vitest";
import { createEmptyModel } from "../src/engine/fold.js";
import { renderInterviewReason } from "../src/policy/reasons.js";
import { INTERVIEW_CAPS, selectInterviewFocus } from "../src/selection/interview.js";
import { mistake, modelWith, vocab } from "./helpers.js";

function emptyModel() {
	return createEmptyModel({ languagePair: { native: "Spanish", target: "English" } });
}

describe("INTERVIEW_CAPS", () => {
	it("are data with the documented values", () => {
		expect(INTERVIEW_CAPS).toEqual({ maxWeakPatterns: 4, maxStrongAreas: 3, maxReasonChars: 240 });
	});
});

describe("selectInterviewFocus — empty model", () => {
	it("returns an empty focus so the interview runs topic-first", () => {
		expect(selectInterviewFocus(emptyModel())).toEqual({ weakAreas: [], strongAreas: [], vocabulary: [] });
	});
});

describe("selectInterviewFocus — weak areas", () => {
	it("selects the lowest-mastery non-mastered registry-valid patterns, mastery ascending", () => {
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "since-vs-for", mastery: 0.5 }),
				mistake({ patternId: "article-the", mastery: 0.2 }),
				mistake({ patternId: "third-person-s", mastery: 0.35 }),
			],
		});
		expect(selectInterviewFocus(model).weakAreas.map((area) => area.patternId)).toEqual([
			"article-the",
			"third-person-s",
			"since-vs-for",
		]);
	});

	it("breaks mastery ties by patternId ascending", () => {
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "web-locals", mastery: 0.3 }),
				mistake({ patternId: "article-the", mastery: 0.3 }),
			],
		});
		expect(selectInterviewFocus(model).weakAreas.map((area) => area.patternId)).toEqual([
			"article-the",
			"web-locals",
		]);
	});

	it("respects maxWeakPatterns and keeps the weakest ones", () => {
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "since-vs-for", mastery: 0.1 }),
				mistake({ patternId: "article-the", mastery: 0.2 }),
				mistake({ patternId: "missing-apostrophe", mastery: 0.3 }),
				mistake({ patternId: "web-locals", mastery: 0.4 }),
				mistake({ patternId: "third-person-s", mastery: 0.5 }),
			],
		});
		const focus = selectInterviewFocus(model);
		expect(focus.weakAreas).toHaveLength(INTERVIEW_CAPS.maxWeakPatterns);
		expect(focus.weakAreas.map((area) => area.patternId)).toEqual([
			"since-vs-for",
			"article-the",
			"missing-apostrophe",
			"web-locals",
		]);
	});

	it("never selects mastered or registry-invalid patterns", () => {
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "since-vs-for", mastery: 0.9, status: "mastered" }),
				mistake({ patternId: "not-in-registry", mastery: 0.05 }),
				mistake({ patternId: "article-the", mastery: 0.4 }),
			],
		});
		const ids = selectInterviewFocus(model).weakAreas.map((area) => area.patternId);
		expect(ids).toEqual(["article-the"]);
	});

	it("renders the templated lowest-mastery reason from data", () => {
		const model = modelWith({ mistakes: [mistake({ patternId: "article-the", mastery: 0.35 })] });
		expect(selectInterviewFocus(model).weakAreas[0]?.reason).toBe("Mastery 35% — one of your weakest patterns.");
	});
});

describe("selectInterviewFocus — strong areas", () => {
	it("selects the highest-mastery mastered/learning patterns, mastery descending, excluding weak-area patterns", () => {
		// With default caps, a learning pattern is always among the (max 4)
		// weak areas, so only the mastered patterns reach strong here.
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "article-the", mastery: 0.9, status: "mastered" }),
				mistake({ patternId: "third-person-s", mastery: 0.75, status: "learning" }),
				mistake({ patternId: "since-vs-for", mastery: 0.85, status: "mastered" }),
			],
		});
		expect(selectInterviewFocus(model).strongAreas.map((area) => area.patternId)).toEqual([
			"article-the",
			"since-vs-for",
		]);
		expect(selectInterviewFocus(model).weakAreas.map((area) => area.patternId)).toEqual(["third-person-s"]);
	});

	it("offers a high-mastery learning pattern as strong when the weak cap excludes it", () => {
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "article-the", mastery: 0.9, status: "mastered" }),
				mistake({ patternId: "third-person-s", mastery: 0.75, status: "learning" }),
				mistake({ patternId: "missing-apostrophe", mastery: 0.3, status: "learning" }),
				mistake({ patternId: "web-locals", mastery: 0.2, status: "learning" }),
			],
		});
		const focus = selectInterviewFocus(model, { maxWeakPatterns: 1, maxStrongAreas: 3, maxReasonChars: 240 });
		expect(focus.weakAreas.map((area) => area.patternId)).toEqual(["web-locals"]);
		expect(focus.strongAreas.map((area) => area.patternId)).toEqual(["article-the", "third-person-s", "missing-apostrophe"]);
	});

	it("excludes review-status patterns and never repeats a weak-area pattern", () => {
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "article-the", mastery: 0.95, status: "review" }),
				mistake({ patternId: "since-vs-for", mastery: 0.1, status: "learning" }),
				mistake({ patternId: "third-person-s", mastery: 0.88, status: "mastered" }),
			],
		});
		const focus = selectInterviewFocus(model);
		const ids = focus.strongAreas.map((area) => area.patternId);
		expect(ids).toEqual(["third-person-s"]);
		// The review-status pattern still shows up as a weak-area candidate.
		expect(focus.weakAreas.map((area) => area.patternId)).toContain("article-the");
		expect(ids).not.toContain("since-vs-for");
	});

	it("respects maxStrongAreas", () => {
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "article-the", mastery: 0.9, status: "mastered" }),
				mistake({ patternId: "third-person-s", mastery: 0.85, status: "mastered" }),
				mistake({ patternId: "irregular-past-simple", mastery: 0.8, status: "mastered" }),
				mistake({ patternId: "web-locals", mastery: 0.75, status: "mastered" }),
			],
		});
		const focus = selectInterviewFocus(model);
		expect(focus.strongAreas).toHaveLength(INTERVIEW_CAPS.maxStrongAreas);
		expect(focus.strongAreas.map((area) => area.patternId)).toEqual([
			"article-the",
			"third-person-s",
			"irregular-past-simple",
		]);
	});

	it("renders the templated strong-area reason from data", () => {
		const model = modelWith({ mistakes: [mistake({ patternId: "article-the", mastery: 0.92, status: "mastered" })] });
		expect(selectInterviewFocus(model).strongAreas[0]?.reason).toBe(renderInterviewReason({ template: "strong-area", masteryPct: 92 }));
	});
});

describe("selectInterviewFocus — vocabulary", () => {
	it("lists learning-status items as activation candidates, closest to activation first", () => {
		const model = modelWith({
			vocabulary: [
				vocab({ lemma: "deploy", status: "learning", correctUses: 1 }),
				vocab({ lemma: "estimate", status: "learning", correctUses: 2 }),
				vocab({ lemma: "pipeline", status: "new", correctUses: 0 }),
				vocab({ lemma: "throughput", status: "active", correctUses: 3 }),
			],
		});
		expect(selectInterviewFocus(model).vocabulary).toEqual(["estimate", "deploy"]);
	});

	it("breaks correctUses ties by lemma ascending", () => {
		const model = modelWith({
			vocabulary: [
				vocab({ lemma: "latency", status: "learning", correctUses: 1 }),
				vocab({ lemma: "backlog", status: "learning", correctUses: 1 }),
			],
		});
		expect(selectInterviewFocus(model).vocabulary).toEqual(["backlog", "latency"]);
	});
});

describe("selectInterviewFocus — determinism and caps", () => {
	it("returns deep-equal output on repeated calls", () => {
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "article-the", mastery: 0.2 }),
				mistake({ patternId: "third-person-s", mastery: 0.9, status: "mastered" }),
			],
			vocabulary: [vocab({ lemma: "deploy", status: "learning", correctUses: 1 })],
		});
		expect(selectInterviewFocus(model)).toEqual(selectInterviewFocus(model));
	});

	it("honors custom caps, including reason truncation", () => {
		const model = modelWith({
			mistakes: [
				mistake({ patternId: "article-the", mastery: 0.2 }),
				mistake({ patternId: "third-person-s", mastery: 0.3 }),
			],
		});
		const focus = selectInterviewFocus(model, { maxWeakPatterns: 1, maxStrongAreas: 1, maxReasonChars: 10 });
		expect(focus.weakAreas).toHaveLength(1);
		expect(focus.weakAreas[0]?.reason).toHaveLength(10);
	});
});
