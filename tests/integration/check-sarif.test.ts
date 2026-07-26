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
} from "./cli-harness";

const ERROR_RULE = `export default {
  rules: {
    "hard-rule": {
      description: "Always fails",
      async check(ctx) {
        for (const file of ctx.scopedFiles) {
          ctx.report.violation({ message: "hard failure", file, line: 1 });
        }
      },
    },
  },
};`;

describe("check --output sarif integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempProject();
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  function writeErrorAdr(id: string): void {
    scaffoldProject(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "fail.ts"), "const x = 1;\n");
    writeAdr(
      dir,
      `${id}.md`,
      makeAdr({ id, title: "Fails", rules: true, files: ["src/**/*.ts"] })
    );
    writeRules(dir, `${id}.rules.ts`, ERROR_RULE);
  }

  /** Mirrors check-strict.test.ts's briefing-overrun fixture. */
  function writeBriefingOverBudgetFixture(
    ruleAdrId: string,
    proseAdrId: string
  ): void {
    scaffoldProject(dir);
    writeAdr(
      dir,
      `${ruleAdrId}.md`,
      makeAdr({
        id: ruleAdrId,
        title: "Clean",
        rules: true,
        files: ["src/**/*.ts"],
      })
    );
    writeRules(
      dir,
      `${ruleAdrId}.rules.ts`,
      `export default { rules: { "clean-rule": { description: "no-op", async check(_ctx) {} } } };`
    );
    const longSection = "x".repeat(2100);
    writeAdr(
      dir,
      `${proseAdrId}.md`,
      makeAdr({
        id: proseAdrId,
        title: "Overlong prose",
        rules: false,
        body: `## Do's and Don'ts\n\n${longSection}\n`,
      })
    );
  }

  test("violation produces a valid SARIF result", async () => {
    writeErrorAdr("SARIF-001");
    const { exitCode, stdout } = await runCli(
      ["check", "--output", "sarif"],
      dir
    );
    expect(exitCode).toBe(1);
    const sarif = JSON.parse(stdout);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].tool.driver.name).toBe("archgate");
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
    const result = sarif.runs[0].results[0];
    expect(result.ruleId).toBe("SARIF-001/hard-rule");
    expect(result.level).toBe("error");
    expect(result.message.text).toBe("hard failure");
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      "src/fail.ts"
    );
  });

  test("exit code matches --output json for the same fixture", async () => {
    writeErrorAdr("SARIF-002");
    const json = await runCli(["check", "--output", "json"], dir);
    const sarif = await runCli(["check", "--output", "sarif"], dir);
    expect(sarif.exitCode).toBe(json.exitCode);
  });

  test("--strict + --output sarif surfaces advisory findings as SARIF results", async () => {
    writeBriefingOverBudgetFixture("SARIF-003", "SARIF-004");
    const { exitCode, stdout } = await runCli(
      ["check", "--strict", "--output", "sarif"],
      dir
    );
    expect(exitCode).toBe(1);
    const sarif = JSON.parse(stdout);
    const ruleIds = sarif.runs[0].results.map(
      (r: { ruleId: string }) => r.ruleId
    );
    expect(ruleIds).toContain("archgate/briefing-budget");
  });

  test("zero-rules project produces a valid, empty SARIF log", async () => {
    scaffoldProject(dir);
    const { exitCode, stdout } = await runCli(
      ["check", "--output", "sarif"],
      dir
    );
    expect(exitCode).toBe(0);
    const sarif = JSON.parse(stdout);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results).toEqual([]);
    expect(sarif.runs[0].tool.driver.rules).toEqual([]);
  });

  test("--output rejects an unknown format value", async () => {
    scaffoldProject(dir);
    const { exitCode, stderr } = await runCli(
      ["check", "--output", "bogus"],
      dir
    );
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("invalid");
  });
});
