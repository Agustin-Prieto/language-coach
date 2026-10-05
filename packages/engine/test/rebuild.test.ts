import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { rebuildEvents, rebuildSnapshot } from "../src/learner/rebuild.js";
import { SNAPSHOT_FILE, SnapshotVersionError, readSnapshot, writeSnapshot } from "../src/learner/store.js";
import { importLegacyLogs } from "../src/legacy/import.js";
import { NOW, detected, vocabUsed } from "./helpers.js";

const SEED = { languagePair: { native: "Spanish", target: "English" } };

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lc-engine-rebuild-"));
  tempDirs.push(dir);
  return dir;
}

const LEGACY_INPUT = {
  seed: SEED,
  logs: '{"ts":"2025-01-15T10:00:00.000Z","kind":"correction","native":"Spanish","target":"English","line":"I have 25 years"}',
  vocabCaptures: [
    '{"ts":"2025-01-14T09:00:00.000Z","phrase":"when you have a minute","translation":"cuando tengas un minuto","source":"translation"}',
    '{"ts":"2025-01-16T09:00:00.000Z","phrase":"take a look at","translation":"revisar","source":"translation"}',
  ].join("\n"),
  vocabReviews: [
    '{"ts":"2025-01-15T10:02:00.000Z","phrase":"when you have a minute","correct":true}',
    '{"ts":"2025-01-15T10:08:00.000Z","phrase":"take a look at","correct":false}',
  ].join("\n"),
};

describe("rebuildEvents", () => {
  it("folds imported legacy events into a model with expected vocabulary counts", () => {
    const { events } = importLegacyLogs(LEGACY_INPUT);
    const model = rebuildEvents(events, SEED);

    expect(model.version).toBe(2);
    expect(model.languagePair).toEqual(SEED.languagePair);
    // Vocabulary reviews arrive as drill_completed(kind: vocabulary): each
    // review counts as one (possibly incorrect) usage of the phrase.
    expect(model.vocabulary["when you have a minute"]).toMatchObject({
      usageCount: 1,
      correctUses: 1,
      status: "learning",
    });
    expect(model.vocabulary["take a look at"]).toMatchObject({
      usageCount: 1,
      correctUses: 0,
      status: "new",
    });
    expect(model.updatedAt).toBe("2025-01-16T09:00:00.000Z"); // latest event timestamp
  });

  it("sorts out-of-order events before folding", () => {
    const late = detected("article-the", "articles", "2025-03-01T10:00:00.000Z");
    const early = vocabUsed("keen", true, "2025-01-01T10:00:00.000Z");
    const reversed = rebuildEvents([late, early], SEED);
    const ordered = rebuildEvents([early, late], SEED);
    expect(reversed).toEqual(ordered);
    expect(reversed.updatedAt).toBe(late.timestamp);
  });
});

describe("rebuildSnapshot", () => {
  it("round-trips: append events → rebuild → readSnapshot equals the model", async () => {
    const dir = await tempDir();
    const { events } = importLegacyLogs(LEGACY_INPUT);
    for (const event of events) {
      await appendFile(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
    }

    const summary = await rebuildSnapshot(dir, SEED);
    expect(summary.eventCount).toBe(events.length);
    expect(summary.skippedLines).toBe(0);
    expect(summary.model).toEqual(rebuildEvents(events, SEED));

    const snapshot = await readSnapshot(dir);
    expect(snapshot).not.toBeNull();
    expect(snapshot).toEqual(summary.model);
  });

  it("counts malformed event lines as skippedLines", async () => {
    const dir = await tempDir();
    const { events } = importLegacyLogs(LEGACY_INPUT);
    const lines = [...events.map((e) => JSON.stringify(e)), "not json", "", '{"schemaVersion":1}'].join("\n");
    await writeFile(join(dir, "events.jsonl"), `${lines}\n`, "utf8");

    const summary = await rebuildSnapshot(dir, SEED);
    expect(summary.eventCount).toBe(events.length);
    // The blank line is ignored (store semantics); the two malformed lines are skipped.
    expect(summary.skippedLines).toBe(2);
  });
});

describe("snapshot version guard", () => {
  it("rejects a doctored snapshot with an unsupported version", async () => {
    const dir = await tempDir();
    await writeSnapshot(dir, rebuildEvents([detected("article-the")], SEED, NOW));

    const raw = await readFile(join(dir, SNAPSHOT_FILE), "utf8");
    const doctored = { ...JSON.parse(raw), version: 1 };
    await writeFile(join(dir, SNAPSHOT_FILE), JSON.stringify(doctored, null, 2), "utf8");

    await expect(readSnapshot(dir)).rejects.toBeInstanceOf(SnapshotVersionError);
    await expect(readSnapshot(dir)).rejects.toThrow(/version/);
  });

  it("rejects a snapshot with a missing version", async () => {
    const dir = await tempDir();
    await writeSnapshot(dir, rebuildEvents([detected("article-the")], SEED, NOW));

    const raw = await readFile(join(dir, SNAPSHOT_FILE), "utf8");
    const { version: _version, ...noVersion } = JSON.parse(raw);
    await writeFile(join(dir, SNAPSHOT_FILE), JSON.stringify(noVersion, null, 2), "utf8");

    await expect(readSnapshot(dir)).rejects.toBeInstanceOf(SnapshotVersionError);
  });

  it("still returns null when no snapshot file exists", async () => {
    const dir = await tempDir();
    expect(await readSnapshot(dir)).toBeNull();
  });
});
