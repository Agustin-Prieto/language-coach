/**
 * Zod schemas for the classifier boundary (docs/odd/learner-model-v2.md,
 * "Closed-vocabulary classification").
 *
 * zod is the engine package's FIRST and only runtime dependency. The
 * architecture doc mandates zod validation at the classifier boundary: the
 * LLM may return anything, and every byte of it must pass through these
 * schemas before it can influence the model. Nothing else in the engine
 * parses untrusted shapes.
 *
 * Event `schemaVersion` stays 1: these schemas validate classifier IO and
 * rejection payloads, not the event-log format.
 */

import { z } from "zod";

import { CATALOG_VERSION, isValidPattern } from "../taxonomy/catalog.js";

// ---------------------------------------------------------------------------
// Classifier input
// ---------------------------------------------------------------------------

export const ClassifierInputSchema = z.object({
  /** The learner message text that passed the host's deterministic gate. */
  text: z.string().min(1),
  /** Language the learner is practicing. */
  targetLanguage: z.string().min(1),
  /** The learner's native language, when the host knows it. */
  nativeLanguage: z.string().min(1).optional(),
  /** Optional hint of currently active pattern ids (closed-vocabulary ids). */
  activePatternIds: z.array(z.string().min(1)).optional(),
});

export type ClassifierInput = z.infer<typeof ClassifierInputSchema>;

// ---------------------------------------------------------------------------
// Classifier output — discriminated union
// ---------------------------------------------------------------------------

export const SeveritySchema = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ConfidenceSchema = z.number().min(0).max(1);

const ClassifiedOutputSchema = z
  .object({
    verdict: z.literal("classified"),
    /** Must be one of the registry's ids; validated against the catalog below. */
    patternId: z.string().min(1),
    severity: SeveritySchema,
    /** The incorrect text produced by the learner. */
    original: z.string().min(1),
    corrected: z.string().min(1).optional(),
    spanStart: z.number().int().nonnegative().optional(),
    spanEnd: z.number().int().nonnegative().optional(),
    confidence: ConfidenceSchema,
  })
  .strict();

const UncategorizedOutputSchema = z
  .object({
    verdict: z.literal("uncategorized"),
    /** Raw proposal text for the pending store; empty/whitespace-only is invalid. */
    proposedPattern: z.string().trim().min(1).optional(),
    original: z.string().min(1),
    confidence: ConfidenceSchema,
  })
  .strict();

export const ClassifierOutputSchema = z
  .discriminatedUnion("verdict", [ClassifiedOutputSchema, UncategorizedOutputSchema])
  .superRefine((value, ctx) => {
    // Closed-vocabulary rule: a stale catalog or a hallucinated id is a typed
    // rejection at parse time, never a crash and never a silent pass-through.
    if (value.verdict === "classified" && !isValidPattern(value.patternId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["patternId"],
        message: `Unknown patternId: ${value.patternId} (not in taxonomy catalog v${CATALOG_VERSION})`,
      });
    }
    if (value.verdict === "classified") {
      const { spanStart, spanEnd } = value;
      if (spanStart !== undefined && spanEnd !== undefined && spanEnd < spanStart) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["spanEnd"],
          message: `spanEnd (${spanEnd}) must be >= spanStart (${spanStart})`,
        });
      }
    }
  });

export type ClassifiedOutput = z.infer<typeof ClassifiedOutputSchema>;
export type UncategorizedOutput = z.infer<typeof UncategorizedOutputSchema>;
export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

// ---------------------------------------------------------------------------
// Rejection payload for the analysis_rejected event
// ---------------------------------------------------------------------------

/** Closed reason-code list for rejected analyses. */
export const AnalysisReasonCodes = ["schema_mismatch", "unknown_pattern", "missing_fields", "port_error"] as const;
export type AnalysisReasonCode = (typeof AnalysisReasonCodes)[number];

/** Rejection summaries are truncated to this many characters, deterministically. */
export const MAX_REJECTION_SUMMARY_CHARS = 300;

export const AnalysisRejectedPayloadSchema = z.object({
  reason: z.enum(AnalysisReasonCodes),
  /** Truncated, deterministic error summary. Never unbounded or empty text. */
  summary: z.string().min(1).max(MAX_REJECTION_SUMMARY_CHARS),
});

export interface AnalysisRejection {
  reason: AnalysisReasonCode;
  summary: string;
}

/**
 * Deterministic, bounded summary of a raw error: single line, hard length
 * cap. Same input always yields the same summary, so rejection events are
 * safe to store, diff, and audit.
 */
export function truncateRejectionSummary(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length <= MAX_REJECTION_SUMMARY_CHARS ? oneLine : oneLine.slice(0, MAX_REJECTION_SUMMARY_CHARS);
}
