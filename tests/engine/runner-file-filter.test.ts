// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { RuleSet } from "../../src/formats/rules";

// Regression: Sentry CLI-5 — an agent harness passed a temp-file path
// (outside the project root) to `archgate check`, and the whole run died
// with "escapes project root". Filter paths are never read — they only
// intersect with ADR-scoped files — so out-of-root paths must be skipped,
// not fatal.
describe("runChecks file-filter boundary", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-filter-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const NO_CONSOLE_RULE_SET: RuleSet = {
    rules: {
      "no-console": {
        description: "No console.log",
        async check(ctx) {
          const results = await Promise.all(
            ctx.scopedFiles.map((file) => ctx.grep(file, /console\.log/u))
          );
          for (const matches of results) {
            for (const m of matches) {
              ctx.report.violation({
                message: "Found console.log",
                file: m.file,
                line: m.line,
              });
            }
          }
        },
      },
    },
  };

  function makeLoadedAdr(
    overrides: Partial<AdrDocument["frontmatter"]> = {},
    ruleSet: RuleSet = NO_CONSOLE_RULE_SET
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

  test("skips filter files outside project root instead of failing", async () => {
    writeFileSync(join(tempDir, "src", "bad.ts"), 'console.log("bad");\n');

    const loaded = makeLoadedAdr({ files: ["src/**/*.ts"] });

    // The out-of-root temp path must be ignored; the in-root file still runs.
    const outsidePath = join(tmpdir(), "archgate-check.json");
    const result = await runChecks(tempDir, [loaded], {
      files: [outsidePath, "src/bad.ts"],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[0].violations).toHaveLength(1);
  });

  test("skips relative traversal filter files instead of failing", async () => {
    writeFileSync(join(tempDir, "src", "bad.ts"), 'console.log("bad");\n');

    const loaded = makeLoadedAdr({ files: ["src/**/*.ts"] });

    const result = await runChecks(tempDir, [loaded], {
      files: ["../outside.ts", "src/bad.ts"],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[0].violations).toHaveLength(1);
  });

  test("runs no rules when every filter file is outside project root", async () => {
    writeFileSync(join(tempDir, "src", "bad.ts"), 'console.log("bad");\n');

    const loaded = makeLoadedAdr({ files: ["src/**/*.ts"] });

    // All filter paths outside root → nothing in scope → ADR skipped entirely,
    // mirroring a filter that matches no ADR-governed files.
    const result = await runChecks(tempDir, [loaded], {
      files: [join(tmpdir(), "archgate-check.json")],
    });

    expect(result.results).toHaveLength(0);
  });
});
