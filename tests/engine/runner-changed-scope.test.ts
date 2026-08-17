// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { RuleSet } from "../../src/formats/rules";
import { git, safeRmSync } from "../test-utils";

// archgate/cli#567: in incremental mode (a resolved change set), an ADR whose
// `files` globs match none of the changed files is skipped — its `check()` is
// never invoked and it contributes no results. Full-audit runs (empty change
// set) and ADRs without a `files` scope are unaffected.
describe("runChecks skips ADRs whose files scope has no changed files", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "archgate-runner-changed-scope-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "docs"), { recursive: true });
    await git(["init", "--initial-branch=main"], dir);
    await git(["config", "user.email", "t@t.com"], dir);
    await git(["config", "user.name", "T"], dir);
    await Bun.write(join(dir, "src", "a.ts"), "export const a = 1;\n");
    await Bun.write(join(dir, "docs", "readme.md"), "# docs\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "init"], dir);
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  /** Build a loaded ADR whose single rule records whether it ran. */
  function makeLoadedAdr(
    calls: string[][],
    overrides: Partial<AdrDocument["frontmatter"]> = {}
  ): LoadResult {
    const ruleSet: RuleSet = {
      rules: {
        "record-run": {
          description: "Records the scoped files it saw",
          async check(ctx) {
            calls.push([...ctx.scopedFiles]);
          },
        },
      },
    };
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

  test("skips a scoped ADR when only out-of-scope files changed", async () => {
    await Bun.write(join(dir, "docs", "readme.md"), "# docs v2\n");
    const calls: string[][] = [];

    const result = await runChecks(
      dir,
      [makeLoadedAdr(calls, { files: ["src/**/*.ts"] })],
      { base: "HEAD" }
    );

    expect(calls).toHaveLength(0);
    expect(result.results).toHaveLength(0);
  });

  test("runs a scoped ADR when an in-scope file changed", async () => {
    await Bun.write(join(dir, "src", "a.ts"), "export const a = 2;\n");
    await Bun.write(join(dir, "docs", "readme.md"), "# docs v2\n");
    const calls: string[][] = [];

    const result = await runChecks(
      dir,
      [makeLoadedAdr(calls, { files: ["src/**/*.ts"] })],
      { base: "HEAD" }
    );

    expect(calls).toEqual([["src/a.ts"]]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].error).toBeUndefined();
  });

  test("runs a scoped ADR when an in-scope file was added", async () => {
    await Bun.write(join(dir, "src", "b.ts"), "export const b = 1;\n");
    const calls: string[][] = [];

    await runChecks(dir, [makeLoadedAdr(calls, { files: ["src/**/*.ts"] })], {
      base: "HEAD",
    });

    expect(calls).toEqual([["src/a.ts", "src/b.ts"]]);
  });

  test("runs a scoped ADR when an in-scope file was deleted", async () => {
    // A staged deletion is a change to the scope even though the path is no
    // longer on disk — matching runs against the change set, not the scope.
    await git(["rm", "src/a.ts"], dir);
    const calls: string[][] = [];

    await runChecks(dir, [makeLoadedAdr(calls, { files: ["src/**/*.ts"] })], {
      staged: true,
    });

    expect(calls).toEqual([[]]);
  });

  test("skips a scoped ADR under --staged when only out-of-scope files are staged", async () => {
    await Bun.write(join(dir, "docs", "readme.md"), "# docs v2\n");
    await git(["add", "docs/readme.md"], dir);
    const calls: string[][] = [];

    const result = await runChecks(
      dir,
      [makeLoadedAdr(calls, { files: ["src/**/*.ts"] })],
      { staged: true }
    );

    expect(calls).toHaveLength(0);
    expect(result.results).toHaveLength(0);
  });

  test("runs every ADR when the change set is empty (full audit)", async () => {
    const calls: string[][] = [];

    const result = await runChecks(
      dir,
      [makeLoadedAdr(calls, { files: ["src/**/*.ts"] })],
      { base: "HEAD" }
    );

    expect(calls).toEqual([["src/a.ts"]]);
    expect(result.results).toHaveLength(1);
  });

  test("always runs an ADR without a files scope", async () => {
    await Bun.write(join(dir, "docs", "readme.md"), "# docs v2\n");
    const calls: string[][] = [];

    const result = await runChecks(dir, [makeLoadedAdr(calls)], {
      base: "HEAD",
    });

    expect(calls).toHaveLength(1);
    expect(result.results).toHaveLength(1);
  });

  test("skips only the ADRs whose scope is untouched", async () => {
    await Bun.write(join(dir, "docs", "readme.md"), "# docs v2\n");
    const srcCalls: string[][] = [];
    const docsCalls: string[][] = [];

    const result = await runChecks(
      dir,
      [
        makeLoadedAdr(srcCalls, { id: "SRC-001", files: ["src/**/*.ts"] }),
        makeLoadedAdr(docsCalls, { id: "DOCS-001", files: ["docs/**/*.md"] }),
      ],
      { base: "HEAD" }
    );

    expect(srcCalls).toHaveLength(0);
    expect(docsCalls).toEqual([["docs/readme.md"]]);
    expect(result.results.map((r) => r.adrId)).toEqual(["DOCS-001"]);
  });

  test("matches brace-group scopes against the change set", async () => {
    await Bun.write(join(dir, "docs", "readme.md"), "# docs v2\n");
    const calls: string[][] = [];

    await runChecks(
      dir,
      [makeLoadedAdr(calls, { files: ["{src,docs}/**/*.{ts,md}"] })],
      { base: "HEAD" }
    );

    expect(calls).toEqual([["docs/readme.md", "src/a.ts"]]);
  });
});
