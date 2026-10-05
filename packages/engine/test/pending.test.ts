import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CATALOG_VERSION,
  getPattern,
  isValidPattern,
  listPatternIds,
} from "../src/taxonomy/catalog.js";
import {
  InvalidProposalError,
  PendingStoreError,
  UnknownPendingProposalError,
  createPendingStore,
  normalizePatternKey,
} from "../src/taxonomy/pending.js";

const T0 = "2025-01-15T10:00:00.000Z";

const dirs: string[] = [];

async function makeStoreDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lc-pending-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  // Temp dirs live under the OS tmpdir; leaving them is harmless, but tests
  // never write outside them.
  dirs.length = 0;
});

describe("normalizePatternKey", () => {
  it("is deterministic and whitespace/case insensitive", () => {
    expect(normalizePatternKey("  Web   LOCALS ")).toBe("web locals");
    expect(normalizePatternKey("web locals")).toBe("web locals");
  });
});

describe("pending store", () => {
  it("appends a proposal and lists it back", async () => {
    const store = createPendingStore(await makeStoreDir());
    await store.append({ proposedPattern: "web locals", proposedAt: T0 });
    const proposals = await store.list();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: "web locals",
      proposedPattern: "web locals",
      occurrences: 1,
      firstProposedAt: T0,
      lastProposedAt: T0,
    });
  });

  it("dedups by normalized key, bumping occurrences and lastProposedAt", async () => {
    const store = createPendingStore(await makeStoreDir());
    const first = await store.append({ proposedPattern: "Web locals", proposedAt: T0 });
    const second = await store.append({ proposedPattern: "web  locals", proposedAt: "2025-01-16T09:00:00.000Z" });
    expect(first.id).toBe(second.id);
    const proposals = await store.list();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: "web locals",
      occurrences: 2,
      firstProposedAt: T0,
      lastProposedAt: "2025-01-16T09:00:00.000Z",
    });
  });

  it("persists proposals across store instances (injected dir)", async () => {
    const dir = await makeStoreDir();
    await createPendingStore(dir).append({ proposedPattern: "since vs for", proposedAt: T0 });
    const reread = await createPendingStore(dir).list();
    expect(reread).toHaveLength(1);
    expect(reread[0].id).toBe("since vs for");
  });

  it("skips malformed JSONL lines when listing", async () => {
    const dir = await makeStoreDir();
    await writeFile(
      path.join(dir, "pending-patterns.jsonl"),
      `not json\n${JSON.stringify({ id: "web locals", proposedPattern: "web locals", occurrences: 1, firstProposedAt: T0, lastProposedAt: T0 })}\n`,
      "utf8",
    );
    const proposals = await createPendingStore(dir).list();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].id).toBe("web locals");
  });

  it("rejects empty or timestamp-less proposals with a typed error", async () => {
    const store = createPendingStore(await makeStoreDir());
    await expect(store.append({ proposedPattern: "   ", proposedAt: T0 })).rejects.toBeInstanceOf(
      InvalidProposalError,
    );
    await expect(store.append({ proposedPattern: "x", proposedAt: "not-a-date" })).rejects.toBeInstanceOf(
      InvalidProposalError,
    );
  });
});

describe("canonicalize", () => {
  it("removes the entry and returns a registry-ready record with provenance", async () => {
    const store = createPendingStore(await makeStoreDir());
    await store.append({ proposedPattern: "web locals", proposedAt: T0 });
    await store.append({ proposedPattern: "web locals", proposedAt: "2025-01-16T09:00:00.000Z" });
    const candidate = await store.canonicalize(
      "web locals",
      { category: "naturalness", subcategory: "collocation", description: "Use 'web apps' with a plural noun." },
      "2025-01-20T12:00:00.000Z",
    );
    expect(candidate).toMatchObject({
      patternId: "web locals",
      category: "naturalness",
      subcategory: "collocation",
      occurrences: 2,
      firstProposedAt: T0,
      lastProposedAt: "2025-01-16T09:00:00.000Z",
      canonicalizedAt: "2025-01-20T12:00:00.000Z",
    });
    expect(await store.list()).toHaveLength(0);
  });

  it("rejects unknown ids with a typed error", async () => {
    const store = createPendingStore(await makeStoreDir());
    await expect(
      store.canonicalize("ghost", { category: "grammar", description: "..." }, T0),
    ).rejects.toBeInstanceOf(UnknownPendingProposalError);
    await expect(
      store.canonicalize("ghost", { category: "grammar", description: "..." }, T0),
    ).rejects.toBeInstanceOf(PendingStoreError);
  });

  it("rejects invalid taxonomy categories with a typed error", async () => {
    const store = createPendingStore(await makeStoreDir());
    await store.append({ proposedPattern: "web locals", proposedAt: T0 });
    await expect(
      store.canonicalize("web locals", { category: "style" as never, description: "..." }, T0),
    ).rejects.toBeInstanceOf(InvalidProposalError);
    // Entry survives a failed canonicalization.
    expect(await store.list()).toHaveLength(1);
  });

  it("does NOT mutate the catalog: canonicalization happens in a later code commit", async () => {
    const store = createPendingStore(await makeStoreDir());
    await store.append({ proposedPattern: "brand new pattern", proposedAt: T0 });
    const idsBefore = [...listPatternIds()];
    await store.canonicalize(
      "brand new pattern",
      { category: "grammar", subcategory: "articles", description: "Fresh pattern." },
      T0,
    );
    expect(CATALOG_VERSION).toBe(1);
    expect([...listPatternIds()]).toEqual(idsBefore);
    expect(isValidPattern("brand new pattern")).toBe(false);
    expect(getPattern("brand new pattern")).toBeUndefined();
  });
});
