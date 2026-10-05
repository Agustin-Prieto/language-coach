/**
 * Typed event factories for mistake-related events.
 *
 * Validation happens HERE, at the event-creation boundary — never inside the
 * pure reducers (docs/odd/learner-model-v2.md: "Reducers stay pure and
 * total"). A factory either returns a fully valid event (or, for
 * uncategorized detections, a pending-store proposal) or throws a typed
 * error, so an invalid event can never reach the append-only store.
 *
 * Timestamps are always injected by the caller. Factories never read clocks,
 * env vars, or the filesystem.
 */

import { truncateRejectionSummary, AnalysisRejectedPayloadSchema, type AnalysisRejection } from "../analysis/schema.js";
import { getPattern } from "../taxonomy/catalog.js";
import { EventSchemaVersion, type AnalysisRejectedEvent, type MistakeCorrectedEvent, type MistakeDetectedEvent } from "./types.js";

/** Base class for all factory errors; catch the family with this. */
export class EventFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventFactoryError";
  }
}

/** A patternId that is not in the closed taxonomy registry. */
export class UnknownPatternError extends EventFactoryError {
  constructor(patternId: string) {
    super(`Unknown patternId: ${patternId} (not in taxonomy registry; canonicalize proposals through code review)`);
    this.name = "UnknownPatternError";
  }
}

/** Structurally invalid factory input (missing fields, bad timestamp, ...). */
export class InvalidEventInputError extends EventFactoryError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEventInputError";
  }
}

type Severity = "low" | "medium" | "high";

/** Discriminated input mirroring the classifier's closed output union. */
export type MistakeDetectedInput =
  | {
      verdict: "classified";
      /** Must exist in the taxonomy registry, or the factory throws. */
      patternId: string;
      severity: Severity;
      original: string;
      corrected: string;
      timestamp: string;
    }
  | {
      verdict: "uncategorized";
      /** Raw proposal text; whitespace-only is rejected. */
      proposedPattern: string;
      original: string;
      timestamp: string;
    };

/**
 * Result of recording a detected mistake:
 * - `event`: a valid `mistake_detected` event for the store.
 * - `pending-proposal`: the mistake matched no registry pattern; it must NOT
 *   become a mistake event (closed-vocabulary rule — non-catalog mistakes
 *   never create mistake profiles). The adapter appends the proposal to the
 *   pending store instead; canonicalization happens via a later code commit.
 */
export type MistakeDetectedResult =
  | { kind: "event"; event: MistakeDetectedEvent }
  | { kind: "pending-proposal"; proposal: { proposedPattern: string; proposedAt: string } };

/**
 * Build a `mistake_detected` event from a classified output (category and
 * subcategory come from the catalog lookup, never from the classifier), or
 * route an uncategorized-with-proposedPattern output to the pending store.
 * Uncategorized without a proposal is invalid input here: there is no
 * actionable mistake to record. Throws typed errors on invalid input.
 */
export function makeMistakeDetected(input: MistakeDetectedInput): MistakeDetectedResult {
  assertValidTimestamp(input.timestamp);
  if (input.verdict === "classified") {
    const pattern = getPattern(input.patternId);
    if (!pattern) throw new UnknownPatternError(input.patternId);
    assertNonEmpty("original", input.original);
    assertNonEmpty("corrected", input.corrected);
    const event: MistakeDetectedEvent = {
      schemaVersion: EventSchemaVersion,
      type: "mistake_detected",
      timestamp: input.timestamp,
      patternId: pattern.patternId,
      category: pattern.category,
      ...(pattern.subcategory !== undefined ? { subcategory: pattern.subcategory } : {}),
      severity: input.severity,
      original: input.original,
      correction: input.corrected,
    };
    return { kind: "event", event };
  }
  assertNonEmpty("original", input.original);
  const proposedPattern = input.proposedPattern.trim();
  if (proposedPattern === "") {
    throw new InvalidEventInputError(
      "uncategorized detection requires a non-empty proposedPattern to route to the pending store",
    );
  }
  return { kind: "pending-proposal", proposal: { proposedPattern, proposedAt: input.timestamp } };
}

/** Build a `mistake_corrected` event; category comes from the catalog lookup. */
export function makeMistakeCorrected(input: { patternId: string; timestamp: string }): MistakeCorrectedEvent {
  assertValidTimestamp(input.timestamp);
  const pattern = getPattern(input.patternId);
  if (!pattern) throw new UnknownPatternError(input.patternId);
  return {
    schemaVersion: EventSchemaVersion,
    type: "mistake_corrected",
    timestamp: input.timestamp,
    patternId: pattern.patternId,
    category: pattern.category,
  };
}

/**
 * Build an `analysis_rejected` event from a classifier-boundary rejection.
 * The reason must be a closed reason code and the summary is truncated to a
 * deterministic bound, so no unbounded text ever enters the store.
 */
export function makeAnalysisRejected(rejection: AnalysisRejection, timestamp: string): AnalysisRejectedEvent {
  assertValidTimestamp(timestamp);
  const summary = truncateRejectionSummary(rejection.summary);
  const parsed = AnalysisRejectedPayloadSchema.safeParse({ reason: rejection.reason, summary });
  if (!parsed.success) {
    throw new InvalidEventInputError(`Invalid analysis rejection payload: ${parsed.error.message}`);
  }
  return {
    schemaVersion: EventSchemaVersion,
    type: "analysis_rejected",
    timestamp,
    reason: parsed.data.reason,
    summary: parsed.data.summary,
  };
}

function assertValidTimestamp(value: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new InvalidEventInputError(`timestamp must be an ISO 8601 string, got: ${String(value)}`);
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidEventInputError(`${field} must be a non-empty string`);
  }
}
