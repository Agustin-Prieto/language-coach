import { describe, expect, it } from "vitest";

import {
  CATALOG_VERSION,
  TAXONOMY_CATEGORIES,
  TAXONOMY_SUBCATEGORIES,
  categoryOf,
  getPattern,
  isValidPattern,
  listPatternIds,
} from "../src/taxonomy/catalog.js";

describe("taxonomy catalog", () => {
  it("exposes version 1", () => {
    expect(CATALOG_VERSION).toBe(1);
  });

  it("has a closed category list", () => {
    expect([...TAXONOMY_CATEGORIES]).toEqual(["grammar", "vocabulary", "naturalness", "fluency"]);
  });

  it("has a closed subcategory list per category", () => {
    expect([...TAXONOMY_SUBCATEGORIES.grammar]).toEqual([
      "prepositions",
      "articles",
      "tense",
      "agreement",
      "punctuation",
    ]);
    expect([...TAXONOMY_SUBCATEGORIES.naturalness]).toEqual(["collocation"]);
    expect([...TAXONOMY_SUBCATEGORIES.vocabulary]).toEqual(["word-choice"]);
    // fluency has no subcategories yet; the list exists and stays empty.
    expect([...TAXONOMY_SUBCATEGORIES.fluency]).toEqual([]);
  });

  it("lists every seeded pattern id exactly once", () => {
    const ids = listPatternIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids]).toEqual([
      "since-vs-for",
      "article-the",
      "missing-apostrophe",
      "web-locals",
      "third-person-s",
      "irregular-past-simple",
    ]);
  });

  it("resolves each seeded pattern with its catalog metadata", () => {
    expect(getPattern("since-vs-for")).toMatchObject({
      patternId: "since-vs-for",
      category: "grammar",
      subcategory: "prepositions",
    });
    expect(getPattern("article-the")).toMatchObject({ category: "grammar", subcategory: "articles" });
    expect(getPattern("missing-apostrophe")).toMatchObject({ category: "grammar", subcategory: "punctuation" });
    expect(getPattern("web-locals")).toMatchObject({ category: "naturalness", subcategory: "collocation" });
    expect(getPattern("third-person-s")).toMatchObject({ category: "grammar", subcategory: "agreement" });
    expect(getPattern("irregular-past-simple")).toMatchObject({ category: "grammar", subcategory: "tense" });
  });

  it("grounds seeded patterns in canonical examples", () => {
    expect(getPattern("web-locals")?.canonicalExamples).toContain("web locals → web apps locally");
  });

  it("rejects unknown ids without throwing", () => {
    expect(getPattern("no-such-pattern")).toBeUndefined();
    expect(isValidPattern("no-such-pattern")).toBe(false);
    expect(categoryOf("no-such-pattern")).toBeUndefined();
    expect(isValidPattern("")).toBe(false);
  });

  it("keeps every seeded pattern inside the closed category/subcategory lists", () => {
    for (const id of listPatternIds()) {
      const pattern = getPattern(id);
      expect(pattern).toBeDefined();
      expect(TAXONOMY_CATEGORIES).toContain(pattern!.category);
      if (pattern!.subcategory !== undefined) {
        expect(TAXONOMY_SUBCATEGORIES[pattern!.category]).toContain(pattern!.subcategory);
      }
    }
  });

  it("carries well-formed drill data for every seeded pattern", () => {
    for (const id of listPatternIds()) {
      const drill = getPattern(id)?.drill;
      expect(drill, `drill data for ${id}`).toBeDefined();
      expect(drill!.cloze).toContain("___");
      expect(drill!.answer.trim().length).toBeGreaterThan(0);
    }
  });

  it("grounds each drill cloze in the pattern's real correction semantics", () => {
    // Expected answers derived from the registry's own canonical examples.
    expect(getPattern("since-vs-for")?.drill).toMatchObject({ cloze: "I have worked here ___ three years.", answer: "for" });
    expect(getPattern("article-the")?.drill).toMatchObject({ cloze: "I went to ___ cinema last night.", answer: "the" });
    expect(getPattern("missing-apostrophe")?.drill).toMatchObject({ answer: "let's" });
    expect(getPattern("web-locals")?.drill).toMatchObject({ answer: "web apps" });
    expect(getPattern("third-person-s")?.drill).toMatchObject({ answer: "goes" });
    expect(getPattern("irregular-past-simple")?.drill).toMatchObject({ answer: "went" });
  });
});
