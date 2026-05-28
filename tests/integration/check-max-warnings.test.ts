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

describe("check --max-warnings integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempProject();
  });

  afterEach(() => {
    safeRmSync(dir);
  });

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

  test("warnings do not affect exit code without the flag", async () => {
    writeWarningAdr("WARN-001");
    const { exitCode, stdout } = await runCli(["check", "--json"], dir);
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(true);
    expect(json.warnings).toBeGreaterThan(0);
    expect(json.warningsExceeded).toBe(false);
  });

  test("--max-warnings 0 → exit 1 when a warning is reported", async () => {
    writeWarningAdr("WARN-002");
    const { exitCode, stdout } = await runCli(
      ["check", "--max-warnings", "0", "--json"],
      dir
    );
    expect(exitCode).toBe(1);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(false);
    expect(json.warningsExceeded).toBe(true);
  });

  test("--max-warnings tolerates warnings up to the threshold", async () => {
    writeWarningAdr("WARN-003");
    const { exitCode, stdout } = await runCli(
      ["check", "--max-warnings", "5", "--json"],
      dir
    );
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.pass).toBe(true);
    expect(json.warningsExceeded).toBe(false);
  });

  test("--max-warnings rejects a non-numeric value", async () => {
    scaffoldProject(dir);
    const { exitCode, stderr } = await runCli(
      ["check", "--max-warnings", "abc"],
      dir
    );
    expect(exitCode).toBe(1);
    expect(stderr.toLowerCase()).toContain("non-negative");
  });
});
