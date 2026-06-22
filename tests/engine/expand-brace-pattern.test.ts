// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadResult } from "../../src/engine/loader";
import { expandBracePattern, runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { RuleSet } from "../../src/formats/rules";
import { safeRmSync } from "../test-utils";

describe("expandBracePattern", () => {
  test("returns pattern unchanged when no braces", () => {
    expect(expandBracePattern("src/**/*.ts")).toEqual(["src/**/*.ts"]);
  });

  test("returns pattern unchanged when braces have no path separators", () => {
    expect(expandBracePattern("src/{a,b}.ts")).toEqual(["src/{a,b}.ts"]);
  });

  test("expands braces containing path separators", () => {
    const result = expandBracePattern("svc/{src/env.ts,env.ts}");
    expect(result).toEqual(["svc/src/env.ts", "svc/env.ts"]);
  });

  test("expands braces with multiple alternatives containing path separators", () => {
    const result = expandBracePattern("svc/{src/env.ts,src/lib/env.ts,env.ts}");
    expect(result).toEqual([
      "svc/src/env.ts",
      "svc/src/lib/env.ts",
      "svc/env.ts",
    ]);
  });

  test("expands braces with suffix after closing brace", () => {
    const result = expandBracePattern("a/{b/c,d}/e.ts");
    expect(result).toEqual(["a/b/c/e.ts", "a/d/e.ts"]);
  });

  test("handles pattern with no prefix before braces", () => {
    const result = expandBracePattern("{src/a,lib/b}.ts");
    expect(result).toEqual(["src/a.ts", "lib/b.ts"]);
  });
});

// Regression: oven-sh/bun#32596 — Bun.Glob.scan() silently returns empty
// results for brace patterns whose alternatives contain path separators.
// ctx.glob() and ctx.grepFiles() pre-expand such patterns to work around it.
describe("brace expansion in rule context (regression oven-sh/bun#32596)", () => {
  let tempDir: string;

  const EMPTY_RULE_SET: RuleSet = { rules: {} };

  function makeLoadedAdr(
    overrides: Partial<AdrDocument["frontmatter"]> = {},
    ruleSet: RuleSet = EMPTY_RULE_SET
  ): LoadResult {
    return {
      type: "loaded",
      value: {
        adr: {
          frontmatter: {
            id: "TEST-001",
            title: "Test",
            domain: "general",
            rules: true,
            ...overrides,
          },
          body: "",
          filePath: "/test.md",
        },
        ruleSet,
      },
    };
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-brace-test-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  test("ctx.glob handles brace patterns with path separators", async () => {
    mkdirSync(join(tempDir, "svc", "src"), { recursive: true });
    writeFileSync(join(tempDir, "svc", "src", "env.ts"), "");
    writeFileSync(join(tempDir, "svc", "env.ts"), "");

    let foundFiles: string[] = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "brace-glob-test": {
            description: "Test brace expansion with path seps",
            async check(ctx) {
              foundFiles = await ctx.glob("svc/{src/env.ts,env.ts}");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(foundFiles).toContain("svc/src/env.ts");
    expect(foundFiles).toContain("svc/env.ts");
    expect(foundFiles).toHaveLength(2);
  });

  test("ctx.grepFiles handles brace patterns with path separators", async () => {
    mkdirSync(join(tempDir, "svc", "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "svc", "src", "env.ts"),
      "export const A = 1;\n"
    );
    writeFileSync(join(tempDir, "svc", "env.ts"), "export const B = 2;\n");

    let matches: Array<{ file: string }> = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "brace-grep-test": {
            description: "Test grepFiles brace expansion with path seps",
            async check(ctx) {
              matches = await ctx.grepFiles(
                /export/u,
                "svc/{src/env.ts,env.ts}"
              );
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(matches).toHaveLength(2);
    const files = matches.map((m) => m.file);
    expect(files).toContain("svc/src/env.ts");
    expect(files).toContain("svc/env.ts");
  });

  test("ctx.glob still works with simple braces (no path separators)", async () => {
    writeFileSync(join(tempDir, "src", "a.ts"), "");
    writeFileSync(join(tempDir, "src", "b.ts"), "");

    let foundFiles: string[] = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "simple-brace-test": {
            description: "Test simple braces still work",
            async check(ctx) {
              foundFiles = await ctx.glob("src/{a,b}.ts");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(foundFiles).toContain("src/a.ts");
    expect(foundFiles).toContain("src/b.ts");
    expect(foundFiles).toHaveLength(2);
  });
});
