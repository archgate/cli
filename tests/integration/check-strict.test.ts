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

const PASSING_RULE = `export default {
  rules: {
    "clean-rule": {
      description: "Never reports anything",
      async check(_ctx) {
        // no-op
      },
    },
  },
};`;

const WARNING_RULE = `export default {
  rules: {
    "soft-rule": {
      description: "Emits a warning",
      async check(ctx) {
        for (const file of ctx.scopedFiles) {
          ctx.report.warning({ message: "soft warning", file });
        }
      },
    },
  },
};`;

describe("check --strict integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempProject();
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  function writeCleanAdr(id: string): void {
    scaffoldProject(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "clean.ts"), "const x = 1;\n");
    writeAdr(
      dir,
      `${id}.md`,
      makeAdr({ id, title: "Clean", rules: true, files: ["src/**/*.ts"] })
    );
    writeRules(dir, `${id}.rules.ts`, PASSING_RULE);
  }

  function writeWarningAdr(id: string): void {
    scaffoldProject(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "warn.ts"), "const x = 1;\n");
    writeAdr(
      dir,
      `${id}.md`,
      makeAdr({ id, title: "Warns", rules: true, files: ["src/**/*.ts"] })
    );
    writeRules(dir, `${id}.rules.ts`, WARNING_RULE);
  }

  /**
   * A rules:true ADR so `check` doesn't hit the "no rules to check" early
   * return (which never collects briefing diagnostics), plus a second
   * rules:false ADR whose Do's and Don'ts section exceeds the 2000-char
   * briefing budget — the exact scenario the --strict flag was requested for.
   */
  function writeBriefingOverBudgetFixture(
    ruleAdrId: string,
    proseAdrId: string
  ): void {
    writeCleanAdr(ruleAdrId);
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

  test("--strict with no violations and no advisory findings → exit 0", async () => {
    writeCleanAdr("STRICT-001");
    const { exitCode, stdout } = await runCli(
      ["check", "--strict", "--json"],
      dir
    );
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(true);
    expect(json.strictAdvisoryExceeded).toBe(false);
  });

  test("--strict treats any rule warning as a failure (implicit maxWarnings 0)", async () => {
    writeWarningAdr("STRICT-002");
    const { exitCode, stdout } = await runCli(
      ["check", "--strict", "--json"],
      dir
    );
    expect(exitCode).toBe(1);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(false);
    expect(json.warningsExceeded).toBe(true);
  });

  test("--strict --max-warnings <n> lets an explicit threshold win over strict's implicit zero", async () => {
    writeWarningAdr("STRICT-003");
    const { exitCode, stdout } = await runCli(
      ["check", "--strict", "--max-warnings", "5", "--json"],
      dir
    );
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(true);
    expect(json.warningsExceeded).toBe(false);
  });

  test("--strict fails on briefing-budget overrun alone, with zero rule violations", async () => {
    writeBriefingOverBudgetFixture("STRICT-004", "STRICT-005");
    const withoutStrict = await runCli(["check", "--json"], dir);
    expect(withoutStrict.exitCode).toBe(0);
    const withoutStrictJson = JSON.parse(withoutStrict.stdout);
    expect(withoutStrictJson.pass).toBe(true);
    expect(withoutStrictJson.briefingWarnings.length).toBeGreaterThan(0);

    const { exitCode, stdout } = await runCli(
      ["check", "--strict", "--json"],
      dir
    );
    expect(exitCode).toBe(1);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(false);
    expect(json.strictAdvisoryExceeded).toBe(true);
    expect(json.failed).toBe(0);
    expect(json.warningsExceeded).toBe(false);
  });

  test("strict: true in .archgate/config.json is honored when the flag is omitted", async () => {
    writeWarningAdr("STRICT-006");
    writeFileSync(
      join(dir, ".archgate", "config.json"),
      JSON.stringify({ domains: {}, strict: true }, null, 2)
    );
    const { exitCode, stdout } = await runCli(["check", "--json"], dir);
    expect(exitCode).toBe(1);
    const json = JSON.parse(stdout);
    expect(json.warningsExceeded).toBe(true);
  });

  test("without --strict and without config, advisory findings never fail the build", async () => {
    writeBriefingOverBudgetFixture("STRICT-007", "STRICT-008");
    const { exitCode, stdout } = await runCli(["check", "--json"], dir);
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(true);
    expect(json.strictAdvisoryExceeded).toBe(false);
  });
});
