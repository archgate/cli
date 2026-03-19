import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadedAdr } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { RuleSet } from "../../src/formats/rules";

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
  ): LoadedAdr {
    return {
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
                ctx.scopedFiles.map((file) => ctx.grep(file, /console\.log/))
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
                ctx.scopedFiles.map((file) => ctx.grep(file, /console\.log/))
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
              matches = await ctx.grepFiles(/hello/, "src/**/*.ts");
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
