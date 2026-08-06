// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  recommendPacks,
  recommendPacksFromDir,
} from "../../src/helpers/pack-recommend";
import * as registry from "../../src/helpers/registry";
import type { DetectedStack } from "../../src/helpers/stack-detect";
import { safeRmSync } from "../test-utils";

describe("recommendPacksFromDir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));
  });

  afterEach(() => {
    if (tempDir) safeRmSync(tempDir);
  });

  function createPack(
    registryDir: string,
    name: string,
    opts: { tags: string[]; adrCount: number; description?: string }
  ): void {
    const packDir = join(registryDir, "packs", name);
    const adrsDir = join(packDir, "adrs");
    mkdirSync(adrsDir, { recursive: true });

    const yaml = [
      `name: ${name}`,
      `version: 0.1.0`,
      `description: ${opts.description ?? `Test pack ${name}`}`,
      `maintainers:`,
      `  - github: testuser`,
      `tags:`,
      ...opts.tags.map((t) => `  - ${t}`),
    ].join("\n");
    writeFileSync(join(packDir, "archgate-pack.yaml"), yaml);

    for (let i = 1; i <= opts.adrCount; i++) {
      const id = `TP-${String(i).padStart(3, "0")}`;
      writeFileSync(
        join(adrsDir, `${id}-rule-${i}.md`),
        `---\nid: ${id}\ntitle: Rule ${i}\n---\n# Rule ${i}\n`
      );
    }
  }

  test("returns high relevance for language match", () => {
    createPack(tempDir, "typescript-strict", {
      tags: ["language:typescript"],
      adrCount: 4,
    });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: ["node"],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(1);
    expect(recs[0].packName).toBe("typescript-strict");
    expect(recs[0].relevance).toBe("high");
    expect(recs[0].adrCount).toBe(4);
    expect(recs[0].matchedTags).toContain("language:typescript");
  });

  test("returns medium relevance for concern tags", () => {
    createPack(tempDir, "security", {
      tags: ["concern:security"],
      adrCount: 3,
    });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: ["node"],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(1);
    expect(recs[0].packName).toBe("security");
    expect(recs[0].relevance).toBe("medium");
  });

  test("sorts high relevance before medium", () => {
    createPack(tempDir, "security", {
      tags: ["concern:security"],
      adrCount: 3,
    });
    createPack(tempDir, "typescript-strict", {
      tags: ["language:typescript"],
      adrCount: 4,
    });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: ["node"],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(2);
    expect(recs[0].relevance).toBe("high");
    expect(recs[1].relevance).toBe("medium");
  });

  test("matches framework tags with high relevance", () => {
    createPack(tempDir, "nextjs-app", {
      tags: ["framework:nextjs", "language:typescript"],
      adrCount: 3,
    });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: ["node"],
      frameworks: ["nextjs"],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(1);
    expect(recs[0].relevance).toBe("high");
    expect(recs[0].matchedTags).toContain("framework:nextjs");
    expect(recs[0].matchedTags).toContain("language:typescript");
  });

  test("excludes packs with no matching tags", () => {
    createPack(tempDir, "rust-safety", {
      tags: ["language:rust"],
      adrCount: 2,
    });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: ["node"],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(0);
  });

  test("returns empty array when no packs directory exists", () => {
    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: [],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(0);
  });

  test("counts ADR files correctly", () => {
    createPack(tempDir, "testing", { tags: ["concern:testing"], adrCount: 5 });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: [],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(1);
    expect(recs[0].adrCount).toBe(5);
  });

  test("matches runtime tags", () => {
    createPack(tempDir, "bun-best-practices", {
      tags: ["runtime:bun"],
      adrCount: 2,
    });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: ["bun"],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(1);
    expect(recs[0].relevance).toBe("high");
    expect(recs[0].matchedTags).toContain("runtime:bun");
  });

  test.each([
    ["runtime", "runtime:deno"],
    ["framework", "framework:remix"],
    ["unknown-namespace", "planet:mars"],
  ])("drops a non-matching %s tag but keeps the pack", (_kind, tag) => {
    createPack(tempDir, "mixed", {
      tags: [tag, "concern:testing"],
      adrCount: 1,
    });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: ["node"],
      frameworks: ["nextjs"],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(1);
    // Only the concern tag survives, so relevance stays medium.
    expect(recs[0].matchedTags).toEqual(["concern:testing"]);
    expect(recs[0].relevance).toBe("medium");
  });

  test("skips a pack whose metadata cannot be parsed", () => {
    createPack(tempDir, "healthy", { tags: ["concern:testing"], adrCount: 1 });
    const brokenDir = join(tempDir, "packs", "broken");
    mkdirSync(brokenDir, { recursive: true });
    // Missing every required field — parsePackMetadata throws a UserError.
    writeFileSync(join(brokenDir, "archgate-pack.yaml"), "name: 'Not Valid'\n");

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: [],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs.map((r) => r.packName)).toEqual(["healthy"]);
  });

  test("alphabetical sort within same relevance", () => {
    createPack(tempDir, "zebra", { tags: ["concern:zebra"], adrCount: 1 });
    createPack(tempDir, "alpha", { tags: ["concern:alpha"], adrCount: 1 });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: [],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(2);
    expect(recs[0].packName).toBe("alpha");
    expect(recs[1].packName).toBe("zebra");
  });
});

