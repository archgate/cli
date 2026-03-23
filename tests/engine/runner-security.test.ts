import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { RuleSet } from "../../src/formats/rules";

describe("runChecks path sandboxing", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-sec-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

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
            id: "SEC-001",
            title: "Security Test",
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

  test("blocks path traversal via readFile", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "traversal-test": {
            description: "Attempt path traversal",
            async check(ctx) {
              await ctx.readFile("../../etc/passwd");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("escapes project root");
  });

  test("blocks path traversal via grep", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "traversal-grep": {
            description: "Attempt path traversal via grep",
            async check(ctx) {
              await ctx.grep("../../../etc/hosts", /localhost/);
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("escapes project root");
  });

  test("blocks absolute path via readFile", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "abs-path-test": {
            description: "Attempt absolute path access",
            async check(ctx) {
              await ctx.readFile("/etc/passwd");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("escapes project root");
  });

  test("blocks glob patterns with ..", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "glob-traversal": {
            description: "Attempt glob traversal",
            async check(ctx) {
              await ctx.glob("../../**/*.ts");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("access denied");
  });

  test("blocks absolute glob patterns", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "abs-glob": {
            description: "Attempt absolute glob",
            async check(ctx) {
              await ctx.glob("/etc/**/*");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("access denied");
  });

  test("blocks grepFiles with traversal pattern", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "grepfiles-traversal": {
            description: "Attempt grepFiles traversal",
            async check(ctx) {
              await ctx.grepFiles(/secret/, "../**/*.env");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("access denied");
  });

  test("blocks readJSON with path traversal", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "json-traversal": {
            description: "Attempt readJSON traversal",
            async check(ctx) {
              await ctx.readJSON("../../../package.json");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("escapes project root");
  });
});
