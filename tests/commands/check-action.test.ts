// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Action handler tests — exercise the check command via parseAsync() to cover
// the action handler code in check.ts (error paths, output format selection,
// option forwarding, telemetry tracking).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerCheckCommand } from "../../src/commands/check";
import * as loaderModule from "../../src/engine/loader";
import type { ReportSummary } from "../../src/engine/reporter";
import * as reporterModule from "../../src/engine/reporter";
import type { CheckResult } from "../../src/engine/runner";
import * as runnerModule from "../../src/engine/runner";
import * as exitModule from "../../src/helpers/exit";
import * as pathsModule from "../../src/helpers/paths";
import * as telemetryModule from "../../src/helpers/telemetry";

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const MOCK_CHECK_RESULT: CheckResult = {
  results: [
    {
      ruleId: "test-rule",
      adrId: "TEST-001",
      description: "Test rule",
      violations: [],
      durationMs: 10,
    },
  ],
  totalDurationMs: 50,
};

const MOCK_SUMMARY: ReportSummary = {
  pass: true,
  total: 1,
  passed: 1,
  failed: 0,
  warnings: 0,
  errors: 0,
  infos: 0,
  ruleErrors: 0,
  warningsExceeded: false,
  truncated: false,
  suppressed: 0,
  suppressionWarnings: [],
  results: [
    {
      adrId: "TEST-001",
      ruleId: "test-rule",
      description: "Test rule",
      status: "pass",
      totalViolations: 0,
      shownViolations: 0,
      violations: [],
      durationMs: 10,
    },
  ],
  durationMs: 50,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("check action handler", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let findProjectRootSpy: ReturnType<typeof spyOn>;
  let loadRuleAdrsSpy: ReturnType<typeof spyOn>;
  let runChecksSpy: ReturnType<typeof spyOn>;
  let buildSummarySpy: ReturnType<typeof spyOn>;
  let getExitCodeSpy: ReturnType<typeof spyOn>;
  let reportConsoleSpy: ReturnType<typeof spyOn>;
  let reportJSONSpy: ReturnType<typeof spyOn>;
  let reportCISpy: ReturnType<typeof spyOn>;
  let trackCheckResultSpy: ReturnType<typeof spyOn>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(exitModule, "exitWith").mockImplementation(() => {
      throw new Error("process.exit");
    });

    // Default mocks: project found, one rule loaded, all pass
    findProjectRootSpy = spyOn(pathsModule, "findProjectRoot").mockReturnValue(
      "/fake/project"
    );
    loadRuleAdrsSpy = spyOn(loaderModule, "loadRuleAdrs").mockResolvedValue([
      { type: "loaded", value: {} },
    ] as never);
    runChecksSpy = spyOn(runnerModule, "runChecks").mockResolvedValue(
      MOCK_CHECK_RESULT
    );
    buildSummarySpy = spyOn(reporterModule, "buildSummary").mockReturnValue(
      MOCK_SUMMARY
    );
    getExitCodeSpy = spyOn(reporterModule, "getExitCode").mockReturnValue(0);
    reportConsoleSpy = spyOn(
      reporterModule,
      "reportConsole"
    ).mockImplementation(() => {});
    reportJSONSpy = spyOn(reporterModule, "reportJSON").mockImplementation(
      () => {}
    );
    reportCISpy = spyOn(reporterModule, "reportCI").mockImplementation(
      () => {}
    );
    trackCheckResultSpy = spyOn(
      telemetryModule,
      "trackCheckResult"
    ).mockImplementation(() => {});

    // Ensure TTY mode for predictable output format detection
    originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    findProjectRootSpy.mockRestore();
    loadRuleAdrsSpy.mockRestore();
    runChecksSpy.mockRestore();
    buildSummarySpy.mockRestore();
    getExitCodeSpy.mockRestore();
    reportConsoleSpy.mockRestore();
    reportJSONSpy.mockRestore();
    reportCISpy.mockRestore();
    trackCheckResultSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerCheckCommand(program);
    return program;
  }

  // -- No project root --

  test("no project root logs error and exits 1", async () => {
    findProjectRootSpy.mockReturnValue(null);

    await expect(
      makeProgram().parseAsync(["node", "test", "check"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(errOutput).toContain("archgate init");
  });

  // -- No rules --

  test("no rules outputs text message and exits 0", async () => {
    loadRuleAdrsSpy.mockResolvedValue([]);

    await expect(
      makeProgram().parseAsync(["node", "test", "check"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toContain("No rules to check");
  });

  test("no rules with --json outputs empty JSON result", async () => {
    loadRuleAdrsSpy.mockResolvedValue([]);

    await expect(
      makeProgram().parseAsync(["node", "test", "check", "--json"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.pass).toBe(true);
    expect(parsed.total).toBe(0);
    expect(parsed.results).toEqual([]);
  });

  // -- Load errors --

  test("load error logs message and exits 2 (unexpected)", async () => {
    loadRuleAdrsSpy.mockRejectedValue(new Error("failed to load rules"));

    await expect(
      makeProgram().parseAsync(["node", "test", "check"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(2);
    const errOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(errOutput).toContain("failed to load rules");
  });

  test("load error re-throws ExitPromptError", async () => {
    const exitPromptError = new Error("user cancelled");
    exitPromptError.name = "ExitPromptError";
    loadRuleAdrsSpy.mockRejectedValue(exitPromptError);

    await expect(
      makeProgram().parseAsync(["node", "test", "check"])
    ).rejects.toThrow("user cancelled");

    // exitWith should NOT have been called — ExitPromptError is re-thrown
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // -- Output formats --

  test("default output calls reportConsole", async () => {
    await expect(
      makeProgram().parseAsync(["node", "test", "check"])
    ).rejects.toThrow("process.exit");

    expect(reportConsoleSpy).toHaveBeenCalledTimes(1);
    expect(reportJSONSpy).not.toHaveBeenCalled();
    expect(reportCISpy).not.toHaveBeenCalled();
  });

  test("--json calls reportJSON", async () => {
    await expect(
      makeProgram().parseAsync(["node", "test", "check", "--json"])
    ).rejects.toThrow("process.exit");

    expect(reportJSONSpy).toHaveBeenCalledTimes(1);
    expect(reportConsoleSpy).not.toHaveBeenCalled();
    expect(reportCISpy).not.toHaveBeenCalled();
  });

  test("--ci calls reportCI", async () => {
    await expect(
      makeProgram().parseAsync(["node", "test", "check", "--ci"])
    ).rejects.toThrow("process.exit");

    expect(reportCISpy).toHaveBeenCalledTimes(1);
    expect(reportConsoleSpy).not.toHaveBeenCalled();
    expect(reportJSONSpy).not.toHaveBeenCalled();
  });

  test("--verbose is forwarded to reportConsole", async () => {
    await expect(
      makeProgram().parseAsync(["node", "test", "check", "--verbose"])
    ).rejects.toThrow("process.exit");

    expect(reportConsoleSpy).toHaveBeenCalledTimes(1);
    // Second arg to reportConsole is the verbose flag
    expect(reportConsoleSpy.mock.calls[0][1]).toBe(true);
  });

  test("agent context auto-selects JSON output", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
    const origCI = Bun.env.CI;
    Bun.env.CI = "";

    try {
      await expect(
        makeProgram().parseAsync(["node", "test", "check"])
      ).rejects.toThrow("process.exit");

      expect(reportJSONSpy).toHaveBeenCalledTimes(1);
      expect(reportConsoleSpy).not.toHaveBeenCalled();
    } finally {
      Bun.env.CI = origCI;
    }
  });

  // -- Exit codes --

  test("exits with code from getExitCode when rules fail", async () => {
    getExitCodeSpy.mockReturnValue(1);

    await expect(
      makeProgram().parseAsync(["node", "test", "check"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("exits 0 when all rules pass", async () => {
    getExitCodeSpy.mockReturnValue(0);

    await expect(
      makeProgram().parseAsync(["node", "test", "check"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // -- Options forwarding --

  test("--staged passes staged option to runChecks", async () => {
    await expect(
      makeProgram().parseAsync(["node", "test", "check", "--staged"])
    ).rejects.toThrow("process.exit");

    expect(runChecksSpy).toHaveBeenCalledTimes(1);
    const opts = runChecksSpy.mock.calls[0][2];
    expect(opts.staged).toBe(true);
  });

  test("--adr passes filter to loadRuleAdrs", async () => {
    await expect(
      makeProgram().parseAsync(["node", "test", "check", "--adr", "ARCH-001"])
    ).rejects.toThrow("process.exit");

    expect(loadRuleAdrsSpy).toHaveBeenCalledTimes(1);
    expect(loadRuleAdrsSpy.mock.calls[0][1]).toBe("ARCH-001");
  });

  test("file arguments are passed to runChecks", async () => {
    await expect(
      makeProgram().parseAsync([
        "node",
        "test",
        "check",
        "src/a.ts",
        "src/b.ts",
      ])
    ).rejects.toThrow("process.exit");

    expect(runChecksSpy).toHaveBeenCalledTimes(1);
    const opts = runChecksSpy.mock.calls[0][2];
    expect(opts.files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  // -- Telemetry --

  test("trackCheckResult is called with summary data", async () => {
    await expect(
      makeProgram().parseAsync(["node", "test", "check"])
    ).rejects.toThrow("process.exit");

    expect(trackCheckResultSpy).toHaveBeenCalledTimes(1);
    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.total_rules).toBe(1);
    expect(data.passed).toBe(1);
    expect(data.failed).toBe(0);
    expect(data.pass).toBe(true);
    expect(data.output_format).toBe("console");
  });

  test("telemetry records json output format", async () => {
    await expect(
      makeProgram().parseAsync(["node", "test", "check", "--json"])
    ).rejects.toThrow("process.exit");

    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.output_format).toBe("json");
  });

  test("telemetry records ci output format", async () => {
    await expect(
      makeProgram().parseAsync(["node", "test", "check", "--ci"])
    ).rejects.toThrow("process.exit");

    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.output_format).toBe("ci");
  });

  test("telemetry records --staged and --adr usage", async () => {
    await expect(
      makeProgram().parseAsync([
        "node",
        "test",
        "check",
        "--staged",
        "--adr",
        "X-001",
      ])
    ).rejects.toThrow("process.exit");

    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.used_staged).toBe(true);
    expect(data.used_adr_filter).toBe(true);
  });
});