describe("recommendPacks", () => {
  /** Temp dirs that tests create — cleaned in afterEach as a safety net. */
  const tempDirs: string[] = [];

  afterEach(() => {
    mock.restore();
    for (const d of tempDirs) {
      if (existsSync(d)) safeRmSync(d);
    }
    tempDirs.length = 0;
  });

  /** Scaffold a minimal registry dir with one pack. */
  function scaffoldRegistry(opts: {
    tags: string[];
    adrCount: number;
    packName?: string;
  }): string {
    const dir = mkdtempSync(join(tmpdir(), "archgate-rec-mock-"));
    tempDirs.push(dir);
    const name = opts.packName ?? "mock-pack";
    const packDir = join(dir, "packs", name);
    const adrsDir = join(packDir, "adrs");
    mkdirSync(adrsDir, { recursive: true });

    const yaml = [
      `name: ${name}`,
      `version: 0.1.0`,
      `description: Mock pack for testing`,
      `maintainers:`,
      `  - github: testuser`,
      `tags:`,
      ...opts.tags.map((t) => `  - ${t}`),
    ].join("\n");
    writeFileSync(join(packDir, "archgate-pack.yaml"), yaml);

    for (let i = 1; i <= opts.adrCount; i++) {
      const id = `MP-${String(i).padStart(3, "0")}`;
      writeFileSync(
        join(adrsDir, `${id}-rule-${i}.md`),
        `---\nid: ${id}\ntitle: Rule ${i}\n---\n# Rule ${i}\n`
      );
    }
    return dir;
  }

  /**
   * Stub `shallowClone` for one test. `spyOn` over the module namespace keeps
   * the stub scoped to this file; `mock.restore()` in `afterEach` undoes it.
   */
  function mockShallowClone(impl: () => Promise<string>): void {
    spyOn(registry, "shallowClone").mockImplementation(impl);
  }

  test("returns recommendations and cleans up cloned dir", async () => {
    const fakeCloneDir = scaffoldRegistry({
      tags: ["language:typescript"],
      adrCount: 2,
    });

    mockShallowClone(async () => fakeCloneDir);

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: [],
      frameworks: [],
    };

    const recs = await recommendPacks(stack);

    expect(recs).toHaveLength(1);
    expect(recs[0].packName).toBe("mock-pack");
    expect(recs[0].relevance).toBe("high");
    expect(recs[0].adrCount).toBe(2);
    expect(recs[0].matchedTags).toContain("language:typescript");

    expect(existsSync(fakeCloneDir)).toBe(false);
  });

  test("propagates error when shallowClone rejects", async () => {
    mockShallowClone(async () => {
      throw new Error("git clone failed");
    });

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: [],
      frameworks: [],
    };

    expect(recommendPacks(stack)).rejects.toThrow("git clone failed");
  });

  test("cleans up cloned dir with no valid packs", async () => {
    const fakeCloneDir = mkdtempSync(join(tmpdir(), "archgate-rec-bad-"));
    tempDirs.push(fakeCloneDir);
    const packDir = join(fakeCloneDir, "packs", "bad-pack");
    mkdirSync(packDir, { recursive: true });
    // No archgate-pack.yaml — recommendPacksFromDir skips the pack

    mockShallowClone(async () => fakeCloneDir);

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: [],
      frameworks: [],
    };

    const recs = await recommendPacks(stack);
    expect(recs).toHaveLength(0);
    expect(existsSync(fakeCloneDir)).toBe(false);
  });

  test("a failed clone cleanup does not replace the return value", async () => {
    // A NUL byte makes rmSync throw on argument validation (every platform),
    // while existsSync just reports the path as absent.
    mockShallowClone(async () =>
      join(tmpdir(), `archgate-rec-${String.fromCodePoint(0)}bad`)
    );

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: [],
      frameworks: [],
    };

    // Without the try/catch in the `finally` block, the cleanup error would
    // propagate and this would reject instead.
    expect(await recommendPacks(stack)).toEqual([]);
  });

  test("returns empty array when cloned registry has no matching packs", async () => {
    const fakeCloneDir = scaffoldRegistry({
      tags: ["language:rust"],
      adrCount: 1,
      packName: "rust-only",
    });

    mockShallowClone(async () => fakeCloneDir);

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: ["bun"],
      frameworks: [],
    };

    const recs = await recommendPacks(stack);
    expect(recs).toHaveLength(0);
    expect(existsSync(fakeCloneDir)).toBe(false);
  });
});
