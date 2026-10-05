import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { fold } from "../src/engine/fold.js";
import { createEventStore, readSnapshot, writeSnapshot } from "../src/learner/store.js";
import { NOW, T0, corrected, detected, reviewed, vocabUsed } from "./helpers.js";

const SEED = { languagePair: { native: "Spanish", target: "English" } };

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lc-engine-"));
  tempDirs.push(dir);
  return dir;
}

describe("event store", () => {
  it("round-trips: append → read → fold → snapshot → read snapshot", async () => {
    const dir = await tempDir();
    const store = createEventStore(dir);
    const events = [detected("article-the"), corrected("article-the"), vocabUsed("keen", true), reviewed("article-the", true)];
    for (const event of events) {
      await store.append(event);
    }

    const read = await store.readEvents();
    expect(read.events).toEqual(events);
    expect(read.skippedMalformedLines).toBe(0);

    const model = fold(read.events, NOW, SEED);
    await writeSnapshot(dir, model);
    const loaded = await readSnapshot(dir);
    expect(loaded).toEqual(model);
    expect(loaded!.mistakes["article-the"]!.occurrences).toBe(2);
    expect(loaded!.vocabulary["keen"]!.usageCount).toBe(1);
  });

  it("creates the file and directory on first append", async () => {
    const dir = join(await tempDir(), "nested", "store");
    const store = createEventStore(dir);
    await store.append(detected("p"));
    const read = await store.readEvents();
    expect(read.events).toHaveLength(1);
    expect(read.events[0]!.type).toBe("mistake_detected");
  });

  it("returns an empty result when no events file exists", async () => {
    const store = createEventStore(await tempDir());
    const read = await store.readEvents();
    expect(read.events).toEqual([]);
    expect(read.skippedMalformedLines).toBe(0);
  });

  it("skips and counts malformed lines instead of failing", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "events.jsonl"),
      [
        JSON.stringify(detected("article-the")),
        "not json at all",
        JSON.stringify({ type: "mistake_detected", timestamp: T0 }), // missing schemaVersion
        "",
        JSON.stringify({ schemaVersion: 1 }), // missing type and timestamp
        JSON.stringify(corrected("article-the")),
        JSON.stringify([]), // not an object
      ].join("\n"),
      "utf8",
    );

    const store = createEventStore(dir);
    const read = await store.readEvents();
    expect(read.events.map((event) => event.type)).toEqual(["mistake_detected", "mistake_corrected"]);
    expect(read.skippedMalformedLines).toBe(4);
  });

  it("tolerates garbage appended after valid events", async () => {
    const dir = await tempDir();
    const store = createEventStore(dir);
    await store.append(vocabUsed("keen", true));
    await appendFile(join(dir, "events.jsonl"), "\ntruncated line\n", "utf8");
    const read = await store.readEvents();
    expect(read.events).toHaveLength(1);
    expect(read.skippedMalformedLines).toBe(1);
  });
});

describe("snapshot IO", () => {
  it("returns null when no snapshot exists", async () => {
    expect(await readSnapshot(await tempDir())).toBeNull();
  });

  it("creates the directory when writing a snapshot", async () => {
    const dir = join(await tempDir(), "snap");
    await writeSnapshot(dir, fold([], NOW, SEED));
    expect(await readSnapshot(dir)).not.toBeNull();
  });
});
