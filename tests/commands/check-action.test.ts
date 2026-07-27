// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Action handler tests — exercise the check command via parseAsync() to cover
// the action handler code in check.ts (error paths, output format selection,
// option forwarding, telemetry tracking).
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

import { Command } from "@commander-js/extra-typings";

import { registerCheckCommand } from "../../src/commands/check";
import type { LoadResult } from "../../src/engine/loader";
import * as loaderModule from "../../src/engine/loader";
import type { ReportSummary } from "../../src/engine/reporter";
import * as reporterModule from "../../src/engine/reporter";
import type { CheckResult } from "../../src/engine/runner";
import * as runnerModule from "../../src/engine/runner";
import * as exitModule from "../../src/helpers/exit";
import * as pathsModule from "../../src/helpers/paths";
import * as stackDetectModule from "../../src/helpers/stack-detect";
import * as telemetryModule from "../../src/helpers/telemetry";
import { restoreEnv } from "../test-utils";

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
  strictAdvisoryExceeded: false,
  truncated: false,
  suppressed: 0,
  suppressionWarnings: [],
  unparsedAdrs: [],
  briefingWarnings: [],
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
  let logSpy: Mock<typeof console.log>;
  let errorSpy: Mock<typeof console.error>;
  let exitSpy: Mock<typeof exitModule.exitWith>;
  let findProjectRootSpy: Mock<typeof pathsModule.findProjectRoot>;
  let loadRuleAdrsSpy: Mock<typeof loaderModule.loadRuleAdrs>;
  let runChecksSpy: Mock<typeof runnerModule.runChecks>;
  let buildSummarySpy: Mock<typeof reporterModule.buildSummary>;
  let getExitCodeSpy: Mock<typeof reporterModule.getExitCode>;
  let reportConsoleSpy: Mock<typeof reporterModule.reportConsole>;
  let reportJSONSpy: Mock<typeof reporterModule.reportJSON>;
  let reportCISpy: Mock<typeof reporterModule.reportCI>;
  let reportSarifSpy: Mock<typeof reporterModule.reportSarif>;
  let detectStackSpy: Mock<typeof stackDetectModule.detectStack>;
  let trackCheckResultSpy: Mock<typeof telemetryModule.trackCheckResult>;
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
      // Deliberately incomplete fake LoadResult: only array length/type is
      // exercised by these tests, not ADR/ruleSet contents.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      { type: "loaded", value: {} } as unknown as LoadResult,
    ]);
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
    reportSarifSpy = spyOn(reporterModule, "reportSarif").mockImplementation(
      () => {}
    );
    detectStackSpy = spyOn(stackDetectModule, "detectStack").mockResolvedValue({
      languages: ["typescript"],
      runtimes: ["bun"],
      frameworks: [],
    });
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
    reportSarifSpy.mockRestore();
    detectStackSpy.mockRestore();
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

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    // Thrown as UserError → handleCommandError → exitWith(1, user kind)
    expect(exitSpy).toHaveBeenCalledWith(1, { errorKind: "user" });
    const errOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(errOutput).toContain("archgate init");
  });

  // -- No rules --

  test("no rules outputs text message and exits 0", async () => {
    loadRuleAdrsSpy.mockResolvedValue([]);

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toContain("No rules to check");
  });

  test("no rules with --output json reports an empty result through reportJSON", async () => {
    loadRuleAdrsSpy.mockResolvedValue([]);

    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "json"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(0);
    // The zero-rules path goes through the standard reporter with an empty
    // CheckResult (plus corpus-wide advisory diagnostics), not a hand-built
    // payload — keeping the JSON schema identical to the normal path.
    expect(reportJSONSpy).toHaveBeenCalledTimes(1);
    const emptyResult = reportJSONSpy.mock.calls[0][0];
    expect(emptyResult.results).toEqual([]);
  });

  // -- Load errors --

  test("load error logs message and exits 2 (unexpected)", async () => {
    loadRuleAdrsSpy.mockRejectedValue(new Error("failed to load rules"));

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

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

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "user cancelled"
    );

    // exitWith should NOT have been called — ExitPromptError is re-thrown
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // -- Output formats --

  test("default output calls reportConsole", async () => {
    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    expect(reportConsoleSpy).toHaveBeenCalledTimes(1);
    expect(reportJSONSpy).not.toHaveBeenCalled();
    expect(reportCISpy).not.toHaveBeenCalled();
    expect(reportSarifSpy).not.toHaveBeenCalled();
  });

  test("--output json calls reportJSON", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "json"])
    ).rejects.toThrow("process.exit");

    expect(reportJSONSpy).toHaveBeenCalledTimes(1);
    expect(reportConsoleSpy).not.toHaveBeenCalled();
    expect(reportCISpy).not.toHaveBeenCalled();
    expect(reportSarifSpy).not.toHaveBeenCalled();
  });

  test("--output github calls reportCI", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "github"])
    ).rejects.toThrow("process.exit");

    expect(reportCISpy).toHaveBeenCalledTimes(1);
    expect(reportConsoleSpy).not.toHaveBeenCalled();
    expect(reportJSONSpy).not.toHaveBeenCalled();
    expect(reportSarifSpy).not.toHaveBeenCalled();
  });

  test("--output sarif calls reportSarif", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "sarif"])
    ).rejects.toThrow("process.exit");

    expect(reportSarifSpy).toHaveBeenCalledTimes(1);
    expect(reportConsoleSpy).not.toHaveBeenCalled();
    expect(reportJSONSpy).not.toHaveBeenCalled();
    expect(reportCISpy).not.toHaveBeenCalled();
  });

  test("--output console forces human-readable even under agent auto-detect", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
    const origCI = Bun.env.CI;
    Bun.env.CI = "";

    try {
      expect(
        makeProgram().parseAsync([
          "node",
          "test",
          "check",
          "--output",
          "console",
        ])
      ).rejects.toThrow("process.exit");

      expect(reportConsoleSpy).toHaveBeenCalledTimes(1);
      expect(reportJSONSpy).not.toHaveBeenCalled();
    } finally {
      restoreEnv("CI", origCI);
    }
  });

  test("--output rejects an invalid value", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "bogus"])
    ).rejects.toThrow();
  });

  test("--verbose is forwarded to reportConsole", async () => {
    expect(
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
      expect(
        makeProgram().parseAsync(["node", "test", "check"])
      ).rejects.toThrow("process.exit");

      expect(reportJSONSpy).toHaveBeenCalledTimes(1);
      expect(reportConsoleSpy).not.toHaveBeenCalled();
    } finally {
      restoreEnv("CI", origCI);
    }
  });

  // -- Exit codes --

  test("exits with code from getExitCode when rules fail", async () => {
    getExitCodeSpy.mockReturnValue(1);

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("exits 0 when all rules pass", async () => {
    getExitCodeSpy.mockReturnValue(0);

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // -- Options forwarding --

  test("--staged passes staged option to runChecks", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--staged"])
    ).rejects.toThrow("process.exit");

    expect(runChecksSpy).toHaveBeenCalledTimes(1);
    // runChecks's 3rd param has a default value, so tsc's Parameters<>
    // extraction makes it an optional tuple element (`| undefined`) — a real
    // static-typing nuance tsc gets right; oxlint's type-aware engine
    // (tsgolint) doesn't model this, hence the "unnecessary" false report.
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
    const opts = runChecksSpy.mock.calls[0][2]!;
    expect(opts.staged).toBe(true);
  });

  test("--adr passes filter to loadRuleAdrs", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--adr", "ARCH-001"])
    ).rejects.toThrow("process.exit");

    expect(loadRuleAdrsSpy).toHaveBeenCalledTimes(1);
    expect(loadRuleAdrsSpy.mock.calls[0][1]).toBe("ARCH-001");
  });

  test("file arguments are passed to runChecks", async () => {
    expect(
      makeProgram().parseAsync([
        "node",
        "test",
        "check",
        "src/a.ts",
        "src/b.ts",
      ])
    ).rejects.toThrow("process.exit");

    expect(runChecksSpy).toHaveBeenCalledTimes(1);
    // See the identical tsc-vs-tsgolint note above.
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
    const opts = runChecksSpy.mock.calls[0][2]!;
    expect(opts.files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  // -- Telemetry --

  test("trackCheckResult is called with summary data", async () => {
    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    expect(trackCheckResultSpy).toHaveBeenCalledTimes(1);
    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.total_rules).toBe(1);
    expect(data.passed).toBe(1);
    expect(data.failed).toBe(0);
    expect(data.pass).toBe(true);
    expect(data.output_format).toBe("console");
  });

  test("telemetry records json output format", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "json"])
    ).rejects.toThrow("process.exit");

    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.output_format).toBe("json");
  });

  test("telemetry records github output format", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "github"])
    ).rejects.toThrow("process.exit");

    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.output_format).toBe("github");
  });

  test("telemetry records sarif output format", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "sarif"])
    ).rejects.toThrow("process.exit");

    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.output_format).toBe("sarif");
  });

  test("telemetry records --staged and --adr usage", async () => {
    expect(
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

  test("telemetry includes detected project stack", async () => {
    detectStackSpy.mockResolvedValue({
      languages: ["typescript", "python"],
      runtimes: ["bun", "node"],
      frameworks: ["react", "nextjs"],
    });

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.languages).toEqual(["typescript", "python"]);
    expect(data.runtimes).toEqual(["bun", "node"]);
    expect(data.frameworks).toEqual(["react", "nextjs"]);
  });

  test("telemetry still fires when stack detection fails", async () => {
    detectStackSpy.mockRejectedValue(new Error("fs error"));

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    expect(trackCheckResultSpy).toHaveBeenCalledTimes(1);
    const data = trackCheckResultSpy.mock.calls[0][0];
    expect(data.languages).toBeUndefined();
    expect(data.runtimes).toBeUndefined();
    expect(data.frameworks).toBeUndefined();
  });
});
