/**
 * Versioned closed taxonomy: categories, subcategories, and the mistake
 * pattern registry. This is code data, deliberately small and curated.
 *
 * HOW A PATTERN LEGITIMATELY ENTERS THE REGISTRY
 *
 * 1. The classifier returns `verdict: "uncategorized"` with `proposedPattern`
 *    (raw learner text describing the recurring mistake).
 * 2. The host adapter routes that proposal into the pending store
 *    (see `taxonomy/pending.ts`); nothing is written to this catalog.
 * 3. A human reviews accumulated proposals and canonicalizes one into a
 *    registry entry through a code-review commit that edits this file and
 *    bumps `CATALOG_VERSION`.
 *
 * Patterns are NEVER added at runtime, from chat, or by the classifier. The
 * classifier only picks ids from this closed list (enforced at parse time by
 * `analysis/schema.ts`) or reports "uncategorized".
 */

/** Version of the closed taxonomy. Bump on registry/subcategory changes. */
export const CATALOG_VERSION = 1;

/** Closed category list. Adding a category is a catalog-version change. */
export const TAXONOMY_CATEGORIES = ["grammar", "vocabulary", "naturalness", "fluency"] as const;
export type TaxonomyCategory = (typeof TAXONOMY_CATEGORIES)[number];

/**
 * Closed subcategory lists per category. The initial set is intentionally
 * small: subcategories grow only through the same human canonicalization
 * process as patterns. `fluency` has none yet; its list exists and stays
 * empty until a real pattern justifies one.
 */
export const TAXONOMY_SUBCATEGORIES: Record<TaxonomyCategory, readonly string[]> = {
  grammar: ["prepositions", "articles", "tense", "agreement", "punctuation"],
  vocabulary: ["word-choice"],
  naturalness: ["collocation"],
  fluency: [],
};

/** One registry entry: a recurring, named mistake pattern. */
export interface TaxonomyPattern {
  patternId: string;
  category: TaxonomyCategory;
  /** Must be a member of the category's closed subcategory list. */
  subcategory?: string;
  description: string;
  /** Ground-truth example corrections, ideally from the learner's real history. */
  canonicalExamples?: string[];
}

/**
 * The pattern registry. Initial seed set is grounded in the learner's real
 * coach history (see docs/odd/learner-model-v2.md and the legacy logs):
 *
 * - `since-vs-for`: "since three years" → "for three years"
 * - `article-the`: dropped or misselected definite/indefinite articles
 * - `missing-apostrophe`: "lets go" → "let's go"
 * - `web-locals`: real tip "web locals" → "web apps locally" (collocation)
 * - `third-person-s`: "he go" → "he goes"
 * - `irregular-past-simple`: "I goed" → "I went"
 *
 * Quality over quantity: each entry needs a real, observed mistake behind it.
 */
const REGISTRY: readonly TaxonomyPattern[] = [
  {
    patternId: "since-vs-for",
    category: "grammar",
    subcategory: "prepositions",
    description: "Uses 'since' with a duration instead of 'for' (e.g. 'since three years' → 'for three years').",
    canonicalExamples: ["since three years → for three years"],
  },
  {
    patternId: "article-the",
    category: "grammar",
    subcategory: "articles",
    description: "Drops or misselects definite/indefinite articles (e.g. 'a apple' → 'an apple').",
    canonicalExamples: ["a apple → an apple", "I went to cinema → I went to the cinema"],
  },
  {
    patternId: "missing-apostrophe",
    category: "grammar",
    subcategory: "punctuation",
    description: "Omits the apostrophe in contractions (e.g. 'lets' → 'let's', 'dont' → 'don't').",
    canonicalExamples: ["lets go → let's go", "dont know → don't know"],
  },
  {
    patternId: "web-locals",
    category: "naturalness",
    subcategory: "collocation",
    description: "Non-idiomatic compression 'web locals' for apps executed locally; prefer 'web apps locally'.",
    canonicalExamples: ["web locals → web apps locally"],
  },
  {
    patternId: "third-person-s",
    category: "grammar",
    subcategory: "agreement",
    description: "Drops the third-person singular -s in the present simple (e.g. 'he go' → 'he goes').",
    canonicalExamples: ["he go → he goes", "she like → she likes"],
  },
  {
    patternId: "irregular-past-simple",
    category: "grammar",
    subcategory: "tense",
    description: "Regularizes irregular past forms (e.g. 'I goed' → 'I went').",
    canonicalExamples: ["I goed → I went", "she taked → she took"],
  },
];

const REGISTRY_BY_ID: ReadonlyMap<string, TaxonomyPattern> = new Map(
  REGISTRY.map((pattern) => [pattern.patternId, pattern]),
);

// Load-time sanity check: a curated registry must never reference a category
// or subcategory outside its own closed lists. This throws on developer error,
// not on classifier output.
for (const pattern of REGISTRY) {
  if (!TAXONOMY_CATEGORIES.includes(pattern.category)) {
    throw new Error(`Pattern ${pattern.patternId} references unknown category ${pattern.category}`);
  }
  if (pattern.subcategory !== undefined && !TAXONOMY_SUBCATEGORIES[pattern.category].includes(pattern.subcategory)) {
    throw new Error(`Pattern ${pattern.patternId} references unknown subcategory ${pattern.subcategory}`);
  }
}

/** Look up one pattern by id, or undefined when the id is not in the registry. */
export function getPattern(patternId: string): TaxonomyPattern | undefined {
  return REGISTRY_BY_ID.get(patternId);
}

/** All registry ids in definition order (the classifier's closed choice list). */
export function listPatternIds(): readonly string[] {
  return REGISTRY.map((pattern) => pattern.patternId);
}

/** True only when the id exists in the registry. */
export function isValidPattern(patternId: string): boolean {
  return REGISTRY_BY_ID.has(patternId);
}

/** Category of a registry pattern, or undefined for unknown ids. */
export function categoryOf(patternId: string): TaxonomyCategory | undefined {
  return REGISTRY_BY_ID.get(patternId)?.category;
}
