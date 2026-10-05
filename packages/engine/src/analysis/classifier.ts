/**
 * Classifier port and the boundary wrapper.
 *
 * The engine NEVER calls an LLM (docs/odd/learner-model-v2.md, hard boundary
 * rules). Hosts — the Pi extension, the web app — implement `ClassifierPort`
 * with their own model access. The engine owns only the contract: output is
 * zod-validated against the closed taxonomy, and any failure becomes a
 * deterministic `AnalysisRejection` that the adapter records as an
 * `analysis_rejected` event. `classifyWithPort` never throws to the caller.
 */

import {
  ClassifierOutputSchema,
  truncateRejectionSummary,
  type AnalysisReasonCode,
  type AnalysisRejection,
  type ClassifierInput,
  type ClassifierOutput,
} from "./schema.js";
import type { z } from "zod";

/** Implemented by the host; returns an arbitrary, untrusted payload. */
export interface ClassifierPort {
  classify(input: ClassifierInput): Promise<unknown>;
}

export type ClassificationResult =
  | { ok: true; classification: ClassifierOutput }
  | { ok: false; rejection: AnalysisRejection };

/**
 * Call the port and validate its result against the closed taxonomy.
 *
 * Reason-code mapping (deterministic):
 * - the port throws (Error or not)                    → `port_error`
 * - a required field is absent (zod received undefined) → `missing_fields`
 * - the classified branch carries an unknown patternId → `unknown_pattern`
 * - everything else (wrong types, bad verdict, out-of-bounds
 *   confidence, non-object payloads)                   → `schema_mismatch`
 *
 * `unknown_pattern` wins over other issues because the closed-vocabulary
 * violation is the most specific diagnosis.
 */
export async function classifyWithPort(port: ClassifierPort, input: ClassifierInput): Promise<ClassificationResult> {
  let raw: unknown;
  try {
    raw = await port.classify(input);
  } catch (error) {
    return { ok: false, rejection: rejection("port_error", describeError(error)) };
  }
  const parsed = ClassifierOutputSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, classification: parsed.data };
  }
  // zod reports a missing discriminant as `invalid_union`, not as a missing
  // field; an object without `verdict` is deterministically missing_fields.
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && !("verdict" in raw)) {
    return { ok: false, rejection: rejection("missing_fields", parsed.error.message) };
  }
  return { ok: false, rejection: rejection(reasonFromZodError(parsed.error), parsed.error.message) };
}

function rejection(reason: AnalysisReasonCode, rawSummary: string): AnalysisRejection {
  return { reason, summary: truncateRejectionSummary(rawSummary) };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function reasonFromZodError(error: z.ZodError): AnalysisReasonCode {
  const issues = error.issues;
  const unknownPattern = issues.find((issue) => issue.path.includes("patternId") && issue.message.startsWith("Unknown patternId"));
  if (unknownPattern) return "unknown_pattern";
  const missingField = issues.find((issue) => issue.code === "invalid_type" && issue.received === "undefined");
  if (missingField) return "missing_fields";
  return "schema_mismatch";
}
