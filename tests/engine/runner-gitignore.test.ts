// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { GrepMatch } from "../../src/formats/rules";
import { git, safeRmSync } from "../test-utils";

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

  test("warns when respectGitignore is false without files scope", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const loaded = makeLoadedAdr(
      { respectGitignore: false },
      { rules: { "noop-rule": { description: "No-op", async check() {} } } }
    );

    await runChecks(tempDir, [loaded]);
    const warnCalls = warnSpy.mock.calls.map((args) => args.join(" "));
    expect(
      warnCalls.some((msg) =>
        msg.includes("respectGitignore is false without a files scope")
      )
    ).toBe(true);
    warnSpy.mockRestore();
  });

  test("warns when file patterns match only gitignored files", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const loaded = makeLoadedAdr(
      { files: ["dist/**/*.js"] },
      { rules: { "noop-rule": { description: "No-op", async check() {} } } }
    );

    await runChecks(tempDir, [loaded]);
    const warnCalls = warnSpy.mock.calls.map((args) => args.join(" "));
    expect(
      warnCalls.some((msg) => msg.includes("all are excluded by .gitignore"))
    ).toBe(true);
    warnSpy.mockRestore();
  });

  test("does not warn when file patterns match tracked files", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const loaded = makeLoadedAdr(
      { files: ["src/**/*.ts"] },
      { rules: { "noop-rule": { description: "No-op", async check() {} } } }
    );

    await runChecks(tempDir, [loaded]);
    const warnCalls = warnSpy.mock.calls.map((args) => args.join(" "));
    expect(
      warnCalls.some((msg) => msg.includes("excluded by .gitignore"))
    ).toBe(false);
    expect(
      warnCalls.some((msg) => msg.includes("respectGitignore is false"))
    ).toBe(false);
    warnSpy.mockRestore();
  });
});
