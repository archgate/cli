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
    expect(lower.includes("violation") || lower.includes("failed")).toBe(true);
  });

  test("--json flag → exit 0 and output has expected shape", async () => {
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
    const { exitCode, stdout } = await runCli(["check", "--json"], dir);
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(true);
    expect(typeof json.total).toBe("number");
    expect(Array.isArray(json.results)).toBe(true);
  });

  test("--json with violations → pass: false and violations present", async () => {
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
    const { exitCode, stdout } = await runCli(["check", "--json"], dir);
    expect(exitCode).toBe(1);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(false);
    const allViolations = json.results.flatMap(
      (r: { violations: unknown[] }) => r.violations
    );
    expect(allViolations.length).toBeGreaterThan(0);
  });

  test("--ci flag → stdout contains GitHub annotation format", async () => {
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
    const { exitCode, stdout } = await runCli(["check", "--ci"], dir);
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
    const { exitCode, stdout } = await runCli(
      ["check", "--adr", "ADR-A", "--json"],
      dir
    );
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(true);
    expect(json.total).toBe(1);
    const adrIds = json.results.map((r: { adrId: string }) => r.adrId);
    expect(adrIds).toContain("ADR-A");
    expect(adrIds).not.toContain("ADR-B");
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

    const good = await runCli(["check", "--json", "src/good.ts"], dir);
    expect(good.exitCode).toBe(0);
    expect(JSON.parse(good.stdout).pass).toBe(true);

    const bad = await runCli(["check", "--json", "src/bad.ts"], dir);
    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(bad.stdout).pass).toBe(false);

    // Out-of-scope file → ADR skipped
    const oos = await runCli(["check", "--json", "docs/readme.md"], dir);
    expect(oos.exitCode).toBe(0);
    expect(JSON.parse(oos.stdout).pass).toBe(true);
  });

  test("exit non-zero when no .archgate project found", async () => {
    // dir has no .archgate scaffold
    const { exitCode, stderr } = await runCli(["check"], dir);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("error");
  });
});
