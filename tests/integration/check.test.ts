// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { safeRmSync } from "../test-utils";
import {
  runCli,
  createTempProject,
  scaffoldProject,
  writeAdr,
  writeRules,
  makeAdr,
  expectKeys,
  expectArray,
} from "./cli-harness";

describe("check integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempProject();
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  test("no rules → exit 0", async () => {
    scaffoldProject(dir);
    const { exitCode } = await runCli(["check"], dir);
    expect(exitCode).toBe(0);
  });

  test("passing rules → exit 0 and stdout contains 'passed'", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "PASS-001.md",
      makeAdr({ id: "PASS-001", title: "Pass", rules: true })
    );
    writeRules(
      dir,
      "PASS-001.rules.ts",
      `export default { rules: { "always-pass": { description: "Always passes", async check() {} } } };`
    );
    const { exitCode, stdout } = await runCli(["check"], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("passed");
  });

  test("failing rules → exit 1 and stdout contains violation indicator", async () => {
    scaffoldProject(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "bad.ts"), 'console.log("bad");\n');
    writeAdr(
      dir,
      "FAIL-001.md",
      makeAdr({
        id: "FAIL-001",
        title: "No Console",
        rules: true,
        files: ["src/**/*.ts"],
      })
    );
    writeRules(
      dir,
      "FAIL-001.rules.ts",
      `export default {
  rules: {
    "no-console": {
      description: "No console.log",
      async check(ctx) {
        for (const file of ctx.scopedFiles) {
          const matches = await ctx.grep(file, /console\\.log/);
          for (const m of matches) {
            ctx.report.violation({ message: "Found console.log", file: m.file, line: m.line });
          }
        }
      },
    },
  },
};`
    );
    const { exitCode, stdout } = await runCli(["check"], dir);
    expect(exitCode).toBe(1);
    const lower = stdout.toLowerCase();
    expect(lower).toMatch(/violation|failed/u);
  });

  test("--output json → exit 0 and output has expected shape", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "PASS-002.md",
      makeAdr({ id: "PASS-002", title: "Pass JSON", rules: true })
    );
    writeRules(
      dir,
      "PASS-002.rules.ts",
      `export default { rules: { "always-pass": { description: "Always passes", async check() {} } } };`
    );
    const { exitCode, stdout } = await runCli(
      ["check", "--output", "json"],
      dir
    );
    expect(exitCode).toBe(0);
    const json = expectKeys(JSON.parse(stdout), "pass", "total", "results");
    expect(json.pass).toBe(true);
    expect(typeof json.total).toBe("number");
    expect(json.results).toBeInstanceOf(Array);
  });

  test("--output json with violations → pass: false and violations present", async () => {
    scaffoldProject(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "bad.ts"), 'console.log("bad");\n');
    writeAdr(
      dir,
      "FAIL-002.md",
      makeAdr({
        id: "FAIL-002",
        title: "No Console JSON",
        rules: true,
        files: ["src/**/*.ts"],
      })
    );
    writeRules(
      dir,
      "FAIL-002.rules.ts",
      `export default {
  rules: {
    "no-console": {
      description: "No console.log",
      async check(ctx) {
        for (const file of ctx.scopedFiles) {
          const matches = await ctx.grep(file, /console\\.log/);
          for (const m of matches) {
            ctx.report.violation({ message: "Found console.log", file: m.file, line: m.line });
          }
        }
      },
    },
  },
};`
    );
    const { exitCode, stdout } = await runCli(
      ["check", "--output", "json"],
      dir
    );
    expect(exitCode).toBe(1);
    const json = expectKeys(JSON.parse(stdout), "pass", "results");
    expect(json.pass).toBe(false);
    const allViolations = expectArray(json.results).flatMap((r: unknown) =>
      expectArray(expectKeys(r, "violations").violations)
    );
    expect(allViolations.length).toBeGreaterThan(0);
  });

  test("--output github → stdout contains GitHub annotation format", async () => {
    scaffoldProject(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "bad.ts"), 'console.log("bad");\n');
    writeAdr(
      dir,
      "FAIL-003.md",
      makeAdr({
        id: "FAIL-003",
        title: "No Console CI",
        rules: true,
        files: ["src/**/*.ts"],
      })
    );
    writeRules(
      dir,
      "FAIL-003.rules.ts",
      `export default {
  rules: {
    "no-console": {
      description: "No console.log",
      async check(ctx) {
        for (const file of ctx.scopedFiles) {
          const matches = await ctx.grep(file, /console\\.log/);
          for (const m of matches) {
            ctx.report.violation({ message: "Found console.log", file: m.file, line: m.line });
          }
        }
      },
    },
  },
};`
    );
    const { exitCode, stdout } = await runCli(
      ["check", "--output", "github"],
      dir
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain("::error");
  });

  test("--adr filter → only specified ADR's rules run", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ADR-A.md",
      makeAdr({ id: "ADR-A", title: "ADR A", rules: true })
    );
    writeRules(
      dir,
      "ADR-A.rules.ts",
      `export default { rules: { "rule-a": { description: "Rule A", async check() {} } } };`
    );
    writeAdr(
      dir,
      "ADR-B.md",
      makeAdr({ id: "ADR-B", title: "ADR B", rules: true })
    );
    writeRules(
      dir,
      "ADR-B.rules.ts",
      `export default { rules: { "rule-b": { description: "Rule B", async check() {} } } };`
    );
    // --verbose is required to inspect per-rule entries: both rules here are
    // no-ops, so both pass, and JSON output omits cleanly-passing rules by default.
    const { exitCode, stdout } = await runCli(
      ["check", "--adr", "ADR-A", "--output", "json", "--verbose"],
      dir
    );
    expect(exitCode).toBe(0);
    const json = expectKeys(JSON.parse(stdout), "pass", "total", "results");
    expect(json.pass).toBe(true);
    expect(json.total).toBe(1);
    const adrIds = expectArray(json.results).map(
      (r: unknown) => expectKeys(r, "adrId").adrId
    );
    expect(adrIds).toContain("ADR-A");
    expect(adrIds).not.toContain("ADR-B");
  });

  // ARCH-003 §7 end-to-end. reporter.test.ts covers reportJSON directly, but
  // only this would catch check.ts passing the wrong verbose value through.
  test("--output json omits cleanly-passing rules by default; --verbose restores them", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ADR-A.md",
      makeAdr({ id: "ADR-A", title: "ADR A", rules: true })
    );
    writeRules(
      dir,
      "ADR-A.rules.ts",
      `export default { rules: { "rule-a": { description: "Rule A", async check() {} } } };`
    );
    const leanOut = (await runCli(["check", "--output", "json"], dir)).stdout;
    const lean = expectKeys(JSON.parse(leanOut), "total", "passed", "results");
    // The rule ran and passed — the counts say so, but it has nothing to
    // report, so it must not occupy an entry in results.
    expect(lean.total).toBe(1);
    expect(lean.passed).toBe(1);
    expect(lean.results).toEqual([]);
    const fullOut = (
      await runCli(["check", "--output", "json", "--verbose"], dir)
    ).stdout;
    const full = expectKeys(JSON.parse(fullOut), "results");
    const fullResults = expectArray(full.results);
    expect(fullResults).toHaveLength(1);
    const firstResult = expectKeys(fullResults[0], "status", "ruleId");
    expect(firstResult.status).toBe("pass");
    expect(firstResult.ruleId).toBe("rule-a");
  });

  test("--verbose flag → output includes timing info", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "VERB-001.md",
      makeAdr({ id: "VERB-001", title: "Verbose", rules: true })
    );
    writeRules(
      dir,
      "VERB-001.rules.ts",
      `export default { rules: { "always-pass": { description: "Always passes", async check() {} } } };`
    );
    const { exitCode, stdout } = await runCli(["check", "--verbose"], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("ms");
  });

  test("file args → scopes checks to specified files", async () => {
    scaffoldProject(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "src", "good.ts"), "const x = 1;\n");
    writeFileSync(join(dir, "src", "bad.ts"), 'console.log("bad");\n');
    writeFileSync(join(dir, "docs", "readme.md"), "# Hello\n");
    const noConsoleRule = `export default { rules: { "no-console": { description: "No console.log", async check(ctx) {
      for (const f of ctx.scopedFiles) { for (const m of await ctx.grep(f, /console\\.log/)) ctx.report.violation({ message: "found", file: m.file, line: m.line }); }
    } } } };`;
    writeAdr(
      dir,
      "FILE-001.md",
      makeAdr({
        id: "FILE-001",
        title: "X",
        rules: true,
        files: ["src/**/*.ts"],
      })
    );
    writeRules(dir, "FILE-001.rules.ts", noConsoleRule);

    const good = await runCli(
      ["check", "--output", "json", "src/good.ts"],
      dir
    );
    expect(good.exitCode).toBe(0);
    expect(expectKeys(JSON.parse(good.stdout), "pass").pass).toBe(true);

    const bad = await runCli(["check", "--output", "json", "src/bad.ts"], dir);
    expect(bad.exitCode).toBe(1);
    expect(expectKeys(JSON.parse(bad.stdout), "pass").pass).toBe(false);

    // Out-of-scope file → ADR skipped
    const oos = await runCli(
      ["check", "--output", "json", "docs/readme.md"],
      dir
    );
    expect(oos.exitCode).toBe(0);
    expect(expectKeys(JSON.parse(oos.stdout), "pass").pass).toBe(true);
  });

  test("exit non-zero when no .archgate project found", async () => {
    // dir has no .archgate scaffold
    const { exitCode, stderr } = await runCli(["check"], dir);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("error");
  });
});
