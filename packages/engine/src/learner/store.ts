/**
 * Append-only JSONL event store and snapshot IO.
 *
 * Hard boundary rules (docs/odd/learner-model-v2.md): no network, no
 * `process.env` access, no hardcoded paths — the directory is injected by the
 * host adapter. The default storage location (`~/.pi/agent/language-coach/`)
 * is an adapter concern, never an engine one.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { EventSchemaVersion, type LanguageEvent } from "../events/types.js";
import type { LearnerModel } from "../learner/types.js";

export const EVENTS_FILE = "events.jsonl";
export const SNAPSHOT_FILE = "learner.json";

export interface ReadEventsResult {
  events: LanguageEvent[];
  /** Lines that could not be parsed as valid events. */
  skippedMalformedLines: number;
}

export interface EventStore {
  /** Directory the store operates in (injected by the caller). */
  dir: string;
  /** Appends one event as a single JSON line, creating the file if missing. */
  append(event: LanguageEvent): Promise<void>;
  /** Reads and parses all events; malformed lines are skipped and counted. */
  readEvents(): Promise<ReadEventsResult>;
}

/** Create an event store rooted at the injected directory. */
export function createEventStore(dir: string): EventStore {
  const eventsPath = path.join(dir, EVENTS_FILE);
  return {
    dir,
    async append(event: LanguageEvent): Promise<void> {
      await mkdir(dir, { recursive: true });
      await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
    },
    async readEvents(): Promise<ReadEventsResult> {
      let raw: string;
      try {
        raw = await readFile(eventsPath, "utf8");
      } catch (err) {
        if (isNotFoundError(err)) return { events: [], skippedMalformedLines: 0 };
        throw err;
      }
      const events: LanguageEvent[] = [];
      let skippedMalformedLines = 0;
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") continue; // blank lines are ignored, not malformed
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (isValidEvent(parsed)) {
            events.push(parsed);
          } else {
            skippedMalformedLines++;
          }
        } catch {
          skippedMalformedLines++;
        }
      }
      return { events, skippedMalformedLines };
    },
  };
}

/** Write the derived model as `learner.json` (a cache, never the source of truth). */
export async function writeSnapshot(dir: string, model: LearnerModel): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, SNAPSHOT_FILE), `${JSON.stringify(model, null, 2)}\n`, "utf8");
}

/** The snapshot (model) version this engine writes and reads. Matches `LearnerModel["version"]`. */
export const SNAPSHOT_VERSION = 2;

/**
 * Thrown when `learner.json` exists but its `version` is not supported.
 * Mismatched snapshots are never silently loaded: rebuild from `events.jsonl`
 * instead.
 */
export class SnapshotVersionError extends Error {
  readonly foundVersion: unknown;

  constructor(foundVersion: unknown) {
    const found = JSON.stringify(foundVersion) ?? String(foundVersion);
    super(
      `unsupported learner snapshot version: found ${found}, supported ${SNAPSHOT_VERSION} — refusing to load; rebuild from ${EVENTS_FILE} instead`,
    );
    this.name = "SnapshotVersionError";
    this.foundVersion = foundVersion;
  }
}

/** Read `learner.json`; returns null when no snapshot exists. */
export async function readSnapshot(dir: string): Promise<LearnerModel | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, SNAPSHOT_FILE), "utf8");
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new SnapshotVersionError(parsed);
  }
  if ((parsed as Record<string, unknown>).version !== SNAPSHOT_VERSION) {
    throw new SnapshotVersionError((parsed as Record<string, unknown>).version);
  }
  return parsed as LearnerModel;
}

/** Structural minimum for a line to count as an event, not as malformed. */
function isValidEvent(value: unknown): value is LanguageEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === EventSchemaVersion &&
    typeof record.type === "string" &&
    typeof record.timestamp === "string"
  );
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT";
}
