// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recommendPacksFromDir } from "../../src/helpers/pack-recommend";
import type { DetectedStack } from "../../src/helpers/stack-detect";
import { safeRmSync } from "../test-utils";

describe("recommendPacksFromDir", () => {
  let tempDir: string;

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
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));
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
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));
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
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));
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
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));
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
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));
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
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));

    const stack: DetectedStack = {
      languages: ["typescript"],
      runtimes: [],
      frameworks: [],
    };

    const recs = recommendPacksFromDir(stack, tempDir);
    expect(recs).toHaveLength(0);
  });

  test("counts ADR files correctly", () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));
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
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));
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

  test("alphabetical sort within same relevance", () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-recommend-"));
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
