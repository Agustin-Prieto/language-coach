/**
 * Pending-pattern store: the queue between classifier proposals and the
 * versioned registry (taxonomy/catalog.ts).
 *
 * Flow (docs/odd/learner-model-v2.md, "Closed-vocabulary classification"):
 * the classifier proposes raw pattern text via `uncategorized` outputs; the
 * host adapter appends it here. A human later canonicalizes an entry into the
 * registry through a code-review commit bumping `CATALOG_VERSION`.
 *
 * `canonicalize` therefore only removes the entry from the pending store and
 * returns a registry-ready record: it NEVER mutates the catalog, which is
 * code data. Deduplication uses a normalized pattern key so repeated
 * proposals of the same mistake accumulate occurrence counts instead of
 * duplicate lines.
 *
 * Boundary rules: the directory is injected by the host adapter; no
 * `process.env`, no hardcoded paths, no network. Timestamps are injected by
 * the caller, never read from a clock.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { TAXONOMY_CATEGORIES, type TaxonomyCategory } from "./catalog.js";

export const PENDING_FILE = "pending-patterns.jsonl";

/** One accumulated pending proposal, keyed by its normalized pattern key. */
export interface PendingProposal {
  /** Normalized pattern key; stable dedup identity. */
  id: string;
  /** Raw proposed text as first seen (whitespace/case preserved). */
  proposedPattern: string;
  occurrences: number;
  firstProposedAt: string;
  lastProposedAt: string;
}

/** Input for appending a proposal; the timestamp is injected by the caller. */
export interface PendingProposalInput {
  proposedPattern: string;
  /** ISO 8601 instant of the proposal; injected, never read from a clock. */
  proposedAt: string;
}

/** Human-supplied classification for canonicalization into the registry. */
export interface CanonicalPatternInput {
  category: TaxonomyCategory;
  subcategory?: string;
  description: string;
  canonicalExamples?: string[];
}

/** Registry-ready record produced by `canonicalize`. */
export interface RegistryCandidate extends CanonicalPatternInput {
  /** Normalized key; a human may rename it in the canonicalization commit. */
  patternId: string;
  occurrences: number;
  firstProposedAt: string;
  lastProposedAt: string;
  /** ISO 8601 instant of canonicalization; injected by the caller. */
  canonicalizedAt: string;
}

export class PendingStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingStoreError";
  }
}

/** The proposal id is not in the pending store. */
export class UnknownPendingProposalError extends PendingStoreError {
  constructor(id: string) {
    super(`Unknown pending proposal id: ${id}`);
    this.name = "UnknownPendingProposalError";
  }
}

/** Malformed proposal input or invalid canonical pattern input. */
export class InvalidProposalError extends PendingStoreError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProposalError";
  }
}

export interface PendingStore {
  /** Directory the store operates in (injected by the caller). */
  dir: string;
  /**
   * Append a proposal. Deduplicates by normalized pattern key: a new key
   * appends one JSONL line; an existing key updates its line in place,
   * bumping `occurrences` and `lastProposedAt`.
   */
  append(proposal: PendingProposalInput): Promise<PendingProposal>;
  /** All pending proposals, in file order. Malformed lines are skipped. */
  list(): Promise<PendingProposal[]>;
  /**
   * Remove the entry and return the registry-ready record for the human
   * canonicalization commit. Throws `UnknownPendingProposalError` for an
   * unknown id and `InvalidProposalError` for a pattern outside the closed
   * taxonomy lists. Never mutates the catalog.
   */
  canonicalize(id: string, pattern: CanonicalPatternInput, canonicalizedAt: string): Promise<RegistryCandidate>;
}

/** Normalize a raw proposal into a stable dedup key. */
export function normalizePatternKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Create a pending-pattern store rooted at the injected directory. */
export function createPendingStore(dir: string): PendingStore {
  const filePath = path.join(dir, PENDING_FILE);

  async function readAll(): Promise<PendingProposal[]> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return [];
    }
    const proposals: PendingProposal[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isValidProposal(parsed)) proposals.push(parsed);
      } catch {
        // Malformed lines are skipped, mirroring the event store.
      }
    }
    return proposals;
  }

  async function writeAll(proposals: PendingProposal[]): Promise<void> {
    await mkdir(dir, { recursive: true });
    const body = proposals.map((proposal) => JSON.stringify(proposal)).join("\n");
    const content = proposals.length > 0 ? `${body}\n` : "";
    await writeFile(filePath, content, "utf8");
  }

  return {
    dir,
    async append(proposal: PendingProposalInput): Promise<PendingProposal> {
      const proposedPattern = proposal.proposedPattern.trim();
      if (proposedPattern === "") throw new InvalidProposalError("proposedPattern must be non-empty");
      if (!isValidTimestamp(proposal.proposedAt)) {
        throw new InvalidProposalError(`proposedAt must be an ISO 8601 timestamp, got: ${proposal.proposedAt}`);
      }
      const id = normalizePatternKey(proposedPattern);
      if (id === "") throw new InvalidProposalError("proposedPattern must contain non-whitespace characters");
      const proposals = await readAll();
      const existing = proposals.find((candidate) => candidate.id === id);
      if (existing) {
        existing.occurrences += 1;
        existing.lastProposedAt = proposal.proposedAt;
        await writeAll(proposals);
        return { ...existing };
      }
      const created: PendingProposal = {
        id,
        proposedPattern,
        occurrences: 1,
        firstProposedAt: proposal.proposedAt,
        lastProposedAt: proposal.proposedAt,
      };
      proposals.push(created);
      await writeAll(proposals);
      return { ...created };
    },
    async list(): Promise<PendingProposal[]> {
      return readAll();
    },
    async canonicalize(id: string, pattern: CanonicalPatternInput, canonicalizedAt: string): Promise<RegistryCandidate> {
      if (!isValidTimestamp(canonicalizedAt)) {
        throw new InvalidProposalError(`canonicalizedAt must be an ISO 8601 timestamp, got: ${canonicalizedAt}`);
      }
      if (!TAXONOMY_CATEGORIES.includes(pattern.category)) {
        throw new InvalidProposalError(`Unknown taxonomy category: ${String(pattern.category)}`);
      }
      if (pattern.description.trim() === "") {
        throw new InvalidProposalError("description must be non-empty");
      }
      const proposals = await readAll();
      const index = proposals.findIndex((candidate) => candidate.id === normalizePatternKey(id));
      if (index === -1) throw new UnknownPendingProposalError(id);
      const [removed] = proposals.splice(index, 1);
      await writeAll(proposals);
      return {
        ...pattern,
        patternId: removed.id,
        occurrences: removed.occurrences,
        firstProposedAt: removed.firstProposedAt,
        lastProposedAt: removed.lastProposedAt,
        canonicalizedAt,
      };
    },
  };
}

function isValidProposal(value: unknown): value is PendingProposal {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.proposedPattern === "string" &&
    typeof candidate.occurrences === "number" &&
    typeof candidate.firstProposedAt === "string" &&
    typeof candidate.lastProposedAt === "string"
  );
}

function isValidTimestamp(value: string): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
