// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// The ordering contract review-context.ts documents around its --strict exit:
// the full context payload is written to stdout BEFORE the exit, so a piped
// consumer still receives it on a strict failure.
// ---------------------------------------------------------------------------

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerReviewContextCommand } from "../../src/commands/review-context";
import * as exitModule from "../../src/helpers/exit";
import * as logModule from "../../src/helpers/log";
import { expectKeys, safeRmSync } from "../test-utils";

/** An ADR whose Decision section overruns the per-section briefing budget. */
function overBudgetAdr(id: string): string {
  return `---
id: ${id}
title: Very Long ADR
domain: architecture
rules: false
---

## Context
Short context.

## Decision
${"This decision sentence is repeated to blow past the briefing budget. ".repeat(50)}

## Do's and Don'ts
### Do
- Do something.
`;
}

describe("review-context --strict output ordering", () => {
  let tempDir: string;
  let adrsDir: string;
  let originalCwd: string;
  let logSpy: Mock<typeof console.log>;
  let warnSpy: Mock<typeof logModule.logWarn>;
  let exitSpy: Mock<typeof exitModule.exitWith>;
  /** How many stdout writes had happened when the exit was requested. */
  let logCallsAtExit: number;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-review-strict-test-"));
    adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(logModule, "logWarn").mockImplementation(() => {});
    logCallsAtExit = -1;
    exitSpy = spyOn(exitModule, "exitWith").mockImplementation(
      async (): Promise<never> => {
        // Sampling the stdout spy here is what makes the ordering observable:
        // the count is taken at the moment of the exit request, not after
        // parseAsync has unwound.
        logCallsAtExit = logSpy.mock.calls.length;
        // exitWith is `Promise<never>` because it terminates the process. A
        // resolving stub hands control back to the action instead, which is
        // what lets the assertions below run at all.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return undefined as unknown as never;
      }
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    exitSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  test("prints the whole context payload before requesting exit 1", async () => {
    writeFileSync(
      join(adrsDir, "LONG-001-verbose.md"),
      overBudgetAdr("LONG-001")
    );
    process.chdir(tempDir);

    const program = new Command().exitOverride();
    registerReviewContextCommand(program);
    await program.parseAsync([
      "node",
      "test",
      "review-context",
      "--run-checks",
      "--strict",
    ]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(warnSpy.mock.calls.flat().map(String).join(" ")).toContain(
      "--strict: failing because"
    );

    // The payload is already on stdout when the exit is requested, and it is
    // the only write — the strict failure adds nothing to stdout afterwards.
    expect(logCallsAtExit).toBe(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = expectKeys(
      JSON.parse(String(logSpy.mock.calls[0][0])),
      "checkSummary",
      "domains",
      "allChangedFiles"
    );
    expect(payload.checkSummary).not.toBeNull();
  });
});
