// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { GrepMatch } from "../../src/formats/rules";
import type { RuleSet } from "../../src/formats/rules";
import { git, safeRmSync } from "../test-utils";

describe("runChecks", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-test-"));
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

  test("reports violations from rules", async () => {
    writeFileSync(join(tempDir, "src", "bad.ts"), 'console.log("bad");\n');

    const loaded = makeLoadedAdr(
      { files: ["src/**/*.ts"] },
      {
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
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].violations).toHaveLength(1);
    expect(result.results[0].violations[0].severity).toBe("error");
    expect(result.results[0].violations[0].file).toBe("src/bad.ts");
  });

  test("passes when no violations", async () => {
    writeFileSync(join(tempDir, "src", "good.ts"), "export const x = 1;\n");

    const loaded = makeLoadedAdr(
      { files: ["src/**/*.ts"] },
      {
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
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].violations).toHaveLength(0);
  });

  test("captures rule execution errors", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "broken-rule": {
            description: "Throws an error",
            check() {
              throw new Error("Something went wrong");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBe("Something went wrong");
  });

  test("supports warning and info severities", async () => {
    writeFileSync(join(tempDir, "src", "test.ts"), "// TODO: fix this\n");

    const loaded = makeLoadedAdr(
      { files: ["src/**/*.ts"] },
      {
        rules: {
          "check-todos": {
            description: "Check TODOs",
            severity: "warning",
            check(ctx) {
              ctx.report.warning({ message: "Found a TODO" });
              ctx.report.info({ message: "Info message" });
              return Promise.resolve();
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].violations).toHaveLength(2);
    expect(result.results[0].violations[0].severity).toBe("warning");
    expect(result.results[0].violations[1].severity).toBe("info");
  });

  test("glob helper works in rule context", async () => {
    writeFileSync(join(tempDir, "src", "a.ts"), "");
    writeFileSync(join(tempDir, "src", "b.ts"), "");

    let foundFiles: string[] = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "glob-test": {
            description: "Test glob",
            async check(ctx) {
              foundFiles = await ctx.glob("src/**/*.ts");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(foundFiles).toContain("src/a.ts");
    expect(foundFiles).toContain("src/b.ts");
  });

  // Regression: archgate/cli#222 — ctx.glob() must match dot-prefixed source
  // dirs like `.github/`, `.husky/`, `.vscode/`. Bun.Glob with `dot: false`
  // silently drops these matches on Windows, turning rules targeting
  // `.github/workflows/*.yml` into no-ops on local Windows runs while still
  // working on Linux CI.
  test("glob matches dot-prefixed directories (regression archgate/cli#222)", async () => {
    mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(tempDir, ".github", "workflows", "release.yml"), "");
    writeFileSync(join(tempDir, ".github", "workflows", "ci.yml"), "");

    let exactMatch: string[] = [];
    let starMatch: string[] = [];
    let recursiveMatch: string[] = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "dot-glob-test": {
            description: "Test dot-prefixed glob",
            async check(ctx) {
              exactMatch = await ctx.glob(".github/workflows/release.yml");
              starMatch = await ctx.glob(".github/workflows/*.yml");
              recursiveMatch = await ctx.glob(".github/**/*.yml");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(exactMatch).toEqual([".github/workflows/release.yml"]);
    expect(starMatch).toContain(".github/workflows/release.yml");
    expect(starMatch).toContain(".github/workflows/ci.yml");
    expect(recursiveMatch).toContain(".github/workflows/release.yml");
    expect(recursiveMatch).toContain(".github/workflows/ci.yml");
  });

  test("grepFiles matches dot-prefixed directories (regression archgate/cli#222)", async () => {
    mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(tempDir, ".github", "workflows", "release.yml"),
      "name: release\non: push\n"
    );

    let matches: Array<{
      file: string;
      line: number;
      column: number;
      content: string;
    }> = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "dot-grep-test": {
            description: "Test grepFiles dot-prefix",
            async check(ctx) {
              matches = await ctx.grepFiles(
                /release/u,
                ".github/workflows/*.yml"
              );
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe(".github/workflows/release.yml");
  });

  test("grepFiles helper works in rule context", async () => {
    writeFileSync(join(tempDir, "src", "a.ts"), 'const x = "hello";\n');
    writeFileSync(join(tempDir, "src", "b.ts"), "const y = 42;\n");

    let matches: Array<{
      file: string;
      line: number;
      column: number;
      content: string;
    }> = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "grep-test": {
            description: "Test grepFiles",
            async check(ctx) {
              matches = await ctx.grepFiles(/hello/u, "src/**/*.ts");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe("src/a.ts");
  });

  test("readFile and readJSON work in rule context", async () => {
    writeFileSync(join(tempDir, "src", "data.json"), '{"key": "value"}');

    let fileContent = "";
    let jsonContent: unknown;

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "read-test": {
            description: "Test readFile/readJSON",
            async check(ctx) {
              fileContent = await ctx.readFile("src/data.json");
              jsonContent = await ctx.readJSON("src/data.json");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(fileContent).toBe('{"key": "value"}');
    expect(jsonContent).toEqual({ key: "value" });
  });

  test("returns results with timing info", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "timing-test": { description: "Test timing", async check() {} },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.totalDurationMs).toBeGreaterThan(0);
    expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("runChecks gitignore filtering", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-gitignore-test-"));
    await git(["init"], tempDir);
    await git(["config", "user.email", "test@test.com"], tempDir);
    await git(["config", "user.name", "Test"], tempDir);
    mkdirSync(join(tempDir, "src"), { recursive: true });
    mkdirSync(join(tempDir, "dist"), { recursive: true });
    writeFileSync(
      join(tempDir, "src", "app.ts"),
      'export const x = "hello";\n'
    );
    writeFileSync(join(tempDir, "dist", "app.js"), 'var x = "hello";\n');
    writeFileSync(join(tempDir, ".gitignore"), "dist/\n");
    await git(["add", "src/app.ts", ".gitignore"], tempDir);
    await git(["commit", "-m", "init"], tempDir);
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  function makeLoadedAdr(
    overrides: Partial<AdrDocument["frontmatter"]> = {},
    ruleSet: {
      rules: Record<
        string,
        { description: string; check: (ctx: any) => Promise<void> }
      >;
    }
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

  test("ctx.glob excludes gitignored files by default", async () => {
    let globResults: string[] = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "glob-gitignore-test": {
            description: "Test glob respects gitignore",
            async check(ctx) {
              globResults = await ctx.glob("**/*.{ts,js}");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(globResults).toContain("src/app.ts");
    expect(globResults).not.toContain("dist/app.js");
  });

  test("ctx.glob includes gitignored files when respectGitignore is false", async () => {
    let globResults: string[] = [];

    const loaded = makeLoadedAdr(
      { respectGitignore: false },
      {
        rules: {
          "glob-no-gitignore-test": {
            description: "Test glob ignores gitignore",
            async check(ctx) {
              globResults = await ctx.glob("**/*.{ts,js}");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(globResults).toContain("src/app.ts");
    expect(globResults).toContain("dist/app.js");
  });

  test("ctx.grepFiles excludes gitignored files by default", async () => {
    let matches: GrepMatch[] = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "grep-gitignore-test": {
            description: "Test grepFiles respects gitignore",
            async check(ctx) {
              matches = await ctx.grepFiles(/hello/u, "**/*.{ts,js}");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe("src/app.ts");
  });

  test("ctx.grepFiles includes gitignored files when respectGitignore is false", async () => {
    let matches: GrepMatch[] = [];

    const loaded = makeLoadedAdr(
      { respectGitignore: false },
      {
        rules: {
          "grep-no-gitignore-test": {
            description: "Test grepFiles ignores gitignore",
            async check(ctx) {
              matches = await ctx.grepFiles(/hello/u, "**/*.{ts,js}");
            },
          },
        },
      }
    );

    await runChecks(tempDir, [loaded]);
    expect(matches).toHaveLength(2);
    const matchedFiles = matches.map((m) => m.file).sort();
    expect(matchedFiles).toEqual(["dist/app.js", "src/app.ts"]);
  });
});
